import {writeFile} from "node:fs/promises";
import {join} from "node:path";
import type {SupabaseClient} from "@supabase/supabase-js";
import {composeRealMedia,LOCAL_COMPOSER_MODEL,type ComposerClip} from "./local-composer";
import {resolveNarration,type ResolvedNarration} from "./narration";
import {FFmpegVideoRenderer} from "./renderer";
import {beatCaptions,beatTimeline,directRealMedia,subjectBox,type StoryPlan} from "./story-director";
import type {ThaiVoiceProvider} from "./thai-voice";
import {currentRightsByAsset,mediaRightsViolations,type MediaRightsRecord} from "./media-rights";
import {ownsVideoStoragePath} from "./storage";
import {VIDEO_BUCKET} from "./types";

type Row=Record<string,unknown>;
const RIGHTS_COLUMNS="id,media_asset_id,product_id,origin_source,asset_role,allows_commercial,allows_edit,platform_scope,account_scope,review_state,expires_at,revoked_at,depicts_product_operation,proof_sha256";
const VISUAL_ROLES=new Set(["REAL_IMAGE","REAL_FOOTAGE","COMPARISON_FOOTAGE"]);

export interface RealMediaSelection {clips:Array<ComposerClip&{storagePath:string;rights:MediaRightsRecord}>;voice:{assetId:string;storagePath:string;rights:MediaRightsRecord}|null}

/** Re-checks every source at render time: the reviewer's evidence ids, this owner and product,
 * and a rights record that is valid for this account now. Anything else stops the render. */
export async function selectRealMedia(client:SupabaseClient,owner:string,input:{productId:string;accountId:string;creativeProjectId:string;evidenceIds:string[];at:Date}):Promise<RealMediaSelection>{
  const [visual,voices]=await Promise.all([
    input.evidenceIds.length?client.from("media_assets").select("id,product_id,asset_type,storage_path").eq("owner_id",owner).eq("product_id",input.productId).in("id",input.evidenceIds):{data:[],error:null},
    // Owner-recorded narration for this project. Licensed system TTS is resolved later with its provenance.
    client.from("media_assets").select("id,product_id,asset_type,storage_path,created_at").eq("owner_id",owner).eq("creative_project_id",input.creativeProjectId).eq("asset_type","VOICE").eq("source_type","UPLOAD").order("created_at",{ascending:false}).limit(5),
  ]);
  if(visual.error||voices.error)throw new Error("real_media_unavailable");
  const assets=[...(visual.data??[]),...(voices.data??[])].filter(a=>ownsVideoStoragePath(owner,String(a.storage_path)));
  const rights=assets.length?await client.from("media_asset_rights").select(RIGHTS_COLUMNS).eq("owner_id",owner).in("media_asset_id",assets.map(a=>String(a.id))):{data:[],error:null};
  if(rights.error)throw new Error("real_media_rights_unavailable");
  const ledger=currentRightsByAsset((rights.data??[]) as MediaRightsRecord[]);
  const cleared=(asset:Row)=>{const record=ledger.get(String(asset.id));
    return record&&mediaRightsViolations(record,{at:input.at,accountId:input.accountId}).length===0?record:null};
  // Keep the reviewer's order; facts share the evidence id list and are simply not media.
  const byId=new Map((visual.data??[]).filter(a=>ownsVideoStoragePath(owner,String(a.storage_path))).map(a=>[String(a.id),a as Row]));
  const clips:RealMediaSelection["clips"]=[];
  for(const id of input.evidenceIds){
    const asset=byId.get(id);if(!asset)continue;
    const record=cleared(asset);
    if(!record||record.product_id!==input.productId||!VISUAL_ROLES.has(record.asset_role))throw new Error("REAL_MEDIA_RIGHTS_NOT_CLEARED");
    clips.push({assetId:id,storagePath:String(asset.storage_path),kind:asset.asset_type==="VIDEO"?"VIDEO":"IMAGE",path:"",rights:record});
  }
  if(!clips.length)throw new Error("REAL_MEDIA_EVIDENCE_REQUIRED");
  if(clips.length>6)throw new Error("REAL_MEDIA_TOO_MANY_CLIPS");
  const voiceAsset=(voices.data??[]).find(v=>{const record=cleared(v as Row);return record?.asset_role==="VOICE"});
  return {clips,voice:voiceAsset?{assetId:String(voiceAsset.id),storagePath:String(voiceAsset.storage_path),rights:ledger.get(String(voiceAsset.id))!}:null};
}

/** The owner's own cleared narration for a project, if any (used by every local format). */
export async function selectOwnerVoice(client:SupabaseClient,owner:string,input:{creativeProjectId:string;accountId:string;at:Date}){
  const voices=await client.from("media_assets").select("id,storage_path,created_at").eq("owner_id",owner).eq("creative_project_id",input.creativeProjectId).eq("asset_type","VOICE").eq("source_type","UPLOAD").order("created_at",{ascending:false}).limit(5);
  if(voices.error)throw new Error("real_media_unavailable");
  const owned=(voices.data??[]).filter(v=>ownsVideoStoragePath(owner,String(v.storage_path)));
  if(!owned.length)return null;
  const rights=await client.from("media_asset_rights").select(RIGHTS_COLUMNS).eq("owner_id",owner).in("media_asset_id",owned.map(v=>String(v.id)));
  if(rights.error)throw new Error("real_media_rights_unavailable");
  const ledger=currentRightsByAsset((rights.data??[]) as MediaRightsRecord[]);
  for(const voice of owned){const record=ledger.get(String(voice.id));
    if(record?.asset_role==="VOICE"&&!mediaRightsViolations(record,{at:input.at,accountId:input.accountId}).length)return {assetId:String(voice.id),storagePath:String(voice.storage_path),rights:record};}
  return null;
}

export async function downloadOwnerVoice(client:SupabaseClient,voice:{assetId:string;storagePath:string},path:string){
  await download(client,voice.storagePath,path);return {assetId:voice.assetId,path};
}

async function download(client:SupabaseClient,storagePath:string,path:string){
  const {data,error}=await client.storage.from(VIDEO_BUCKET).download(storagePath);
  if(error||!data)throw new Error("real_media_download_failed");
  if(data.size>200_000_000)throw new Error("real_media_too_large");
  await writeFile(path,new Uint8Array(await data.arrayBuffer()));
}

/** Seconds of speech to pace the edit against; null for caption-only cuts. */
export async function narrationSeconds(narration:ResolvedNarration){
  if(narration.source.kind==="SYSTEM_TTS")return narration.source.durationSeconds;
  return narration.voicePath?(await new FFmpegVideoRenderer().probe(narration.voicePath)).duration:null;
}

export async function renderRealMediaMaster(client:SupabaseClient,owner:string,input:{selection:RealMediaSelection;story:StoryPlan;script:string;tts:ThaiVoiceProvider|null;workDir:string;outputPath:string}){
  const clips=await Promise.all(input.selection.clips.map(async(clip,index)=>{
    const path=join(input.workDir,`source-${index}`);await download(client,clip.storagePath,path);return {...clip,path};
  }));
  let ownerVoice:{assetId:string;path:string}|undefined;
  if(input.selection.voice){ownerVoice={assetId:input.selection.voice.assetId,path:join(input.workDir,"voice")};await download(client,input.selection.voice.storagePath,ownerVoice.path)}
  // A product ad needs spoken narration; caption-only is reserved for text-first Growth formats.
  const narration=await resolveNarration({ownerVoice,script:input.script,workDir:input.workDir,tts:input.tts,allowCaptionOnly:false,maxSeconds:7.8});
  // Cut on the narration beats, across every cleared asset, with captions that follow the voice.
  const windows=beatTimeline(input.story.beats,await narrationSeconds(narration),8);
  const media=await Promise.all(clips.map(async c=>({assetId:c.assetId,path:c.path,kind:c.kind as "IMAGE"|"VIDEO",subject:c.kind==="IMAGE"?await subjectBox(c.path):undefined})));
  const composed=await composeRealMedia({clips:directRealMedia(input.story.beats,windows,media),captions:beatCaptions(input.story.beats,windows),
    voicePath:narration.voicePath,audioMode:narration.audioMode,durationSeconds:8,workDir:input.workDir,outputPath:input.outputPath});
  return {...composed,clips,narration:narration.source,story:input.story};
}

/** Links an output to the exact rights seen at build time so a later revocation stops it. */
export async function recordRealMediaUsages(client:SupabaseClient,owner:string,masterId:string,selection:RealMediaSelection,composer:string=LOCAL_COMPOSER_MODEL){
  const sources=[...selection.clips.map(c=>({assetId:c.assetId,rights:c.rights})),...(selection.voice?[selection.voice]:[])];
  const rows=sources.map(source=>({owner_id:owner,media_asset_id:source.assetId,rights_id:source.rights.id,master_video_id:masterId,
    rights_snapshot:{...source.rights,composer,recordedAt:new Date().toISOString()}}));
  // The unique index is partial, so PostgREST cannot upsert against it; insert only what is missing.
  const existing=await client.from("media_asset_usages").select("media_asset_id").eq("owner_id",owner).eq("master_video_id",masterId);
  if(existing.error)throw new Error("real_media_usage_record_failed");
  const recorded=new Set((existing.data??[]).map(r=>String(r.media_asset_id))),missing=rows.filter(r=>!recorded.has(r.media_asset_id));
  if(!missing.length)return;
  const result=await client.from("media_asset_usages").insert(missing);
  if(result.error)throw new Error("real_media_usage_record_failed");
}
