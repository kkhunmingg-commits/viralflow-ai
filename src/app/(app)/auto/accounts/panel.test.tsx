import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {it,expect,vi} from "vitest";
import {readFile,mkdir,writeFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";
vi.mock("./actions",()=>({refreshAccountsAction:vi.fn(),saveAccountAction:vi.fn()}));
import {AutomationDashboard} from "./panel";
import {accountAutomationSchema} from "@/features/multi-account/contracts";
it("shows real supplied counts, all accounts, unknown billing/capacity and 24 hours without diagnostics",()=>{
  const html=renderToStaticMarkup(<AutomationDashboard initial={{installed:true,health:null,calendar:[],accounts:Array.from({length:50},(_,i)=>({id:`account-${i}`,name:`Test ${i}`,username:null,connected:true,tokenReady:true,config:accountAutomationSchema.parse({enabled:true}),produced:0,ready:0,published:0,waiting:15,failed:0,publishCap:null,lastPublish:null,nextPublish:null,estimatedToday:0,actualToday:null}))}}/>);
  expect(html).not.toContain("750–1000");expect(html).toContain("Test 49");expect(html).toContain("23:00");expect(html).toContain("ไม่มีโควตาคลิปตายตัว");
  for(const secret of ["open_id","lease_token","API key","provider_request_id"])expect(html).not.toContain(secret);
});
it.skipIf(!process.env.MULTI_ACCOUNT_BROWSER_MODULE)("renders the actual dashboard on desktop/mobile without horizontal overflow (isolated fixture browser)",async()=>{
  const runtime=process.env.MULTI_ACCOUNT_BROWSER_MODULE!;
  const {chromium}=await import(pathToFileURL(runtime).href);
  const browser=await chromium.launch({executablePath:process.env.MULTI_ACCOUNT_BROWSER_EXECUTABLE,headless:true});
  const html=renderToStaticMarkup(<AutomationDashboard initial={{installed:true,health:null,calendar:[],accounts:Array.from({length:10},(_,i)=>({id:`fixture-${i}`,name:`บัญชีทดสอบ ${i+1}`,username:null,connected:true,tokenReady:true,config:accountAutomationSchema.parse({enabled:true}),produced:0,ready:0,published:0,waiting:15,failed:0,publishCap:null,lastPublish:null,nextPublish:null,estimatedToday:0,actualToday:null}))}}/>);
  const css=await readFile("src/app/(app)/auto/accounts/styles.css","utf8"),results=[];
  await mkdir("test-results/multi-account/screenshots",{recursive:true});
  try{
    for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
      const context=await browser.newContext({viewport}),page=await context.newPage(),errors:string[]=[];
      page.on("pageerror",(error:Error)=>errors.push(error.message));
      await page.setContent(`<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:20px;background:#101522;font:16px Arial,sans-serif}*{box-sizing:border-box}${css}</style></head><body>${html}</body></html>`);
      expect(await page.locator(".ma-account").count()).toBe(10);expect(await page.locator(".ma-hour").count()).toBe(24);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
      await page.locator("summary").first().click();expect(await page.locator('input[type="number"]').first().inputValue()).toBe("1");
      await page.locator("summary").first().click();expect(errors).toEqual([]);
      const name=viewport.width===390?"mobile":"desktop";await page.screenshot({path:`test-results/multi-account/screenshots/${name}.png`});
      results.push({viewport,accounts:10,hours:24,horizontalOverflow:false,consoleErrors:errors,scope:"Real component/CSS with isolated fixtures, no authenticated staging API proof"});await context.close();
    }
    await writeFile("test-results/multi-account/browser-proof.json",JSON.stringify(results,null,2));
  }finally{await browser.close();}
},30000);
