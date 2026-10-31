/** Retain the public photograph's credit and adaptation license in the exported caption. */
export function publicProductAttribution(metadata:Record<string,unknown>|undefined):string|null{
  if(metadata?.discovery!=="PUBLIC_MODEL_IMAGE_SEARCH")return null;
  const source=metadata.source as Record<string,unknown>|undefined;
  if(!source||typeof source.creator!=="string"||source.creator.length>100||!Number.isSafeInteger(source.pageId)||Number(source.pageId)<1||
    typeof source.license!=="string"||typeof source.licenseUrl!=="string"||!source.licenseUrl.startsWith("https://creativecommons.org/"))throw new Error("PUBLIC_ATTRIBUTION_INVALID");
  const credit=`ภาพ ${source.creator} / Commons https://commons.wikimedia.org/?curid=${source.pageId} · ตัดต่อเป็นวิดีโอ · ${source.license} ${source.licenseUrl}`;
  if(credit.length>280)throw new Error("PUBLIC_ATTRIBUTION_TOO_LONG");return credit;
}
export function captionWithAttribution(caption:string,credit:string|undefined){
  return credit?`${caption.slice(0,Math.max(0,299-credit.length)).trim()}\n${credit}`.trim():caption;
}
