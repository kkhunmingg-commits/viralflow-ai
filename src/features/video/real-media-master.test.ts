import {describe,expect,it} from "vitest";
import type {SupabaseClient} from "@supabase/supabase-js";
import {recordRealMediaUsages,selectRealMedia} from "./real-media-master";

const owner="11111111-1111-4111-8111-111111111111",product="p1",account="acct",project="proj",at=new Date("2026-10-18T12:00:00Z");
type Row=Record<string,unknown>;
function memory(tables:Record<string,Row[]>){
  const inserts:Array<{table:string;rows:Row[]}>=[];
  const client={from(table:string){
    const filters:Array<(r:Row)=>boolean>=[];let max=Infinity;
    const q={select:()=>q,eq:(k:string,v:unknown)=>(filters.push(r=>r[k]===v),q),in:(k:string,v:unknown[])=>(filters.push(r=>v.includes(r[k])),q),
      order:()=>q,limit:(n:number)=>(max=n,q),insert:async(rows:Row[])=>(inserts.push({table,rows}),{error:null}),
      then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:(tables[table]??[]).filter(r=>filters.every(f=>f(r))).slice(0,max),error:null}).then(resolve)};
    return q;
  }};
  return {client:client as unknown as SupabaseClient,inserts};
}
const asset=(id:string,extra:Row={})=>({id,owner_id:owner,product_id:product,asset_type:"VIDEO",source_type:"UPLOAD",storage_path:`owner/${owner}/products/${product}/${id}.mp4`,...extra});
const rights=(assetId:string,extra:Row={})=>({id:`r-${assetId}`,owner_id:owner,media_asset_id:assetId,product_id:product,origin_source:"OWNER_CREATED",asset_role:"REAL_FOOTAGE",
  allows_commercial:true,allows_edit:true,platform_scope:["TIKTOK"],account_scope:null,review_state:"APPROVED",expires_at:null,revoked_at:null,...extra});
const select=(tables:Record<string,Row[]>,evidenceIds:string[])=>selectRealMedia(memory(tables).client,owner,{productId:product,accountId:account,creativeProjectId:project,evidenceIds,at});

describe("real media selection at render time",()=>{
  it("uses only reviewed evidence ids, in the reviewer's order, ignoring fact ids",async()=>{
    const result=await select({media_assets:[asset("a"),asset("b",{asset_type:"PRODUCT_IMAGE"}),asset("unused")],media_asset_rights:[rights("a"),rights("b",{asset_role:"REAL_IMAGE"}),rights("unused")]},["b","fact-1","a"]);
    expect(result.clips.map(c=>[c.assetId,c.kind])).toEqual([["b","IMAGE"],["a","VIDEO"]]);
    expect(result.voice).toBeNull();
  });
  it.each<[string,Row]>([["pending",{review_state:"PENDING"}],["revoked",{revoked_at:"2026-10-18T11:00:00Z"}],["another account",{account_scope:["other"]}],
    ["no edit",{allows_edit:false}],["another product",{product_id:"p2"}],["music role",{asset_role:"MUSIC"}]])("stops the render when rights are %s",async(_,change)=>{
    await expect(select({media_assets:[asset("a")],media_asset_rights:[rights("a",change)]},["a"])).rejects.toThrow("REAL_MEDIA_RIGHTS_NOT_CLEARED");
  });
  it("needs at least one media source and ignores other owners' files",async()=>{
    await expect(select({media_assets:[asset("a")],media_asset_rights:[]},["fact-1"])).rejects.toThrow("REAL_MEDIA_EVIDENCE_REQUIRED");
    await expect(select({media_assets:[asset("a",{storage_path:"owner/other/a.mp4"})],media_asset_rights:[rights("a")]},["a"])).rejects.toThrow("REAL_MEDIA_EVIDENCE_REQUIRED");
  });
  it("uses the owner's own cleared narration for this project only",async()=>{
    const voice=asset("v",{asset_type:"VOICE",creative_project_id:project}),otherProject=asset("w",{asset_type:"VOICE",creative_project_id:"other"});
    const result=await select({media_assets:[asset("a"),voice,otherProject],media_asset_rights:[rights("a"),rights("v",{asset_role:"VOICE"}),rights("w",{asset_role:"VOICE"})]},["a"]);
    expect(result.voice?.assetId).toBe("v");
    const unreviewed=await select({media_assets:[asset("a"),voice],media_asset_rights:[rights("a"),rights("v",{asset_role:"VOICE",review_state:"PENDING"})]},["a"]);
    expect(unreviewed.voice).toBeNull();
  });
  it("records each source with its rights snapshot once",async()=>{
    const selection=await select({media_assets:[asset("a")],media_asset_rights:[rights("a")]},["a"]);
    const fresh=memory({media_asset_usages:[]});await recordRealMediaUsages(fresh.client,owner,"m1",selection);
    expect(fresh.inserts[0].rows).toEqual([expect.objectContaining({media_asset_id:"a",rights_id:"r-a",master_video_id:"m1",rights_snapshot:expect.objectContaining({review_state:"APPROVED"})})]);
    const again=memory({media_asset_usages:[{owner_id:owner,master_video_id:"m1",media_asset_id:"a"}]});await recordRealMediaUsages(again.client,owner,"m1",selection);
    expect(again.inserts).toEqual([]);
  });
});
