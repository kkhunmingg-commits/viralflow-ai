import { z } from "zod";
import { lookupResultSchema } from "./browser-lookup";
import { parseProductLink, type ProductPlatform } from "./link";

/**
 * Shopee shows its product page to the owner's own Chrome but blocks the automated window of the Flow worker, even
 * after signing in. So the owner can send the page from their own Chrome: a bookmark button ("ส่งเข้า ViralFlow")
 * reads what the open product page already shows (name, description, listing photos) and posts it to
 * /api/product-capture, which fills the clip that is waiting for that product (or starts one). Pure apart from zod.
 */
export const captureSchema = lookupResultSchema.omit({ jobId: true, ok: true, error: true }).extend({ finalUrl: z.string().max(3000) });
export type ProductCapture = z.infer<typeof captureSchema>;

/** The page the capture came from: only a Shopee or Lazada product page (never a short link or another site). */
export function capturePlatform(finalUrl: string): ProductPlatform | null {
  try {
    const parsed = parseProductLink(finalUrl);
    return parsed.short ? null : parsed.platform;
  } catch { return null; }
}
/** The browser's Origin header of the first post: a Shopee or Lazada page. */
export function marketplaceOrigin(origin: string | null) {
  if (!origin) return false;
  try { const url = new URL(origin); return url.protocol === "https:" && capturePlatform(`${url.origin}/`) !== null; } catch { return false; }
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
export { escapeHtml };

/**
 * The bookmark's code (plain ES5 text, so no bundler helper can leak into it). It runs in the owner's Chrome on the
 * product page they opened themselves, reads only what that page shows (name, description, listing photos), and opens
 * ViralFlow in a new tab with it. It sends no cookies or passwords of the marketplace.
 */
const CAPTURE_CODE = String.raw`(function(origin){
var w=window.open("about:blank","viralflow-capture");
if(!/(^|\.)(shopee|lazada)\./i.test(location.hostname)){if(w)w.close();alert("เปิดหน้าสินค้า Shopee หรือ Lazada ก่อน แล้วกดปุ่ม ส่งเข้า ViralFlow");return}
if(w)w.document.body.innerHTML="<p style='font:20px sans-serif;padding:24px'>กำลังส่งสินค้าเข้า ViralFlow…</p>";
function all(s){return Array.prototype.slice.call(document.querySelectorAll(s))}
var ld=all('script[type="application/ld+json"]').map(function(s){return s.textContent||""});
var metas=all('meta[property^="og:"],meta[name="description"]').map(function(m){return m.outerHTML});
var html="<html><head><title>"+document.title.replace(/</g,"")+"</title>"+metas.join("")+ld.map(function(t){return '<script type="application/ld+json">'+t+"</scr"+"ipt>"}).join("")+"</head></html>";
function full(raw){var u=String(raw||"").replace(/^\/\//,"https://");var m=/^(https:\/\/[^/]+susercontent\.com\/file\/[\w-]+?)(_tn)?(@.*)?$/.exec(u);if(m)return m[1];return u.replace(/_\d+x\d+q\d+\.(jpg|png|webp)(_\.webp)?$/i,"").split("?")[0]}
var main=[];
ld.forEach(function(t){try{[].concat(JSON.parse(t)).forEach(function(o){if(o&&o["@type"]==="Product"&&o.image)main=main.concat(o.image)})}catch(e){}});
var og=document.querySelector('meta[property="og:image"]');if(og&&og.content)main.push(og.content);
main=main.map(full);
function family(u){var m=/\/file\/([a-z]+-\d+)-/.exec(u);return m?m[1]:null}
var fams={};main.forEach(function(u){var f=family(u);if(f)fams[f]=1});
var imgs=all("img");
var gallery=imgs.map(function(i){return full(i.currentSrc||i.src)}).filter(function(u){var f=family(u);return!!f&&fams[f]===1});
var large=imgs.filter(function(i){return i.naturalWidth>=400&&i.naturalHeight>=400}).map(function(i){return full(i.currentSrc||i.src)});
var seen={},images=[];main.concat(gallery,large).forEach(function(u){if(/^https:\/\//.test(u)&&!seen[u]&&images.length<12){seen[u]=1;images.push(u)}});
var h=document.querySelector("h1"),h1=h?h.innerText:"";
var photos=[];
function send(){var f=document.createElement("form");f.method="POST";f.action=origin+"/api/product-capture";f.enctype="multipart/form-data";f.acceptCharset="UTF-8";f.target=w?"viralflow-capture":"_blank";f.style.display="none";
var d=document.createElement("textarea");d.name="data";d.value=JSON.stringify({finalUrl:location.origin+location.pathname,html:html,dom:{title:document.title.slice(0,500),h1:h1.slice(0,500),images:images},images:photos});
f.appendChild(d);document.body.appendChild(f);f.submit();f.remove()}
function next(i){if(i>=images.length||photos.length>=4)return send();
fetch(images[i]).then(function(r){return r.ok?r.blob():null}).then(function(b){if(!b||!/^image\/(jpeg|png|webp)$/.test(b.type)||b.size>800000)return next(i+1);
var r=new FileReader();r.onload=function(){photos.push({url:images[i],base64:String(r.result).split(",")[1]||""});next(i+1)};r.onerror=function(){next(i+1)};r.readAsDataURL(b)})["catch"](function(){next(i+1)})}
next(0)})`;

/** A `javascript:` bookmark for the given ViralFlow origin (https only). */
export function bookmarkletHref(origin: string) {
  const code = `${CAPTURE_CODE.replace(/\n/g, "")}(${JSON.stringify(origin)})`;
  return `javascript:${encodeURIComponent(code)}`;
}
