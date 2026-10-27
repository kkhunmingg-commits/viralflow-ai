import "server-only";
import {createHash} from "node:crypto";
import type {SupabaseClient} from "@supabase/supabase-js";
import {discoverPublicProducts,permittedPublicImageUrl} from "./public-discovery";
import {videoStorageBucket,videoStoragePath} from "../video/storage";
const stableId=(key:string)=>{const h=createHash("sha256").update(key).digest("hex");return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`};
/** Re-fetch selected public source, store actual bytes, retain pending identity/rights review. Idempotent on retry. */
export async function importPublicProduct(admin:SupabaseClient,owner:string,modelKey:string,pageId:number){
  const candidate=(await discoverPublicProducts(modelKey,pageId))[0];if(!candidate)throw new Error("PUBLIC_SOURCE_NO_LONGER_ELIGIBLE");
  const productId=stableId(`${owner}:public-model:${candidate.modelKey}`),assetId=stableId(`${owner}:commons:${pageId}`);
  const existing=await admin.from("products").select("id").eq("owner_id",owner).eq("id",productId).maybeSingle();
  if(existing.error)throw new Error("PUBLIC_PRODUCT_READ_FAILED");
  if(!existing.data){
    const insert=await admin.from("products").insert({id:productId,owner_id:owner,external_provider:"public-source",external_product_id:candidate.modelKey,
      title:candidate.productTitle,slug:candidate.modelKey,category_key:candidate.category,image_url:candidate.imageUrl,product_url:candidate.manufacturerUrl,
      currency:"THB",current_price:0,original_price:null,commission_rate:0,commission_amount:0,rating:null,review_count:0,units_sold:0,status:"unavailable",
      provider_metadata:{discovery:"PUBLIC_MODEL_IMAGE_SEARCH",metricsAvailability:"UNKNOWN",identityReview:"PENDING",rightsReview:"PENDING",source:candidate,
        caveat:"No verified sale offer, stock, price, commission, rating, sales history or trademark endorsement"},first_seen_at:candidate.capturedAt,last_seen_at:candidate.capturedAt});
    if(insert.error&&insert.error.code!=="23505")throw new Error("PUBLIC_PRODUCT_SAVE_FAILED");
  }
  const saved=await admin.from("media_assets").select("id").eq("owner_id",owner).eq("id",assetId).maybeSingle();
  if(saved.error)throw new Error("PUBLIC_IMAGE_READ_FAILED");if(saved.data)return {productId,assetId};
  if(!permittedPublicImageUrl(candidate.imageUrl))throw new Error("PUBLIC_IMAGE_URL_REJECTED");
  const response=await fetch(candidate.imageUrl,{redirect:"error",signal:AbortSignal.timeout(20000)});
  if(!response.ok||!response.body||Number(response.headers.get("content-length"))>8_000_000)throw new Error("PUBLIC_IMAGE_DOWNLOAD_FAILED");
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let length=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>8_000_000)throw new Error("PUBLIC_IMAGE_TOO_LARGE");parts.push(value)}}finally{await reader.cancel()}
  const bytes=Buffer.concat(parts),jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255,png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if(!jpg&&!png)throw new Error("PUBLIC_IMAGE_TYPE_INVALID");
  const checksum=createHash("sha256").update(bytes).digest("hex"),path=videoStoragePath(owner,"products",productId,`commons-${pageId}-${checksum}.${jpg?"jpg":"png"}`),mime=jpg?"image/jpeg":"image/png";
  const upload=await admin.storage.from(videoStorageBucket).upload(path,bytes,{contentType:mime,upsert:false});
  if(upload.error&&upload.error.statusCode!=="409")throw new Error("PUBLIC_IMAGE_UPLOAD_FAILED");
  const asset=await admin.from("media_assets").insert({id:assetId,owner_id:owner,product_id:productId,asset_type:"PRODUCT_IMAGE",source_type:"PRODUCT",
    storage_path:path,mime_type:mime,width:candidate.width,height:candidate.height,checksum,provider:"wikimedia-commons",model:"source-photograph"});
  if(asset.error&&asset.error.code!=="23505")throw new Error("PUBLIC_IMAGE_SAVE_FAILED");
  return {productId,assetId};
}
