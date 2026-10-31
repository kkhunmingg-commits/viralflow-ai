/** Read-only developer tool: validate the reviewed original project, compose on D, then import via its existing queue UI. */
import {createHash} from "node:crypto";
import {mkdir,mkdtemp,readFile,rm,writeFile,access} from "node:fs/promises";
import {dirname,join,resolve} from "node:path";
import {tmpdir} from "node:os";
async function main(){
  const [owner,projectId,backgroundArg,outputArg]=process.argv.slice(2);
  if(!owner||!projectId||!backgroundArg||!outputArg||![owner,projectId].every(v=>/^[a-f0-9-]{36}$/i.test(v)))throw new Error("Usage: ownerUUID projectUUID D:/background.mp4 D:/finished.mp4");
  const backgroundPath=resolve(backgroundArg),outputPath=resolve(outputArg);
  if(process.platform==="win32"&&[backgroundPath,outputPath,tmpdir()].some(p=>!/^D:\\/i.test(p)))throw new Error("FLOW_EDIT_REQUIRES_DRIVE_D");
  const exists=await access(outputPath).then(()=>true,()=>false);if(exists)throw new Error("OUTPUT_ALREADY_EXISTS");
  process.loadEnvFile(".env.local");
  const [{createAdminClient},{reviewedProductionConcept},{selectRealMedia},{composeFlowPhoto},{publicProductAttribution}]=await Promise.all([
    import("../../src/lib/supabase/admin"),import("../../src/features/creative/production-gate"),import("../../src/features/video/real-media-master"),
    import("../../src/features/video/flow-photo-composer"),import("../../src/features/products/public-attribution")]);
  const admin=createAdminClient();
  const one=async(table:string,id:string)=>{const r=await admin.from(table).select("*").eq("owner_id",owner).eq("id",id).single();if(r.error)throw new Error("FLOW_EDIT_SOURCE_UNAVAILABLE");return r.data};
  const project=await one("creative_projects",projectId);
  const [product,script,angle,account]=await Promise.all([one("products",project.product_id),one("scripts",project.selected_script_id),one("creative_angles",project.selected_angle_id),one("tiktok_accounts",project.tiktok_account_id)]);
  if(script.creative_project_id!==projectId||angle.creative_project_id!==projectId||script.creative_angle_id!==angle.id||account.is_mock!==false)throw new Error("FLOW_EDIT_SOURCE_MISMATCH");
  const concept=reviewedProductionConcept({product,script,angle,account},owner);if(concept?.production.method!=="REAL_IMAGE_MOTION")throw new Error("REVIEWED_PHOTO_EDIT_REQUIRED");
  const selected=await selectRealMedia(admin,owner,{productId:product.id,accountId:account.id,creativeProjectId:projectId,evidenceIds:concept.production.evidenceIds,at:new Date()});
  const images=selected.clips.filter(c=>c.kind==="IMAGE");if(images.length!==1)throw new Error("SINGLE_REVIEWED_PHOTO_REQUIRED");
  const asset=await one("media_assets",images[0].assetId),download=await admin.storage.from("video-assets").download(images[0].storagePath);
  if(download.error||!download.data)throw new Error("FLOW_EDIT_PHOTO_UNAVAILABLE");
  const photo=new Uint8Array(await download.data.arrayBuffer());if(createHash("sha256").update(photo).digest("hex")!==asset.checksum)throw new Error("FLOW_PHOTO_CHECKSUM_MISMATCH");
  await mkdir(dirname(outputPath),{recursive:true});const workDir=await mkdtemp(join(tmpdir(),"flow-photo-owner-edit-"));
  try{
    const photoPath=join(workDir,"reference.jpg");await writeFile(photoPath,photo);
    const media=await composeFlowPhoto({backgroundPath,photoPath,expectedPhotoSha256:asset.checksum,title:product.title,captions:script.overlay_text_json,
      credit:publicProductAttribution(product.provider_metadata)??"ภาพสินค้าจริงตามหลักฐานที่ตรวจแล้ว",workDir,outputPath});
    const report={projectId,scriptId:script.id,mediaAssetId:asset.id,rightsId:images[0].rights.id,backgroundSha256:createHash("sha256").update(await readFile(backgroundPath)).digest("hex"),
      referenceSha256:asset.checksum,outputSha256:createHash("sha256").update(await readFile(outputPath)).digest("hex"),media,caption:script.caption,provenance:"Flow background/audio with deterministic reviewed-photo composition; not AI product reconstruction"};
    await writeFile(`${outputPath}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({outputPath,projectId,media,databaseWrites:0}));
  }finally{await rm(workDir,{recursive:true,force:true})}
}
main().catch(error=>{console.error(error instanceof Error?error.message:"FLOW_EDIT_FAILED");process.exitCode=1});
