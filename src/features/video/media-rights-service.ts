import "server-only";
import {createHash,randomUUID} from "node:crypto";
import {mkdir,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {z} from "zod";
import type {SupabaseClient} from "@supabase/supabase-js";
import {ownsVideoStoragePath,videoStorageBucket,videoStoragePath} from "./storage";
import {FFmpegVideoRenderer} from "./renderer";
import {currentRightsByAsset,mediaRightsViolations,type MediaRightsRecord} from "./media-rights";

const THIRD_PARTY=["COMMISSIONED","LICENSED_STOCK","MERCHANT_LICENSED"] as const;
const PROOF_TYPES:Record<string,string>={"application/pdf":"pdf","image/jpeg":"jpg","image/png":"png","image/webp":"webp"};
// Server actions accept about 1 MB per request; a license screenshot or PDF page fits.
const MAX_PROOF_BYTES=900_000;
const checkbox=z.preprocess(v=>v==="on"||v===true,z.boolean());
const optionalDate=z.preprocess(v=>v===""||v==null?null:v,z.string().datetime({offset:true}).or(z.string().date()).nullable());

export const mediaRightsInputSchema=z.object({
  mediaAssetId:z.string().uuid(),
  originSource:z.enum(["OWNER_CREATED","ORIGINAL_GRAPHIC",...THIRD_PARTY]),
  assetRole:z.enum(["REAL_IMAGE","REAL_FOOTAGE","COMPARISON_FOOTAGE","ORIGINAL_GRAPHIC","LICENSED_STOCK","MUSIC","VOICE"]),
  sourceReference:z.string().trim().min(1).max(2000),rightsholder:z.string().trim().min(1).max(300),licenseType:z.string().trim().min(1).max(300),
  allowsCommercial:checkbox,allowsEdit:checkbox,allowsPromotion:checkbox,depictsProductOperation:checkbox,
  platformScope:z.array(z.enum(["TIKTOK","INSTAGRAM","FACEBOOK","YOUTUBE"])).min(1),
  accountScope:z.array(z.string().uuid()).max(50).default([]),
  musicConstraints:z.string().trim().max(1000).default(""),likenessConstraints:z.string().trim().max(1000).default(""),
  expiresAt:optionalDate,
});
export type MediaRightsInput=z.infer<typeof mediaRightsInputSchema>;

export function parseMediaRightsForm(form:FormData){
  const text=(key:string)=>{const value=form.get(key);return typeof value==="string"?value:undefined};
  return mediaRightsInputSchema.parse({mediaAssetId:text("mediaAssetId"),originSource:text("originSource"),assetRole:text("assetRole"),
    sourceReference:text("sourceReference"),rightsholder:text("rightsholder"),licenseType:text("licenseType"),
    allowsCommercial:text("allowsCommercial"),allowsEdit:text("allowsEdit"),allowsPromotion:text("allowsPromotion"),depictsProductOperation:text("depictsProductOperation"),
    platformScope:form.getAll("platformScope"),accountScope:form.getAll("accountScope").filter(v=>v!==""),
    musicConstraints:text("musicConstraints"),likenessConstraints:text("likenessConstraints"),expiresAt:text("expiresAt")});
}

/** Proof must be a real document or image; its hash is what the ledger stores. */
export async function readRightsProof(file:FormDataEntryValue|null){
  if(!(file instanceof File)||file.size===0)return null;
  const extension=PROOF_TYPES[file.type];
  if(!extension||file.size>MAX_PROOF_BYTES)throw new Error("rights_proof_invalid");
  const bytes=new Uint8Array(await file.arrayBuffer()),head=Buffer.from(bytes.slice(0,12));
  const matches=extension==="pdf"?head.subarray(0,5).toString()==="%PDF-":extension==="jpg"?head[0]===0xff&&head[1]===0xd8&&head[2]===0xff
    :extension==="png"?head.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):head.subarray(0,4).toString()==="RIFF"&&head.subarray(8,12).toString()==="WEBP";
  if(!matches)throw new Error("rights_proof_invalid");
  return {bytes,type:file.type,extension,sha256:createHash("sha256").update(bytes).digest("hex")};
}

const failed=(error:{message?:string}|null,code:string)=>{if(error)throw new Error(code)};

/** Owner attests documented permission for one asset. The record starts PENDING; review is a separate step. */
export async function recordMediaRights(admin:SupabaseClient,owner:string,input:MediaRightsInput,proof:Awaited<ReturnType<typeof readRightsProof>>){
  if((THIRD_PARTY as readonly string[]).includes(input.originSource)&&!proof)throw new Error("rights_proof_required");
  const asset=await admin.from("media_assets").select("id,product_id,storage_path").eq("owner_id",owner).eq("id",input.mediaAssetId).maybeSingle();
  failed(asset.error,"media_asset_unavailable");
  if(!asset.data||!ownsVideoStoragePath(owner,String(asset.data.storage_path)))throw new Error("media_asset_not_found");
  if(input.accountScope.length){
    const accounts=await admin.from("tiktok_accounts").select("id").eq("owner_id",owner).in("id",input.accountScope);
    failed(accounts.error,"account_scope_unavailable");
    if((accounts.data??[]).length!==new Set(input.accountScope).size)throw new Error("account_scope_invalid");
  }
  let proofPath:string|null=null;
  if(proof){
    proofPath=videoStoragePath(owner,"products",String(asset.data.product_id??"unassigned"),`rights-${randomUUID()}.${proof.extension}`);
    const upload=await admin.storage.from(videoStorageBucket).upload(proofPath,proof.bytes,{contentType:proof.type,upsert:false});
    failed(upload.error,"rights_proof_upload_failed");
  }
  const row=await admin.from("media_asset_rights").insert({owner_id:owner,media_asset_id:input.mediaAssetId,product_id:asset.data.product_id??null,
    origin_source:input.originSource,asset_role:input.assetRole,source_reference:input.sourceReference,rightsholder:input.rightsholder,license_type:input.licenseType,
    proof_uri:proofPath,proof_sha256:proof?.sha256??null,allows_commercial:input.allowsCommercial,allows_edit:input.allowsEdit,allows_promotion:input.allowsPromotion,
    platform_scope:input.platformScope,account_scope:input.accountScope.length?input.accountScope:null,territory:["TH"],
    music_constraints:input.musicConstraints,likeness_constraints:input.likenessConstraints,depicts_product_operation:input.depictsProductOperation,
    attested_by:owner,expires_at:input.expiresAt}).select("id").single();
  if(row.error){
    if(proofPath)await admin.storage.from(videoStorageBucket).remove([proofPath]);
    throw new Error(row.error.code==="23505"?"media_rights_already_recorded":"media_rights_save_failed");
  }
  return {id:String(row.data.id)};
}

/** Review confirms the media is the exact product and the permission matches the proof. Only PENDING records change. */
export async function reviewMediaRights(admin:SupabaseClient,owner:string,rightsId:string,decision:"APPROVED"|"REJECTED"){
  const result=await admin.from("media_asset_rights").update({review_state:decision,reviewed_by:owner,reviewed_at:new Date().toISOString()})
    .eq("owner_id",owner).eq("id",rightsId).eq("review_state","PENDING").is("revoked_at",null).select("id");
  failed(result.error,"media_rights_review_failed");
  if(!(result.data??[]).length)throw new Error("media_rights_not_pending");
}

/** Revocation is final; the database stops queued posts and rejects outputs built from this media. */
export async function revokeMediaRights(admin:SupabaseClient,owner:string,rightsId:string,reason:string){
  const text=z.string().trim().min(3).max(500).parse(reason);
  const result=await admin.from("media_asset_rights").update({revoked_at:new Date().toISOString(),revocation_reason:text})
    .eq("owner_id",owner).eq("id",rightsId).is("revoked_at",null).select("id");
  failed(result.error,"media_rights_revoke_failed");
  if(!(result.data??[]).length)throw new Error("media_rights_not_found");
}

export const contentEvidenceSchema=z.object({productId:z.string().uuid(),statement:z.string().trim().min(1).max(500),
  source:z.enum(["PDP","LABEL","OWNER_FOOTAGE","AUTHORIZED_SOURCE"]),sourceReference:z.string().trim().min(1).max(2000),
  role:z.enum(["PROBLEM","SELLING_POINT","OBSERVATION"]).nullable(),capturedAt:z.string().date().or(z.string().datetime({offset:true}))});

/** A fact the Creative Agent may cite. The owner checked it against the named source. */
export async function addContentEvidence(admin:SupabaseClient,owner:string,input:z.infer<typeof contentEvidenceSchema>){
  const product=await admin.from("products").select("id").eq("owner_id",owner).eq("id",input.productId).maybeSingle();
  failed(product.error,"product_unavailable");if(!product.data)throw new Error("product_not_found");
  const capturedAt=new Date(input.capturedAt);if(!(capturedAt.getTime()<=Date.now()))throw new Error("evidence_captured_in_future");
  const row=await admin.from("content_evidence").insert({owner_id:owner,product_id:input.productId,statement:input.statement,source:input.source,
    source_reference:input.sourceReference,role:input.role,captured_at:capturedAt.toISOString(),verified_by:owner}).select("id").single();
  failed(row.error,"evidence_save_failed");return {id:String(row.data!.id)};
}
export async function revokeContentEvidence(admin:SupabaseClient,owner:string,evidenceId:string){
  const result=await admin.from("content_evidence").update({revoked_at:new Date().toISOString()}).eq("owner_id",owner).eq("id",evidenceId).is("revoked_at",null).select("id");
  failed(result.error,"evidence_revoke_failed");if(!(result.data??[]).length)throw new Error("evidence_not_found");
}

/** Owner view: real product media with its current rights state, plus cited facts. */
export async function listRightsWorkspace(client:SupabaseClient,owner:string,at=new Date()){
  const [assets,rights,evidence]=await Promise.all([
    client.from("media_assets").select("id,product_id,asset_type,source_type,storage_path,created_at").eq("owner_id",owner)
      .in("source_type",["UPLOAD","PRODUCT"]).in("asset_type",["PRODUCT_IMAGE","IMAGE","VIDEO","VOICE"]).order("created_at",{ascending:false}).limit(100),
    client.from("media_asset_rights").select("id,media_asset_id,product_id,origin_source,asset_role,rightsholder,license_type,allows_commercial,allows_edit,platform_scope,account_scope,review_state,expires_at,revoked_at,proof_sha256,attested_at")
      .eq("owner_id",owner).order("attested_at",{ascending:false}).limit(500),
    client.from("content_evidence").select("id,product_id,statement,source,source_reference,role,captured_at,revoked_at").eq("owner_id",owner)
      .is("revoked_at",null).order("created_at",{ascending:false}).limit(200),
  ]);
  failed(assets.error,"media_assets_unavailable");failed(rights.error,"media_rights_unavailable");failed(evidence.error,"evidence_unavailable");
  const productIds=[...new Set((assets.data??[]).map(a=>a.product_id).filter(Boolean))].map(String);
  const products=productIds.length?await client.from("products").select("id,title").eq("owner_id",owner).in("id",productIds):{data:[],error:null};
  failed(products.error,"products_unavailable");
  const titles=new Map((products.data??[]).map(p=>[String(p.id),String(p.title)]));
  const current=currentRightsByAsset((rights.data??[]) as unknown as MediaRightsRecord[]);
  const items=(assets.data??[]).filter(a=>ownsVideoStoragePath(owner,String(a.storage_path))).map(a=>{
    const record=current.get(String(a.id)) as (MediaRightsRecord&{rightsholder:string;license_type:string;proof_sha256:string|null})|undefined;
    // Account scope is checked per account at publish time; here only account-independent limits are shown.
    const blockers=mediaRightsViolations(record&&{...record,account_scope:null},{at,accountId:""});
    return {...a,productTitle:titles.get(String(a.product_id))??"",rights:record??null,blockers};
  });
  return {items,evidence:evidence.data??[]};
}

const VOICE_TYPES:Record<string,string>={"audio/mpeg":"mp3","audio/mp4":"m4a","audio/x-m4a":"m4a","audio/wav":"wav","audio/x-wav":"wav","audio/webm":"webm","audio/ogg":"ogg"};

/** The owner's own narration for one creative project. It is recorded as owner-created VOICE media
 * and still needs the separate review step before the composer will use it. */
export async function saveOwnerVoice(admin:SupabaseClient,owner:string,projectId:string,file:FormDataEntryValue|null){
  if(!(file instanceof File)||!file.size||file.size>MAX_PROOF_BYTES)throw new Error("voice_invalid");
  const extension=VOICE_TYPES[file.type];if(!extension)throw new Error("voice_invalid");
  const project=await admin.from("creative_projects").select("id,product_id").eq("owner_id",owner).eq("id",projectId).maybeSingle();
  failed(project.error,"project_unavailable");if(!project.data)throw new Error("project_not_found");
  const bytes=new Uint8Array(await file.arrayBuffer()),dir=join(tmpdir(),"viralflow-voice",randomUUID());await mkdir(dir,{recursive:true});
  let duration:number;
  try{
    const path=join(dir,"voice");await writeFile(path,bytes);const media=await new FFmpegVideoRenderer().probe(path);
    // Narration must fit the 8-second clip; longer audio would be cut mid-sentence.
    if(!media.hasAudio||!(media.duration>.5&&media.duration<=8))throw new Error("voice_duration_invalid");
    duration=media.duration;
  }catch(error){throw error instanceof Error&&error.message==="voice_duration_invalid"?error:new Error("voice_invalid")}
  finally{await rm(dir,{recursive:true,force:true})}
  const productId=String(project.data.product_id),storagePath=videoStoragePath(owner,"products",productId,`voice-${randomUUID()}.${extension}`);
  const upload=await admin.storage.from(videoStorageBucket).upload(storagePath,bytes,{contentType:file.type,upsert:false});failed(upload.error,"voice_upload_failed");
  const asset=await admin.from("media_assets").insert({owner_id:owner,product_id:productId,creative_project_id:projectId,asset_type:"VOICE",source_type:"UPLOAD",
    storage_path:storagePath,mime_type:file.type,duration_seconds:duration,checksum:createHash("sha256").update(bytes).digest("hex")}).select("id").single();
  if(asset.error){await admin.storage.from(videoStorageBucket).remove([storagePath]);throw new Error("voice_save_failed")}
  const rights=await admin.from("media_asset_rights").insert({owner_id:owner,media_asset_id:asset.data.id,product_id:productId,origin_source:"OWNER_CREATED",asset_role:"VOICE",
    source_reference:"Owner-recorded narration",rightsholder:"Owner",license_type:"OWNER_ORIGINAL",allows_commercial:true,allows_edit:true,allows_promotion:true,
    platform_scope:["TIKTOK"],territory:["TH"],likeness_constraints:"Owner's own voice",attested_by:owner}).select("id").single();
  failed(rights.error,"voice_rights_save_failed");
  return {assetId:String(asset.data.id),rightsId:String(rights.data!.id)};
}
