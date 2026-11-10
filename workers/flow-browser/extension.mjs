/**
 * The "ViralFlow ส่งสินค้า" Chrome extension, written by the worker into chrome-extension/ next to this file.
 *
 * Shopee shows its product pages to the owner's own Chrome but blocks automated windows. So for a Shopee link the worker
 * opens ViralFlow's /product-clips/fetch?job=… page in the owner's normal Chrome (their own sign-ins); this extension
 * then opens the product link in a tab, reads what the page already shows (name, description, listing photos), hands it
 * to the ViralFlow tab, which posts it with the owner's ViralFlow sign-in, and closes both tabs. It never reads cookies
 * or passwords of the shop. On a product page the owner opens themselves it adds a "⚡ ส่งเข้า ViralFlow" button.
 *
 * The three scripts are plain functions turned into text (this file is shipped as is, never bundled).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const EXTENSION_VERSION = "1.1.0";
export const EXTENSION_DIR = "chrome-extension";

const SHOPEE = ["co.th", "com.my", "sg", "ph", "vn", "co.id", "com", "tw", "com.br"].flatMap(tld => [`https://shopee.${tld}/*`, `https://*.shopee.${tld}/*`]);
const LAZADA = ["co.th", "com.my", "sg", "com.ph", "vn", "co.id"].flatMap(tld => [`https://lazada.${tld}/*`, `https://*.lazada.${tld}/*`]);

/* global chrome */
/** Service worker: opens the shop tab for a ViralFlow page, passes the capture back, closes tabs. */
function background(portal) {
  const store = chrome.storage.session;
  const get = async key => (await store.get(key))[key];
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    const tabId = sender.tab && sender.tab.id;
    const work = async () => {
      if (msg.type === "vf-open") {
        const shop = await chrome.tabs.create({ url: msg.link, active: true, openerTabId: tabId });
        await store.set({ ["shop:" + shop.id]: { vfTab: tabId, job: msg.job || null, at: Date.now() } });
        return { ok: true };
      }
      if (msg.type === "vf-pending") {
        const got = await get("shop:" + tabId);
        return { pending: !!got && Date.now() - got.at < 5 * 60_000 };
      }
      if (msg.type === "vf-captured") {
        const got = await get("shop:" + tabId);
        if (!got) return { ok: false };
        await store.remove("shop:" + tabId);
        await chrome.tabs.sendMessage(got.vfTab, { type: "vf-capture", job: got.job, capture: msg.capture || null, error: msg.error || null, shopTab: tabId });
        return { ok: true };
      }
      if (msg.type === "vf-manual") {
        const vf = await chrome.tabs.create({ url: portal + "/product-clips/fetch?manual=1", active: true, openerTabId: tabId });
        await store.set({ ["manual:" + vf.id]: { capture: msg.capture, at: Date.now() } });
        return { ok: true };
      }
      if (msg.type === "vf-hello") {
        const got = await get("manual:" + tabId);
        if (got) await store.remove("manual:" + tabId);
        return got ? { capture: got.capture } : {};
      }
      if (msg.type === "vf-close") {
        for (const id of msg.tabs || []) if (typeof id === "number") await chrome.tabs.remove(id).catch(() => {});
        if (msg.self && tabId) await chrome.tabs.remove(tabId).catch(() => {});
        return { ok: true };
      }
      return {};
    };
    work().then(reply, error => reply({ ok: false, error: String(error) }));
    return true;
  });
}

/** On ViralFlow's /product-clips/fetch page: open the product, then post what came back with the owner's sign-in. */
function viralflowPage() {
  // Lets ViralFlow's install button show "ติดตั้งแล้ว".
  document.documentElement.dataset.vfExtension = "1";
  const root = document.getElementById("vf-fetch");
  if (!root) return;
  const say = text => { const el = document.getElementById("vf-status"); if (el) el.textContent = text; };
  const send = msg => new Promise(done => chrome.runtime.sendMessage(msg, answer => done(answer || {})));
  const wait = ms => new Promise(done => setTimeout(done, ms));
  async function post(job, capture, error) {
    say("กำลังส่งข้อมูลสินค้าเข้า ViralFlow…");
    try {
      const response = await fetch("/api/product-capture/auto", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jobId: job || undefined, capture: capture || undefined, error: error || undefined }) });
      const body = await response.json().catch(() => ({}));
      const text = body.message || (response.ok ? "ส่งแล้ว" : "ส่งไม่สำเร็จ");
      say(text);
      return { ok: response.ok && !!body.ok, text };
    } catch (cause) {
      say("ส่งไม่สำเร็จ: " + String(cause));
      return { ok: false, text: "ส่งไม่สำเร็จ" };
    }
  }
  chrome.runtime.onMessage.addListener(msg => {
    if (!msg || msg.type !== "vf-capture") return;
    post(msg.job, msg.capture, msg.error).then(async result => {
      await send({ type: "vf-close", tabs: [msg.shopTab] });
      // Opened by the worker: close this tab too once the owner could see the result.
      if (result.ok && root.dataset.auto === "1") { await wait(4000); await send({ type: "vf-close", self: true }); }
    });
  });
  (async () => {
    if (root.dataset.link) {
      say("กำลังเปิดหน้าสินค้าใน Chrome ของคุณ…");
      await send({ type: "vf-open", link: root.dataset.link, job: root.dataset.job });
      say("กำลังอ่านหน้าสินค้า (ไม่เกิน 1 นาที)…");
      return;
    }
    for (let i = 0; i < 6; i++) {
      const answer = await send({ type: "vf-hello" });
      if (answer.capture) {
        const result = await post(null, answer.capture);
        location.href = "/product-clips?msg=" + encodeURIComponent(result.text);
        return;
      }
      await wait(800);
    }
    say("ไม่มีข้อมูลสินค้ารออยู่ เปิดหน้าสินค้า Shopee/Lazada แล้วกดปุ่ม ⚡ ส่งเข้า ViralFlow ที่มุมขวาล่าง");
  })();
}

/** On Shopee/Lazada pages: read the product the page shows (auto for a ViralFlow tab, or by the owner's button). */
function shopPage() {
  const send = msg => new Promise(done => { try { chrome.runtime.sendMessage(msg, answer => done(answer || {})); } catch { done({}); } });
  const wait = ms => new Promise(done => setTimeout(done, ms));
  const all = selector => Array.prototype.slice.call(document.querySelectorAll(selector));
  const ldTexts = () => all('script[type="application/ld+json"]').map(s => s.textContent || "");
  const hasProduct = () => ldTexts().some(t => /"@type"\s*:\s*"Product"/.test(t));
  function full(raw) {
    const url = String(raw || "").replace(/^\/\//, "https://");
    const shopee = /^(https:\/\/[^/]+susercontent\.com\/file\/[\w-]+?)(_tn)?(@.*)?$/.exec(url);
    if (shopee) return shopee[1];
    return url.replace(/_\d+x\d+q\d+\.(jpg|png|webp)(_\.webp)?$/i, "").split("?")[0];
  }
  async function photo(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;
      const blob = await response.blob();
      if (!/^image\/(jpeg|png|webp)$/.test(blob.type) || blob.size > 700_000) return null;
      const data = await new Promise((done, fail) => { const r = new FileReader(); r.onload = () => done(String(r.result)); r.onerror = fail; r.readAsDataURL(blob); });
      return { url, base64: data.split(",")[1] || "" };
    } catch { return null; }
  }
  async function capture() {
    const ld = ldTexts();
    const metas = all('meta[property^="og:"],meta[name="description"]').map(m => m.outerHTML);
    const html = "<html><head><title>" + document.title.replace(/</g, "") + "</title>" + metas.join("")
      + ld.map(t => '<script type="application/ld+json">' + t + "</scr" + "ipt>").join("") + "</head></html>";
    let main = [];
    for (const t of ld) { try { for (const o of [].concat(JSON.parse(t))) if (o && o["@type"] === "Product" && o.image) main = main.concat(o.image); } catch { /* not JSON */ } }
    const og = document.querySelector('meta[property="og:image"]');
    if (og && og.content) main.push(og.content);
    main = main.map(full);
    const family = u => { const m = /\/file\/([a-z]+-\d+)-/.exec(u); return m ? m[1] : null; };
    const families = new Set(main.map(family).filter(Boolean));
    const imgs = all("img");
    const gallery = imgs.map(i => full(i.currentSrc || i.src)).filter(u => families.has(family(u)));
    const large = imgs.filter(i => i.naturalWidth >= 400 && i.naturalHeight >= 400).map(i => full(i.currentSrc || i.src));
    const images = [...new Set(main.concat(gallery, large))].filter(u => /^https:\/\//.test(u)).slice(0, 12);
    const photos = [];
    for (const url of images) { if (photos.length >= 3) break; const p = await photo(url); if (p) photos.push(p); }
    const h = document.querySelector("h1");
    return { finalUrl: location.origin + location.pathname, html, dom: { title: document.title.slice(0, 500), h1: (h ? h.innerText : "").slice(0, 500), images }, images: photos };
  }
  async function auto() {
    for (let i = 0; i < 60 && !hasProduct(); i++) await wait(1000);
    if (!hasProduct()) return send({ type: "vf-captured", error: "PAGE_NOT_READY" });
    // Let the gallery photos load before reading them.
    window.scrollBy(0, 500); await wait(2500); window.scrollTo(0, 0); await wait(500);
    return send({ type: "vf-captured", capture: await capture() });
  }
  function button() {
    if (document.getElementById("vf-send")) return;
    const b = document.createElement("button");
    b.id = "vf-send";
    b.textContent = "⚡ ส่งเข้า ViralFlow";
    b.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647;padding:14px 20px;border:0;border-radius:14px;background:#ff3b6b;color:#fff;font:700 16px system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.3);cursor:pointer";
    b.onclick = async () => {
      b.disabled = true; b.textContent = "กำลังส่ง…";
      await send({ type: "vf-manual", capture: await capture() });
      b.disabled = false; b.textContent = "⚡ ส่งเข้า ViralFlow";
    };
    document.body.appendChild(b);
  }
  (async () => {
    let pending = false;
    for (let i = 0; i < 3 && !pending; i++) { pending = !!(await send({ type: "vf-pending" })).pending; if (!pending) await wait(700); }
    if (pending) return auto();
    // The shop changes pages without reloading: show the button whenever a product is on screen.
    setInterval(() => {
      const shown = document.getElementById("vf-send");
      if (hasProduct()) button(); else if (shown) shown.remove();
    }, 2000);
  })();
}

const run = (fn, arg) => `(${fn.toString()})(${arg === undefined ? "" : JSON.stringify(arg)});\n`;

/** The extension's files for the given ViralFlow origin (the worker's FLOW_PORTAL_URL). */
export function extensionFiles(portal, { icon = false } = {}) {
  const origin = new URL(portal).origin;
  const manifest = {
    manifest_version: 3, name: "ViralFlow ส่งสินค้า", version: EXTENSION_VERSION,
    description: "ส่งชื่อ รูป และรายละเอียดสินค้าจากหน้า Shopee/Lazada ที่เปิดใน Chrome ของคุณเข้า ViralFlow",
    permissions: ["storage"],
    host_permissions: [`${origin}/*`, ...SHOPEE, ...LAZADA],
    ...(icon ? { icons: { 128: "icon-128.png" }, action: { default_icon: { 128: "icon-128.png" }, default_title: "ViralFlow ส่งสินค้า" } } : {}),
    background: { service_worker: "background.js" },
    content_scripts: [
      { matches: [`${origin}/product-clips*`], js: ["viralflow.js"], run_at: "document_idle" },
      { matches: [...SHOPEE, ...LAZADA], js: ["shop.js"], run_at: "document_idle" },
    ],
  };
  return {
    "manifest.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "background.js": run(background, origin),
    "viralflow.js": run(viralflowPage),
    "shop.js": run(shopPage),
  };
}

/** Writes (or refreshes) the extension folder; returns its path. Chrome keeps using a loaded unpacked folder. */
export async function writeExtension(baseDir, portal) {
  const dir = join(baseDir, EXTENSION_DIR);
  await mkdir(dir, { recursive: true });
  for (const [name, text] of Object.entries(extensionFiles(portal))) {
    const old = await readFile(join(dir, name), "utf8").catch(() => null);
    if (old !== text) await writeFile(join(dir, name), text, "utf8");
  }
  return dir;
}
