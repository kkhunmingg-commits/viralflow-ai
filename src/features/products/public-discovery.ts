/** Public model/image discovery. No marketplace metrics or rights approval are inferred. */
export const PUBLIC_PRODUCT_MODELS = [{key:"casio-f-91w",title:"Casio F-91W",category:"watches",query:'"Casio F-91W"',
  manufacturerUrl:"https://www.casio.com/th/watches/casio/product.F-91W-1/"}] as const;
export interface PublicProductCandidate {
  modelKey:string; productTitle:string; category:string; manufacturerUrl:string;
  pageId:number; fileTitle:string; sourceUrl:string; imageUrl:string; width:number; height:number;
  creator:string; license:string; licenseUrl:string; capturedAt:string;
}
type ImagePage={pageid?:number;title?:string;imageinfo?:Array<{descriptionurl?:string;thumburl?:string;thumbwidth?:number;thumbheight?:number;
  width?:number;height?:number;mime?:string;extmetadata?:Record<string,{value?:string}>}>};
const text=(value:string="")=>value.replace(/<[^>]*>/g,"").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
export function permittedPublicImageUrl(value:string){
  try{const u=new URL(value);return u.protocol==="https:"&&!u.username&&!u.password&&!u.port&&["upload.wikimedia.org","thumb.wikimedia.org"].includes(u.hostname)}catch{return false}
}
export function publicImageCandidate(page:ImagePage,model:typeof PUBLIC_PRODUCT_MODELS[number],capturedAt:string):PublicProductCandidate|null{
  const info=page.imageinfo?.[0],meta=info?.extmetadata??{},field=(key:string)=>text(meta[key]?.value);
  if(!info||!page.pageid||!page.title||!/^File:.*Casio.*F[-_ ]?91W/i.test(page.title)||/\b(counterfeit|replica|fake)\b/i.test(page.title))return null;
  const license=field("LicenseShortName"),source=info.descriptionurl??"",licenseUrl=field("LicenseUrl");
  if(!/^(CC0(?: 1\.0)?|Public domain|CC BY(?:-SA)? (?:1\.0|2\.0|2\.5|3\.0|4\.0))$/i.test(license)||field("Restrictions")||!field("Artist"))return null;
  if(!source.startsWith("https://commons.wikimedia.org/wiki/File:")||!licenseUrl.startsWith("https://creativecommons.org/")||
    !permittedPublicImageUrl(info.thumburl??"")||!['image/jpeg','image/png'].includes(info.mime??"")||(info.width??0)<1000||!info.thumbwidth||!info.thumbheight)return null;
  return {modelKey:model.key,productTitle:model.title,category:model.category,manufacturerUrl:model.manufacturerUrl,pageId:page.pageid,fileTitle:page.title,
    sourceUrl:source,imageUrl:info.thumburl!,width:info.thumbwidth,height:info.thumbheight,creator:field("Artist"),license,licenseUrl,capturedAt};
}
export async function discoverPublicProducts(modelKey:string=PUBLIC_PRODUCT_MODELS[0].key,pageId?:number):Promise<PublicProductCandidate[]>{
  const model=PUBLIC_PRODUCT_MODELS.find(m=>m.key===modelKey);if(!model)throw new Error("PUBLIC_PRODUCT_MODEL_UNKNOWN");
  const query=new URLSearchParams({action:"query",format:"json",prop:"imageinfo",iiprop:"url|size|extmetadata|mime",iiurlwidth:"960"});
  if(pageId){if(!Number.isSafeInteger(pageId)||pageId<1)throw new Error("PUBLIC_SOURCE_INVALID");query.set("pageids",String(pageId))}
  else{query.set("generator","search");query.set("gsrsearch",model.query);query.set("gsrnamespace","6");query.set("gsrlimit","12")}
  const response=await fetch(`https://commons.wikimedia.org/w/api.php?${query}`,{headers:{"User-Agent":"ViralFlowSourceDiscovery/1.0 (https://github.com/kkhunmingg-commits/viralflow-ai)"},signal:AbortSignal.timeout(20000),cache:"no-store",redirect:"error"});
  if(!response.ok)throw new Error("PUBLIC_SOURCE_UNAVAILABLE");
  const body=await response.json() as {query?:{pages?:Record<string,ImagePage>}},now=new Date().toISOString();
  const rank=(c:PublicProductCandidate)=>/front closeup.*time/i.test(c.fileTitle)?0:/front/i.test(c.fileTitle)?1:2;
  return Object.values(body.query?.pages??{}).map(p=>publicImageCandidate(p,model,now)).filter((c):c is PublicProductCandidate=>c!==null)
    .sort((a,b)=>rank(a)-rank(b)||a.pageId-b.pageId).slice(0,6);
}
