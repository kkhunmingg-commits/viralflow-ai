/* Proves the owner-report import against every migration on a throwaway local Supabase stack.
 * The CSV below is a TEST FIXTURE with obviously synthetic numbers; it checks mechanics only (storage,
 * linking, duplicate files, mock refusal, channel split) and is never reported as a clip's performance.
 * Run: node --import ./scripts/pilot/server-only-shim.mjs --import tsx scripts/pilot/import-proof.ts <out-dir> */
import {mkdir,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import {channelRevenue,importOwnerReport} from "../../src/features/analytics/report-import";
import {log,must,pilotOwner,sandboxAccount} from "./sandbox";

const [outDir]=process.argv.slice(2);
async function main(){
  await mkdir(outDir,{recursive:true});
  const {admin,owner}=await pilotOwner();
  const account=await sandboxAccount(admin,owner,"AFFILIATE");
  const mock=String(must(await admin.from("tiktok_accounts").insert({owner_id:owner,display_name:"Mock account (import must refuse)",mode:"GROWTH",is_mock:true,authorization_status:"authorized"}).select("id").single(),"mock").id);
  const fixtureId="7000000000000000001";
  const videoCsv=["Video link,Post time,Video views,Likes,Comments,Shares,Saves,New followers,Average watch time,Watched full video",
    `https://www.tiktok.com/@fixture/video/${fixtureId},2026-10-10 18:00,111,11,1,1,1,1,1.1s,11%`].join("\n");
  const ordersCsv=["Order ID,Product ID,Content type,GMV,Estimated commission,Actual commission,Order status,Order created time",
    `FIXTURE-${randomUUID()},P-FIXTURE,Video,100,10,,Pending,2026-10-11 10:00`,`FIXTURE-${randomUUID()},P-FIXTURE,LIVE,200,20,20,Completed,2026-10-11 11:00`].join("\n");
  const at=new Date();
  const first=await importOwnerReport(admin,owner,{accountId:account,kind:"VIDEO_PERFORMANCE",fileName:"fixture-content.csv",text:videoCsv,reportedAt:at});
  const again=await importOwnerReport(admin,owner,{accountId:account,kind:"VIDEO_PERFORMANCE",fileName:"fixture-content.csv",text:videoCsv,reportedAt:at});
  const refused=await importOwnerReport(admin,owner,{accountId:mock,kind:"VIDEO_PERFORMANCE",fileName:"fixture-content.csv",text:videoCsv,reportedAt:at}).then(()=>"UNEXPECTED_IMPORT",(e:Error)=>e.message);
  const orders=await importOwnerReport(admin,owner,{accountId:account,kind:"AFFILIATE_ORDERS",fileName:"fixture-orders.csv",text:ordersCsv,reportedAt:at});
  const snaps=must(await admin.from("video_analytics_snapshots").select("source,video_kind,views,new_followers,full_watch_rate,import_batch_id,availability_json").eq("owner_id",owner),"snaps") as unknown as Array<Record<string,unknown>>;
  const events=must(await admin.from("affiliate_conversion_events").select("channel,event_type,external_order_id,external_event_id,gmv,estimated_commission,settled_commission,source").eq("owner_id",owner),"events") as unknown as Parameters<typeof channelRevenue>[0];
  // A mislabelled row must be refused by the database itself, not only by the importer.
  const unlabelled=await admin.from("video_analytics_snapshots").insert({owner_id:owner,tiktok_account_id:account,video_id:randomUUID(),video_kind:"EXTERNAL",external_video_id:"7000000000000000002",
    source:"OWNER_REPORT_IMPORT",source_snapshot_at:at.toISOString(),source_confidence:.8});
  const proof={note:"TEST FIXTURE: synthetic numbers that check import mechanics only. Not performance data.",
    firstImport:first.status,secondImportSameFile:again.status,mockAccount:refused,ordersImport:orders.status,
    snapshots:snaps,channelRevenue:channelRevenue(events),rowWithoutBatchRefused:Boolean(unlabelled.error)};
  log("import.proof",proof);
  await writeFile(join(outDir,"import-proof.json"),JSON.stringify(proof,null,2));
  const ok=first.status==="IMPORTED"&&again.status==="ALREADY_IMPORTED"&&refused==="REPORT_ACCOUNT_IS_MOCK"&&snaps.length===1&&snaps[0].source==="OWNER_REPORT_IMPORT"&&proof.rowWithoutBatchRefused&&
    proof.channelRevenue.VIDEO?.orders===1&&proof.channelRevenue.LIVE?.orders===1;
  if(!ok)process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exit(1)});
