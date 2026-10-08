// Actual Next.js pages and cookie-auth boundary, against loopback HTTPS network
// fixtures only. It never touches a remote customer/session, env file or API key.
// Usage: node scripts/verify-readiness-browser.mjs --playwright-module <index.mjs>
//   --python <python.exe> --browser <chrome.exe>
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:https';
import { createServer as createNetServer } from 'node:net';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const option=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
const playwrightPath=option('--playwright-module'),pythonPath=option('--python'),browserPath=option('--browser');
assert(playwrightPath&&pythonPath&&browserPath,'Pass explicit installed tooling paths; no runtime download is performed');
const {chromium}=await import(pathToFileURL(resolve(playwrightPath)).href);
const artifactDir=resolve('.video-benchmark/production-readiness-browser');
await mkdir(artifactDir,{recursive:true});
const fixtureBytes=await readFile(join(artifactDir,'domain-fixture.json'));
const fixture=JSON.parse(fixtureBytes.toString('utf8'));
assert((fixture.ownerId||fixture.owner)&&fixture.tables?.tiktok_accounts?.length===3,'Requires the separately proved three-account domain fixture');
const tables=fixture.tables;
const owner=fixture.ownerId??fixture.owner;
const queries=[],errors=[],externalRequests=[];
const jwtKey=randomBytes(32);
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const now=Math.floor(Date.now()/1000);
const claims={sub:owner,role:'authenticated',aud:'authenticated',iat:now,exp:now+3600,
  app_metadata:{provider:'email',providers:['email']},user_metadata:{display_name:'Automated readiness fixture'}};
const encoded=`${encode({alg:'HS256',typ:'JWT'})}.${encode(claims)}`;
const token=`${encoded}.${createHmac('sha256',jwtKey).update(encoded).digest('base64url')}`;
const user={id:owner,aud:'authenticated',role:'authenticated',email:'automated-browser-proof@example.invalid',
  email_confirmed_at:new Date().toISOString(),created_at:new Date().toISOString(),updated_at:new Date().toISOString(),
  app_metadata:claims.app_metadata,user_metadata:claims.user_metadata,identities:[]};
const session={access_token:token,refresh_token:'isolated-fixture-no-provider-credential',token_type:'bearer',expires_in:3600,
  expires_at:claims.exp,user};
const authenticate=authorization=>{
  if(typeof authorization!=='string'||!authorization.startsWith('Bearer '))return false;
  const parts=authorization.slice(7).split('.');
  if(parts.length!==3)return false;
  const actual=Buffer.from(parts[2],'base64url'),expected=createHmac('sha256',jwtKey).update(parts.slice(0,2).join('.')).digest();
  return actual.length===expected.length&&timingSafeEqual(actual,expected)
    &&JSON.parse(Buffer.from(parts[1],'base64url').toString()).sub===owner;
};

// The ephemeral TLS private key stays in this process; only its public certificate
// is written for Node's explicit CA trust. No disabled certificate verification.
const tls=JSON.parse(execFileSync(pythonPath,['-c',`import datetime,json,ipaddress
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import rsa
key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'ViralFlow isolated browser fixture')])
now=datetime.datetime.now(datetime.timezone.utc)
cert=x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-datetime.timedelta(minutes=1)).not_valid_after(now+datetime.timedelta(hours=2)).add_extension(x509.BasicConstraints(ca=True,path_length=None),critical=True).add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address('127.0.0.1')),x509.DNSName('localhost')]),critical=False).sign(key,hashes.SHA256())
print(json.dumps({'key':key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()).decode(),'cert':cert.public_bytes(serialization.Encoding.PEM).decode()}))
`],{encoding:'utf8',maxBuffer:20000}));
const caPath=join(artifactDir,'fixture-public-ca.pem');
await writeFile(caPath,tls.cert);
const json=(response,status,body,headers={})=>{response.writeHead(status,{'Content-Type':'application/json',...headers});response.end(JSON.stringify(body));};
const scalar=value=>value==='null'?null:value==='true'?true:value==='false'?false:value;
function filterRows(rows,url){
  let selected=[...rows];
  for(const [column,expression] of url.searchParams){
    if(['select','order','limit','offset'].includes(column))continue;
    const [op,...values]=expression.split('.');const value=values.join('.');
    if(op==='eq')selected=selected.filter(row=>String(row[column])===value);
    else if(op==='is')selected=selected.filter(row=>value==='null'?row[column]==null:row[column]===scalar(value));
    else if(op==='not'&&value==='is.null')selected=selected.filter(row=>row[column]!=null);
    else if(op==='in'){const allowed=value.slice(1,-1).split(',').map(x=>x.replace(/^"|"$/g,''));selected=selected.filter(row=>allowed.includes(String(row[column])));}
    else if(['gte','lte','lt','gt'].includes(op))selected=selected.filter(row=>row[column]!=null&&({gte:row[column]>=value,lte:row[column]<=value,lt:row[column]<value,gt:row[column]>value})[op]);
    else throw new Error(`unsupported fixture filter ${column}:${op}`);
  }
  const count=selected.length;
  const order=url.searchParams.get('order');
  if(order)selected.sort((a,b)=>{for(const piece of order.split(',')){const [key,direction]=piece.split('.');if(a[key]===b[key])continue;return(a[key]>b[key]?1:-1)*(direction==='desc'?-1:1);}return 0;});
  const offset=Number(url.searchParams.get('offset')??0),limit=Number(url.searchParams.get('limit')??selected.length);
  selected=selected.slice(offset,offset+limit);
  const columns=url.searchParams.get('select');
  if(columns&&columns!=='*')selected=selected.map(row=>Object.fromEntries(columns.split(',').map(column=>{
    const [alias,source]=column.split(':');return [alias,row[source??alias]??null];
  })));
  return {selected,count};
}
const server=createServer({key:tls.key,cert:tls.cert},(request,response)=>{
  try{
    const url=new URL(request.url,'https://127.0.0.1');
    queries.push({path:url.pathname,method:request.method,ownerFilter:url.searchParams.get('owner_id'),accountFilter:url.searchParams.get('tiktok_account_id')});
    if(url.pathname==='/auth/v1/user')return authenticate(request.headers.authorization)?json(response,200,user):json(response,401,{msg:'Invalid fixture session'});
    if(request.method==='POST'&&url.pathname.startsWith('/storage/v1/object/sign/video-assets/')){
      if(!authenticate(request.headers.authorization))return json(response,401,{message:'Fixture requires a signed owner session'});
      const path=decodeURIComponent(url.pathname.slice('/storage/v1/object/sign/video-assets/'.length));
      assert((tables.master_videos??[]).some(row=>row.owner_id===owner&&row.storage_path===path),'Signed preview must refer to an owned persisted master');
      // Preview URL transport only; no storage authorization or visual-quality
      // acceptance is inferred. Completed fixture jobs do not play this URL.
      return json(response,200,{signedURL:`/object/sign/video-assets/${path}?token=isolated-fixture`});
    }
    if(url.pathname.startsWith('/rest/v1/')&&['GET','HEAD'].includes(request.method)){
      if(!authenticate(request.headers.authorization))return json(response,401,{message:'Fixture requires a signed owner session'});
      const table=url.pathname.slice('/rest/v1/'.length);
      if(!/^[a-z_]+$/.test(table))throw new Error('invalid fixture table');
      // The only mocked boundary is remote transport/data; actual page/domain
      // query filters still execute and are asserted. This is not hosted RLS proof.
      const owned=(tables[table]??[]).filter(row=>!row.owner_id||row.owner_id===owner);
      const {selected,count}=filterRows(owned,url);
      if(request.method==='HEAD'){response.writeHead(200,{'Content-Range':`0-${Math.max(0,count-1)}/${count}`});return response.end();}
      const single=String(request.headers.accept).includes('vnd.pgrst.object');
      if(single&&selected.length!==1)return json(response,406,{code:'PGRST116',details:`The result contains ${selected.length} rows`,message:'JSON object requested, multiple (or no) rows returned'});
      return json(response,200,single?selected[0]:selected,{'Content-Range':`0-${Math.max(0,count-1)}/${count}`});
    }
    errors.push(`Unexpected fixture request ${request.method} ${url.pathname}`);
    return json(response,400,{message:'Unsupported fixture boundary; no production fallback'});
  }catch(error){errors.push(error.message);return json(response,500,{message:'Fixture boundary failed'});}
});
await new Promise(resolveListen=>server.listen(0,'127.0.0.1',resolveListen));
const fixturePort=server.address().port;
const reserve=createNetServer();await new Promise(resolveListen=>reserve.listen(0,'127.0.0.1',resolveListen));
const appPort=reserve.address().port;await new Promise(resolveClose=>reserve.close(resolveClose));
const appUrl=`http://127.0.0.1:${appPort}`;
const environment={...process.env,NODE_EXTRA_CA_CERTS:caPath,NEXT_TELEMETRY_DISABLED:'1',APP_ENV:'development',
  APP_URL:appUrl,NEXT_PUBLIC_SUPABASE_URL:`https://127.0.0.1:${fixturePort}`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_isolated_browser_fixture_only',
  SUPABASE_SECRET_KEY:'',FAL_KEY:'',GOOGLE_GENAI_API_KEY:'',OPENAI_API_KEY:'',CREATIVE_AI_PROVIDER:'mock',
  VIDEO_BENCHMARK_ALLOW_PAID:'false',POST_AUTOMATION_EXECUTION_MODE:'SAFE',FAL_VIDEO_ENABLED:'false',FAL_WAN_PROVIDER_STATE:'PRIMARY_CANDIDATE',
  TIKTOK_PROVIDER:'mock',TIKTOK_PUBLISHING_PROVIDER:'mock',TIKTOK_PUBLISHING_REAL_MODE:'false',TIKTOK_ANALYTICS_PROVIDER:'mock',
  TIKTOK_ANALYTICS_REAL_MODE:'false',TIKTOK_SHOP_PROVIDER:'mock',TIKTOK_SHOP_REAL_MODE:'false',TIKTOK_VIDEO_PUBLISH_APPROVED:'false',
  TIKTOK_VIDEO_UPLOAD_APPROVED:'false',TIKTOK_DIRECT_POST_AUDIT_STATUS:'IN_REVIEW',OPS_RECOVERY_ENABLED:'false',
  TIKTOK_CLIENT_KEY:'',TIKTOK_CLIENT_SECRET:'',TIKTOK_TOKEN_ENCRYPTION_KEY:'',TIKTOK_REDIRECT_URI:''};
const child=spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port',String(appPort)],
  {env:environment,stdio:['ignore','pipe','pipe'],windowsHide:true});
let serverLog='';for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>{serverLog=(serverLog+bytes.toString()).slice(-20000);});
let browser;
const result={kind:'ISOLATED_NEXT_BROWSER_NETWORK_FIXTURE',hostedAcceptance:false,authSourceBypass:false,
  generatedAt:new Date().toISOString(),fixtureSha256:createHash('sha256').update(fixtureBytes).digest('hex'),
  fixtureClock:'UNCHANGED_FROZEN_DOMAIN_TIMESTAMPS',
  accountCases:[],historicalCases:[],screenshots:[],consoleErrors:[],externalRequests,fixtureErrors:errors,paidCalls:0,tiktokPostingCalls:0};
try{
  const startupDeadline=Date.now()+180000;
  while(!/Ready in/.test(serverLog)){
    if(child.exitCode!==null)throw new Error('Next dev server exited before ready');
    if(Date.now()>startupDeadline)throw new Error('Next dev startup timeout');
    await new Promise(resolveWait=>setTimeout(resolveWait,500));
  }
  browser=await chromium.launch({executablePath:browserPath,headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(!['127.0.0.1','localhost'].includes(url.hostname)){externalRequests.push(url.origin);return route.abort();}
    return route.continue();
  });
  await context.addCookies([{name:'sb-127-auth-token',value:`base64-${encode(session)}`,url:appUrl,httpOnly:true,sameSite:'Lax'}]);
  const page=await context.newPage();
  page.on('pageerror',error=>result.consoleErrors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')result.consoleErrors.push(message.text());});
  const overflow=async()=>page.evaluate(()=>({document:document.documentElement.scrollWidth,viewport:window.innerWidth,
    pipeline:[...document.querySelectorAll('.operator-stage')].map(element=>{const r=element.getBoundingClientRect(),p=element.parentElement.getBoundingClientRect();return{inside:r.left>=p.left-1&&r.right<=p.right+1};})}));
  for(const count of [3,10]){
    while(tables.tiktok_accounts.length<count){const i=tables.tiktok_accounts.length+1;tables.tiktok_accounts.push({...tables.tiktok_accounts[0],id:randomUUID(),display_name:`Automated fixture ${i}`,username:`fixture_${i}`,created_at:new Date().toISOString()});}
    const accountsResponse=await page.goto(`${appUrl}/accounts`,{waitUntil:'networkidle',timeout:180000});
    assert.equal(accountsResponse.status(),200);assert.equal(page.url(),`${appUrl}/accounts`);
    if(await page.locator('.accounts-card').count()!==count){
      result.accountsPageEvidence=(await page.locator('main').innerText()).slice(0,1500);
      result.requestPaths=queries.map(query=>query.path);
      await page.screenshot({path:join(artifactDir,'failed-accounts.png'),fullPage:true});
    }
    assert.equal(await page.locator('.accounts-card').count(),count,'actual customer page lists fixture records');
    for(const [device,width,height] of [['desktop',1440,1000],['mobile',390,844]]){
      await page.setViewportSize({width,height});
      const layout=await overflow();assert(layout.document<=layout.viewport,`Accounts overflow ${count}/${device}`);
      if(device==='mobile'){
        const nameWidths=await page.locator('.accounts-card h2').evaluateAll(elements=>elements.map(element=>element.getBoundingClientRect().width));
        assert(nameWidths.length===count&&nameWidths.every(value=>value>=140),'mobile account names retain readable space beside badges');
      }
      const path=join(artifactDir,`accounts-${count}-${device}.png`);await page.screenshot({path,fullPage:true});result.screenshots.push(path);
    }
    for(const [device,width,height] of [['desktop',1440,1000],['tablet',820,1100],['mobile',390,844]]){
      await page.setViewportSize({width,height});
      const response=await page.goto(`${appUrl}/auto?account=${tables.tiktok_accounts[0].id}`,{waitUntil:'networkidle',timeout:180000});
      assert.equal(response.status(),200);assert(page.url().includes('/auto?account='));
      assert.equal(await page.locator('select[name="accountId"] option').count(),count);
      const metrics=await page.locator('.operator-metric').evaluateAll(elements=>elements.map(element=>({label:element.querySelector('span').textContent,value:element.querySelector('strong').textContent})));
      const account=tables.tiktok_accounts[0].id;
      const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      const begin=Date.parse(`${today}T00:00:00+07:00`),end=begin+86400000;
      const generated=(tables.master_videos??[]).filter(row=>row.owner_id===owner&&row.tiktok_account_id===account&&['READY','APPROVED'].includes(row.status)&&row.storage_path&&Date.parse(row.created_at)>=begin&&Date.parse(row.created_at)<end).length;
      assert.equal(metrics.find(metric=>metric.label==='สร้างแล้ว')?.value,String(generated),'metric equals transport fixture records');
      assert.equal(metrics.find(metric=>metric.label==='โพสต์แล้ว')?.value,'0','EXPORT does not claim a TikTok post');
      const persistedMasters=(tables.master_videos??[]).filter(row=>row.owner_id===owner&&row.tiktok_account_id===account).length;
      assert.equal(persistedMasters,1,'the selected account retains its actual domain-test master');
      // Keep the original deterministic domain timestamps. A prior-day completed
      // run correctly leaves today's control panel pending instead of replaying
      // yesterday's progress as today's work.
      const currentRun=(tables.auto_runs??[]).find(row=>row.run_date===today||['RUNNING','STARTING'].includes(row.state));
      if(currentRun){
        const content=await page.locator('main').innerText();
        assert(content.includes('ส่งออก'),'the completed EXPORT stage is labelled as export');
        assert(content.includes('รอผลลัพธ์หลังเผยแพร่')&&content.includes('รอผลลัพธ์เพื่อปรับแผน'),'deferred analytics and learning remain waiting');
      }else{
        assert.equal(await page.locator('.operator-stage.completed').count(),0,'prior-day progress is not presented as today');
      }
      const layout=await overflow();assert(layout.document<=layout.viewport,`Auto overflow ${count}/${device}`);
      assert(layout.pipeline.length===6&&layout.pipeline.every(stage=>stage.inside),'all six customer stages stay inside their container');
      const path=join(artifactDir,`auto-${count}-${device}.png`);await page.screenshot({path,fullPage:true});result.screenshots.push(path);
      result.accountCases.push({count,device,status:response.status(),today,generated,persistedMasters,currentRun:Boolean(currentRun),metrics,layout});
    }
  }
  // Historical persisted outputs remain visible without rebasing dates or
  // inventing current-day metrics. This also checks account-scoped aggregation.
  for(const account of tables.tiktok_accounts.slice(0,3)){
    for(const [device,width,height] of [['desktop',1440,1000],['mobile',390,844]]){
      await page.setViewportSize({width,height});
      const response=await page.goto(`${appUrl}/post/${account.id}?period=7d`,{waitUntil:'networkidle',timeout:180000});
      assert.equal(response.status(),200);
      assert.equal(await page.locator('.customer-clip-card').count(),1,'one original persisted clip per account');
      assert.equal(await page.getByRole('link',{name:'ดาวน์โหลดไปโพสต์',exact:true}).count(),1,'EXPORT remains downloadable');
      const layout=await overflow();assert(layout.document<=layout.viewport,`Historical export overflow ${device}`);
      const path=join(artifactDir,`export-${result.historicalCases.length+1}-${device}.png`);
      await page.screenshot({path,fullPage:true});result.screenshots.push(path);
      result.historicalCases.push({device,status:response.status(),clips:1,exportReady:true,layout});
    }
  }
  assert.equal(externalRequests.length,0,'browser attempted no external provider request');
  assert.equal(errors.length,0,'every server transport query has a fixture boundary');
  assert.equal(result.consoleErrors.length,0,'no browser runtime/console error');
  result.queryCount=queries.length;result.authenticatedUserChecks=queries.filter(query=>query.path==='/auth/v1/user').length;
  result.accountScopedMetricReads=queries.filter(query=>query.path==='/rest/v1/master_videos'&&query.accountFilter).length;
  result.result='PASS';
}catch(error){result.result='FAIL';result.failure=error.message;}
finally{
  if(browser)await browser.close();child.kill();server.close();jwtKey.fill(0);tls.key='';
  await rm(caPath,{force:true});
  await writeFile(join(artifactDir,'browser-result.json'),JSON.stringify(result,null,2));
}
console.log(JSON.stringify(result));
if(result.result!=='PASS')process.exitCode=1;
