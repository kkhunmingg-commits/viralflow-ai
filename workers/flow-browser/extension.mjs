/**
 * The "ViralFlow" Chrome extension, written by the worker into chrome-extension/ next to this file (the Windows
 * installer writes it there too and asks once to load that folder in Chrome; updates of the worker rewrite it and the
 * extension reloads itself).
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

export const EXTENSION_VERSION = "1.3.0";
export const EXTENSION_DIR = "chrome-extension";

const SHOPEE = ["co.th", "com.my", "sg", "ph", "vn", "co.id", "com", "tw", "com.br"].flatMap(tld => [`https://shopee.${tld}/*`, `https://*.shopee.${tld}/*`]);
const LAZADA = ["co.th", "com.my", "sg", "com.ph", "vn", "co.id"].flatMap(tld => [`https://lazada.${tld}/*`, `https://*.lazada.${tld}/*`]);
/** 25 Nov (Lucky): TikTok Shop's own web pages, where the best-sellers (with TikTok's sales numbers) are read. */
const TIKTOK_SHOP = ["https://shop.tiktok.com/*"];
/** 19 Nov (Lucky): where the extension posts finished clips, signed in as the user (no API keys). */
const SOCIAL = ["https://www.facebook.com/*", "https://web.facebook.com/*", "https://www.instagram.com/*", "https://studio.youtube.com/*"];
/** Where each platform's own "new reel / upload" page is. */
const SOCIAL_START = { FACEBOOK: "https://www.facebook.com/reels/create/", INSTAGRAM: "https://www.instagram.com/", YOUTUBE: "https://studio.youtube.com/" };

/* global chrome */
/**
 * Service worker: opens the shop tab for a ViralFlow page, passes the capture back, closes tabs. It also posts the
 * user's approved clips: about once a minute it asks ViralFlow (with the user's own sign-in) for the next clip to post
 * from this Chrome, opens that platform's upload page in a tab, and social.js there does what a person would do.
 */
function background({ portal, start }) {
  const store = chrome.storage.session;
  const get = async key => (await store.get(key))[key];
  const api = portal + "/api/social-post/browser";
  const POST_LIMIT_MS = 25 * 60_000;
  async function report(task, result) {
    try {
      await fetch(api, { method: "POST", credentials: "include", headers: { "content-type": "application/json", "x-viralflow-extension": "1" },
        body: JSON.stringify({ jobId: task.jobId, platform: task.platform, ok: !!result.ok, url: result.url || null, error: result.ok ? null : String(result.error || "UI").slice(0, 280) }) });
    } catch { /* the server marks a post nobody reported as "unknown" after 20 minutes */ }
  }
  async function finish(tabId, result) {
    const posting = await get("posting");
    if (!posting || posting.tabId !== tabId) return;
    await store.remove("posting");
    await report(posting.task, result);
    setTimeout(() => chrome.tabs.remove(tabId).catch(() => {}), result.ok ? 4000 : 15000);
    setTimeout(poll, 8000);
  }
  async function poll() {
    const posting = await get("posting");
    if (posting) {
      // A sign-in page (accounts.google.com, …) has no ViralFlow script: a post that never started means "sign in first".
      if (!posting.started && Date.now() - posting.at > 120_000) { await finish(posting.tabId, { ok: false, error: "LOGIN" }); return; }
      if (Date.now() - posting.at < POST_LIMIT_MS) return;
      // The page never answered: give up on it (it may have posted, so it is not tried again).
      await finish(posting.tabId, { ok: false, error: posting.published ? "UNKNOWN" : "TIMEOUT" });
      return;
    }
    let body;
    try {
      const response = await fetch(api, { credentials: "include", headers: { "x-viralflow-extension": "1" }, cache: "no-store" });
      body = await response.json();
    } catch { return; }
    const task = body && body.task;
    if (!task || !start[task.platform]) return;
    const tab = await chrome.tabs.create({ url: start[task.platform], active: true });
    await store.set({ posting: { tabId: tab.id, task, at: Date.now(), started: false, published: false } });
  }
  /**
   * 19 Nov (Lucky: install once): the clip maker on this computer rewrites this folder whenever it updates itself.
   * An unpacked extension serves its files straight from the folder, so a newer manifest there means: reload now.
   */
  async function reloadIfUpdated() {
    try {
      const disk = await (await fetch(chrome.runtime.getURL("manifest.json"), { cache: "no-store" })).json();
      if (disk.version && disk.version !== chrome.runtime.getManifest().version && !(await get("posting"))) { chrome.runtime.reload(); return true; }
    } catch { /* folder being rewritten: try next minute */ }
    return false;
  }
  chrome.alarms.create("vf-post", { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener(async alarm => { if (alarm.name === "vf-post" && !(await reloadIfUpdated())) poll(); });
  chrome.runtime.onStartup.addListener(poll);
  chrome.runtime.onInstalled.addListener(poll);
  chrome.tabs.onRemoved.addListener(async tabId => {
    const posting = await get("posting");
    if (posting && posting.tabId === tabId) await finish(tabId, { ok: false, error: posting.published ? "UNKNOWN" : "STOPPED" });
  });
  /**
   * 25 Nov: "ดึงสินค้าขายดีจาก TikTok" on ViralFlow opens TikTok Shop's best-seller pages one at a time in background
   * tabs of this Chrome, tiktok.js there reads the listed products (what the page already shows), the tab closes, and
   * each page's products go back to the ViralFlow tab, which saves them with the owner's sign-in.
   */
  const ttWaiting = new Map();
  let ttRunning = false;
  async function ttPull(vfTab, urls) {
    if (ttRunning) return;
    ttRunning = true;
    try {
      for (let i = 0; i < urls.length; i++) {
        let tab = null;
        const items = await new Promise(async done => {
          const timer = setTimeout(() => done([]), 30_000);
          try {
            tab = await chrome.tabs.create({ url: urls[i], active: false, openerTabId: vfTab });
            ttWaiting.set(tab.id, list => { clearTimeout(timer); done(list || []); });
          } catch { clearTimeout(timer); done([]); }
        });
        if (tab) { ttWaiting.delete(tab.id); await chrome.tabs.remove(tab.id).catch(() => {}); }
        try { await chrome.tabs.sendMessage(vfTab, { type: "vf-tt-batch", items, done: i + 1, total: urls.length }); } catch { return; }
        await new Promise(r => setTimeout(r, 1500));
      }
    } finally { ttRunning = false; }
  }
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    const tabId = sender.tab && sender.tab.id;
    const work = async () => {
      if (msg.type === "vf-tt-pull") { if (ttRunning) return { ok: false, busy: true }; if (Array.isArray(msg.urls) && tabId) ttPull(tabId, msg.urls.filter(u => /^https:\/\/shop\.tiktok\.com\//.test(u)).slice(0, 40)); return { ok: true }; }
      if (msg.type === "vf-tt-pending") return { pending: ttWaiting.has(tabId) };
      if (msg.type === "vf-tt-items") { const done = ttWaiting.get(tabId); if (done) done(msg.items); return { ok: !!done }; }
      if (msg.type === "vf-tt-manual") {
        const vf = await chrome.tabs.create({ url: portal + "/product-clips/tiktok?import=1", active: true, openerTabId: tabId });
        await store.set({ ["ttmanual:" + vf.id]: { items: msg.items, at: Date.now() } });
        return { ok: true };
      }
      if (msg.type === "vf-tt-hello") {
        const got = await get("ttmanual:" + tabId);
        if (got) await store.remove("ttmanual:" + tabId);
        return got ? { items: got.items } : {};
      }
      if (msg.type === "vf-kick") { setTimeout(poll, 500); return { ok: true }; }
      if (msg.type === "vf-task") {
        const posting = await get("posting");
        if (!posting || posting.tabId !== tabId) return {};
        await store.set({ posting: { ...posting, started: true } });
        return { task: posting.task, step: posting.step || null };
      }
      if (msg.type === "vf-step") {
        const posting = await get("posting");
        if (posting && posting.tabId === tabId) await store.set({ posting: { ...posting, step: msg.step || null, published: posting.published || !!msg.published } });
        return { ok: true };
      }
      if (msg.type === "vf-posted") { await finish(tabId, msg.result || { ok: false }); return { ok: true }; }
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
  document.documentElement.dataset.vfVersion = chrome.runtime.getManifest().version;
  // A clip was just approved for posting (or the page was opened): look for work now instead of within a minute.
  try { chrome.runtime.sendMessage({ type: "vf-kick" }); } catch { /* extension reloading */ }
  const tt = document.getElementById("vf-tt");
  if (tt) {
    // 25 Nov: ViralFlow's TikTok Shop page. Pull best-sellers from TikTok Shop's pages, or save what the owner sent from one.
    const status = text => { const el = document.getElementById("vf-tt-status"); if (el) { el.hidden = false; el.textContent = text; } };
    const save = async items => {
      const response = await fetch("/api/tiktok-shop/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items }) });
      const body = await response.json().catch(() => ({}));
      return { ok: response.ok && !!body.ok, saved: Number(body.saved) || 0, text: body.message || "บันทึกไม่สำเร็จ" };
    };
    let total = 0;
    chrome.runtime.onMessage.addListener(msg => {
      if (!msg || msg.type !== "vf-tt-batch") return;
      (async () => {
        if (msg.items && msg.items.length) { const r = await save(msg.items); total += r.saved; }
        status(`กำลังดึงสินค้าขายดีจาก TikTok Shop… หน้า ${msg.done}/${msg.total} · ได้แล้ว ${total} รายการ`);
        if (msg.done === msg.total) { status(`ดึงเสร็จแล้ว ได้สินค้า ${total} รายการ กำลังโหลดรายการใหม่…`); setTimeout(() => location.reload(), 1500); }
      })();
    });
    const button = document.getElementById("vf-tt-pull");
    if (button) {
      button.disabled = false;
      button.onclick = async () => {
        let urls = [];
        try { urls = JSON.parse(tt.dataset.urls || "[]"); } catch { /* none */ }
        button.disabled = true; total = 0;
        status("กำลังเปิดหน้า TikTok Shop ในแท็บเบื้องหลัง (หน้าละไม่เกิน 30 วิ)…");
        chrome.runtime.sendMessage({ type: "vf-tt-pull", urls });
      };
    }
    (async () => {
      for (let i = 0; i < 4; i++) {
        const answer = await new Promise(done => chrome.runtime.sendMessage({ type: "vf-tt-hello" }, a => done(a || {})));
        if (answer.items) { const r = await save(answer.items); location.href = "/product-clips/tiktok?msg=" + encodeURIComponent(r.text); return; }
        await new Promise(r => setTimeout(r, 700));
      }
    })();
    return;
  }
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

/**
 * On TikTok Shop's web pages (shop.tiktok.com): read the products the page lists, with the numbers TikTok Shop shows
 * (price, sold, rating). Automatically in a tab ViralFlow opened for "ดึงสินค้าขายดี", or by the owner's button.
 * Reads only the page's own product data; never cookies or sign-ins.
 */
function tiktokPage() {
  const send = msg => new Promise(done => { try { chrome.runtime.sendMessage(msg, answer => done(answer || {})); } catch { done({}); } });
  const wait = ms => new Promise(done => setTimeout(done, ms));
  const category = () => { const m = /\/c\/([a-z0-9-]+)\//.exec(location.pathname); return m ? m[1] : null; };
  const first = list => (Array.isArray(list) && typeof list[0] === "string" ? list[0] : null);
  function fromData() {
    const out = [];
    for (const id of ["__MODERN_ROUTER_DATA__", "__MODERN_SSR_DATA__"]) {
      const el = document.getElementById(id);
      if (!el) continue;
      let data;
      try { data = JSON.parse(el.textContent || ""); } catch { continue; }
      const walk = (o, depth) => {
        if (!o || typeof o !== "object" || depth > 18 || out.length > 600) return;
        if (Array.isArray(o)) { for (const x of o) walk(x, depth + 1); return; }
        if (o.product_id && typeof o.title === "string" && (o.sold_info || o.product_price_info)) {
          const price = o.product_price_info || {}, rate = o.rate_info || {}, seo = o.seo_url || {};
          out.push({ productId: String(o.product_id), title: o.title, shopName: (o.seller_info && o.seller_info.shop_name) || null,
            price: price.sale_price_decimal || null, originalPrice: price.origin_price_decimal || null,
            sold: o.sold_info ? o.sold_info.sold_count : null, rating: rate.score || null, reviews: rate.review_count || null,
            image: o.image ? first(o.image.url_list) : null, url: seo.canonical_url || null, category: category() });
          return;
        }
        for (const k in o) walk(o[k], depth + 1);
      };
      walk(data, 0);
    }
    return out;
  }
  /** Products loaded while scrolling are only on screen (no numbers): kept so the owner can still pick them. */
  function fromCards(known) {
    const out = [];
    for (const a of Array.prototype.slice.call(document.querySelectorAll('a[href*="/pdp/"]'))) {
      const m = /\/pdp\/(?:[^/]+\/)?(\d{6,30})/.exec(a.pathname);
      if (!m || known.has(m[1])) continue;
      const title = (a.innerText || "").split("\n").map(t => t.trim()).filter(t => t.length > 5)[0];
      const img = a.querySelector("img");
      if (title) { known.add(m[1]); out.push({ productId: m[1], title: title.slice(0, 300), image: img ? img.currentSrc || img.src : null, url: a.href, category: category() }); }
    }
    return out;
  }
  const collect = () => { const list = fromData(); return list.concat(fromCards(new Set(list.map(i => i.productId)))); };
  (async () => {
    let pending = false;
    for (let i = 0; i < 3 && !pending; i++) { pending = !!(await send({ type: "vf-tt-pending" })).pending; if (!pending) await wait(600); }
    if (pending) { await wait(2500); return send({ type: "vf-tt-items", items: collect() }); }
    const b = document.createElement("button");
    b.id = "vf-tt-send";
    b.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647;padding:14px 20px;border:0;border-radius:14px;background:#ff3b6b;color:#fff;font:700 16px system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.3);cursor:pointer";
    b.textContent = "⚡ ส่งสินค้าหน้านี้เข้า ViralFlow";
    b.onclick = async () => {
      const items = collect();
      if (!items.length) { b.textContent = "หน้านี้ไม่มีรายการสินค้า"; setTimeout(() => { b.textContent = "⚡ ส่งสินค้าหน้านี้เข้า ViralFlow"; }, 2500); return; }
      b.disabled = true; b.textContent = `กำลังส่ง ${items.length} รายการ…`;
      await send({ type: "vf-tt-manual", items });
      b.disabled = false; b.textContent = "⚡ ส่งสินค้าหน้านี้เข้า ViralFlow";
    };
    document.body.appendChild(b);
  })();
}

/**
 * On Facebook, Instagram and YouTube Studio: only in a tab the extension opened to post a clip (any other page is
 * left alone). Does what a person would do in the platform's own upload page, signed in as the user, with an overlay
 * that says ViralFlow is working and a STOP button. Never reads cookies or passwords.
 */
function socialPage() {
  const send = msg => new Promise(done => { try { chrome.runtime.sendMessage(msg, answer => done(answer || {})); } catch { done({}); } });
  const wait = ms => new Promise(done => setTimeout(done, ms));
  const host = location.hostname;
  const platform = /facebook\.com$/.test(host) ? "FACEBOOK" : /instagram\.com$/.test(host) ? "INSTAGRAM" : /youtube\.com$/.test(host) ? "YOUTUBE" : null;
  if (!platform) return;
  let stopped = false, overlay = null, stepText = null;
  class Stop extends Error {}
  const fail = code => { throw new Stop(code); };

  function showOverlay(task) {
    overlay = document.createElement("div");
    overlay.id = "vf-overlay";
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483646;pointer-events:none;background:rgba(5,10,20,.35);display:flex;align-items:center;justify-content:center";
    const card = document.createElement("div");
    card.style.cssText = "pointer-events:auto;min-width:300px;max-width:420px;padding:18px 22px;border-radius:16px;background:#0b1220;color:#e6fff4;border:1px solid #1ee6a0;box-shadow:0 0 32px rgba(30,230,160,.45);font:600 14px system-ui,sans-serif;text-align:center";
    const spin = document.createElement("div");
    spin.style.cssText = "width:34px;height:34px;margin:0 auto 10px;border-radius:50%;border:3px solid rgba(30,230,160,.25);border-top-color:#1ee6a0;animation:vfspin 1s linear infinite";
    const style = document.createElement("style");
    style.textContent = "@keyframes vfspin{to{transform:rotate(360deg)}}";
    const title = document.createElement("div");
    title.textContent = "ViralFlow กำลังทำงานอยู่…";
    title.style.cssText = "color:#1ee6a0;font-size:16px;margin-bottom:4px";
    const what = document.createElement("div");
    what.textContent = "โพสต์ “" + task.name + "”";
    what.style.cssText = "font-weight:500;opacity:.9";
    stepText = document.createElement("div");
    stepText.style.cssText = "font-weight:500;opacity:.75;margin:6px 0 10px;font-size:13px";
    const note = document.createElement("div");
    note.textContent = "อย่าปิดแท็บนี้ · กด STOP เพื่อหยุด";
    note.style.cssText = "font-weight:500;opacity:.6;font-size:12px;margin-bottom:10px";
    const stop = document.createElement("button");
    stop.textContent = "STOP";
    stop.style.cssText = "padding:8px 22px;border:0;border-radius:10px;background:#ff3b6b;color:#fff;font:700 14px system-ui,sans-serif;cursor:pointer";
    stop.onclick = () => { stopped = true; stop.disabled = true; stop.textContent = "กำลังหยุด…"; };
    card.append(style, spin, title, what, stepText, note, stop);
    overlay.append(card);
    document.documentElement.append(overlay);
  }
  const step = (text, published) => { if (stepText) stepText.textContent = text; send({ type: "vf-step", step: text, published: !!published }); };

  const shown = el => !!el && el.isConnected && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden" && !(overlay && overlay.contains(el));
  async function until(find, timeoutMs, code) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      if (stopped) fail("STOPPED");
      let found = null;
      try { found = find(); } catch { found = null; }
      if (found) return found;
      if (Date.now() > end) fail(code);
      await wait(700);
    }
  }
  const all = (selector, root) => Array.prototype.slice.call((root || document).querySelectorAll(selector));
  const disabled = el => el.disabled || el.getAttribute("aria-disabled") === "true" || !!el.closest('[aria-disabled="true"]');
  /** A visible button whose own words (aria-label or text) are exactly one of `words`; the innermost one wins. */
  function button(words, root, { enabled = true } = {}) {
    const re = new RegExp("^(" + words.join("|") + ")$", "i");
    const list = all('button,[role="button"],a[role="link"],[role="menuitem"],[role="tab"]', root).filter(el => shown(el) && (re.test((el.getAttribute("aria-label") || "").trim()) || re.test((el.innerText || "").replace(/\s+/g, " ").trim())));
    const inner = list.filter(el => !list.some(other => other !== el && el.contains(other)));
    const pick = inner.find(el => !enabled || !disabled(el));
    return pick || null;
  }
  function click(el) {
    el.scrollIntoView({ block: "center" });
    const at = el.getBoundingClientRect(), opts = { bubbles: true, cancelable: true, view: window, clientX: at.left + at.width / 2, clientY: at.top + at.height / 2 };
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) el.dispatchEvent(new (type.startsWith("pointer") ? PointerEvent : MouseEvent)(type, opts));
    el.click();
  }
  function setFile(input, file) {
    const data = new DataTransfer();
    data.items.add(file);
    input.files = data.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function typeInto(el, text, replace) {
    el.focus();
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const setter = Object.getOwnPropertyDescriptor(el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value").set;
      setter.call(el, replace ? text : el.value + text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    if (replace) document.execCommand("selectAll", false);
    // Line by line: the platforms' editors turn Enter into a new paragraph.
    text.split("\n").forEach((line, i) => {
      if (i && !document.execCommand("insertParagraph", false)) document.execCommand("insertLineBreak", false);
      if (line) document.execCommand("insertText", false, line);
    });
  }
  const pageSays = re => re.test(document.body ? document.body.innerText : "");
  const videoInput = root => all('input[type="file"]', root).find(i => /video|mp4|\*/.test(i.accept || "*")) || null;

  async function video(task) {
    step("กำลังโหลดไฟล์คลิป…");
    try {
      const response = await fetch(task.videoUrl, { cache: "no-store" });
      if (!response.ok) fail("NO_VIDEO: HTTP " + response.status);
      const blob = await response.blob();
      if (blob.size < 1000) fail("NO_VIDEO: empty");
      return new File([blob], "viralflow-clip.mp4", { type: "video/mp4" });
    } catch (error) { if (error instanceof Stop) throw error; fail("NO_VIDEO: " + String(error).slice(0, 80)); }
  }

  // ------------------------------------------------------------ Facebook Reels (the profile or Page the user is using)
  const NEXT = ["Next", "ถัดไป"];
  async function facebook(task) {
    if (document.querySelector('form[action*="login"] input[name="email"], input[name="pass"]') || /\/login/.test(location.pathname)) fail("LOGIN");
    const file = await video(task);
    step("กำลังอัปโหลดคลิปไป Facebook…");
    const input = await until(() => videoInput(), 60_000, "UI: no upload box");
    setFile(input, file);
    const box = () => all('[contenteditable="true"][role="textbox"]').find(shown);
    // Upload, then the edit step; the description box is on the last step.
    for (let i = 0; i < 4 && !box(); i++) {
      const next = await until(() => box() || button(NEXT), 10 * 60_000, "UI: no Next button");
      if (next === box()) break;
      click(next);
      await wait(2500);
    }
    step("กำลังใส่แคปชัน…");
    const text = await until(box, 60_000, "UI: no description box");
    typeInto(text, task.caption, true);
    await wait(1200);
    const publish = await until(() => button(["Publish", "เผยแพร่", "Share now", "แชร์เลย", "Post", "โพสต์"]), 10 * 60_000, "UI: no Publish button");
    const start = location.href;
    step("กำลังเผยแพร่…", true);
    click(publish);
    await until(() => location.href !== start || pageSays(/Your reel (is|was) (published|shared|live)|reel.{0,20}published|เผยแพร่รีล.{0,20}แล้ว|รีลของคุณ.{0,30}(แล้ว|เผยแพร่)/i)
      || !document.contains(publish) || !shown(publish), 5 * 60_000, "TIMEOUT");
    await wait(3000);
    return { ok: true, url: null };
  }

  // ------------------------------------------------------------ Instagram Reels
  async function instagram(task) {
    if (/\/accounts\/login/.test(location.pathname) || document.querySelector('input[name="username"]')) fail("LOGIN");
    const file = await video(task);
    step("กำลังเปิดหน้าสร้างโพสต์ Instagram…");
    const create = await until(() => {
      const svg = all("svg[aria-label]").find(s => /^(New post|Create|โพสต์ใหม่|สร้าง)$/i.test(s.getAttribute("aria-label")) && shown(s));
      return svg ? svg.closest('a,[role="link"],[role="button"],button') || svg : null;
    }, 60_000, "UI: no Create button");
    click(create);
    await wait(1500);
    const dialog = () => all('[role="dialog"]').filter(shown).pop() || null;
    for (let i = 0; i < 8 && !videoInput(dialog() || document); i++) {
      const item = button(["Post", "โพสต์"]);
      if (item) { click(item); await wait(1500); } else await wait(700);
    }
    const input = await until(() => videoInput(dialog() || document), 30_000, "UI: no upload box");
    step("กำลังอัปโหลดคลิปไป Instagram…");
    setFile(input, file);
    const caption = () => all('[contenteditable="true"][role="textbox"]', dialog() || document).find(shown);
    for (let i = 0; i < 5 && !caption(); i++) {
      const next = await until(() => caption() || button(["OK", "ตกลง"], dialog() || document) || button(NEXT, dialog() || document), 5 * 60_000, "UI: no Next button");
      if (next === caption()) break;
      click(next);
      await wait(2500);
    }
    step("กำลังใส่แคปชัน…");
    typeInto(await until(caption, 60_000, "UI: no caption box"), task.caption.slice(0, 2200), true);
    await wait(1200);
    const share = await until(() => button(["Share", "แชร์"], dialog() || document), 60_000, "UI: no Share button");
    step("กำลังแชร์…", true);
    click(share);
    await until(() => pageSays(/(reel|post) has been shared|Your (reel|post) has been shared|แชร์(รีล|โพสต์)ของคุณแล้ว|ถูกแชร์แล้ว|แชร์แล้ว/i)
      || all('img[alt*="checkmark" i]').some(shown), 10 * 60_000, "TIMEOUT");
    await wait(2000);
    return { ok: true, url: null };
  }

  // ------------------------------------------------------------ YouTube Shorts (YouTube Studio)
  async function youtube(task) {
    const file = await video(task);
    step("กำลังเปิดหน้าอัปโหลด YouTube…");
    let input = videoInput();
    if (!input) {
      const create = await until(() => document.querySelector("#create-icon, ytcp-button#create-icon") || button(["Create", "สร้าง"]), 60_000, "LOGIN");
      click(create);
      await wait(1200);
      const upload = await until(() => document.querySelector("#text-item-0, tp-yt-paper-item#text-item-0") || button(["Upload videos", "อัปโหลดวิดีโอ"]), 20_000, "UI: no Upload item");
      click(upload);
      input = await until(() => videoInput(), 30_000, "UI: no upload box");
    }
    step("กำลังอัปโหลดคลิปไป YouTube…");
    setFile(input, file);
    const title = await until(() => all("#title-textarea #textbox, ytcp-social-suggestions-textbox#title-textarea [contenteditable]").find(shown), 3 * 60_000, "UI: no title box");
    step("กำลังใส่ชื่อและคำอธิบาย…");
    await wait(1500);
    typeInto(title, task.title, true);
    const description = all("#description-textarea #textbox, ytcp-social-suggestions-textbox#description-textarea [contenteditable]").find(shown);
    if (description) typeInto(description, task.caption.slice(0, 4900), true);
    const radio = name => all('tp-yt-paper-radio-button[name="' + name + '"]').find(shown);
    click(await until(() => radio("VIDEO_MADE_FOR_KIDS_NOT_MFK"), 30_000, "UI: no made-for-kids choice"));
    // AI-made footage: answer YouTube's "altered or synthetic content" question with yes, where Studio asks it.
    let altered = radio("VIDEO_HAS_ALTERED_CONTENT_YES");
    if (!altered) { const more = document.querySelector("#toggle-button"); if (more && shown(more)) { click(more); await wait(800); altered = radio("VIDEO_HAS_ALTERED_CONTENT_YES"); } }
    if (altered) click(altered);
    for (let i = 0; i < 4 && !radio("PUBLIC"); i++) {
      click(await until(() => { const b = document.querySelector("#next-button"); return b && shown(b) && !disabled(b) ? b : null; }, 60_000, "UI: no Next button"));
      await wait(1500);
    }
    click(await until(() => radio("PUBLIC"), 30_000, "UI: no Public choice"));
    const link = all('a[href*="youtu"]').map(a => a.href).find(h => /youtu\.be\/|\/shorts\/|watch\?v=/.test(h)) || null;
    step("รออัปโหลดเสร็จ (อย่าปิดแท็บ)…");
    // Studio keeps uploading in this tab: wait until the file is fully sent before pressing Publish.
    await until(() => {
      const progress = all("ytcp-video-upload-progress, .progress-label").map(el => el.innerText || "").join(" ");
      return !/Uploading|กำลังอัปโหลด|\d+%/i.test(progress);
    }, 20 * 60_000, "TIMEOUT");
    const done = await until(() => { const b = document.querySelector("#done-button"); return b && shown(b) && !disabled(b) ? b : null; }, 5 * 60_000, "UI: no Publish button");
    step("กำลังเผยแพร่…", true);
    click(done);
    await until(() => document.querySelector("ytcp-video-share-dialog, ytcp-uploads-still-processing-dialog, ytcp-prechecks-warning-dialog")
      || !document.querySelector("ytcp-uploads-dialog"), 5 * 60_000, "TIMEOUT");
    await wait(2000);
    return { ok: true, url: link };
  }

  (async () => {
    // Pages load in steps (and Studio can redirect): ask a few times whether this tab was opened to post.
    let answer = {};
    for (let i = 0; i < 4 && !answer.task; i++) { answer = await send({ type: "vf-task" }); if (!answer.task) await wait(1500); }
    const task = answer.task;
    if (!task || task.platform !== platform) return;
    showOverlay(task);
    let result;
    try {
      await wait(2500);
      result = await (platform === "FACEBOOK" ? facebook : platform === "INSTAGRAM" ? instagram : youtube)(task);
      step("✓ โพสต์แล้ว ปิดแท็บนี้ให้เองใน 4 วินาที");
    } catch (error) {
      const code = error instanceof Stop ? error.message : "UI: " + String(error && error.message || error).slice(0, 120);
      result = { ok: false, error: code };
      step("✗ ไม่สำเร็จ: " + code);
    }
    await send({ type: "vf-posted", result });
  })();
}

const run = (fn, arg) => `(${fn.toString()})(${arg === undefined ? "" : JSON.stringify(arg)});\n`;

/** The extension's files for the given ViralFlow origin (the worker's FLOW_PORTAL_URL). */
export function extensionFiles(portal, { icon = false } = {}) {
  const origin = new URL(portal).origin;
  const manifest = {
    manifest_version: 3, name: "ViralFlow", version: EXTENSION_VERSION,
    description: "ส่งสินค้าจาก Shopee/Lazada และสินค้าขายดีจาก TikTok Shop เข้า ViralFlow และโพสต์คลิปที่คุณกดผ่านไป Facebook, Instagram, YouTube ด้วยบัญชีใน Chrome ของคุณ",
    permissions: ["storage", "alarms"],
    host_permissions: [`${origin}/*`, ...SHOPEE, ...LAZADA, ...SOCIAL, ...TIKTOK_SHOP],
    ...(icon ? { icons: { 128: "icon-128.png" }, action: { default_icon: { 128: "icon-128.png" }, default_title: "ViralFlow" } } : {}),
    background: { service_worker: "background.js" },
    content_scripts: [
      { matches: [`${origin}/product-clips*`], js: ["viralflow.js"], run_at: "document_idle" },
      { matches: [...SHOPEE, ...LAZADA], js: ["shop.js"], run_at: "document_idle" },
      { matches: SOCIAL, js: ["social.js"], run_at: "document_idle" },
      { matches: TIKTOK_SHOP, js: ["tiktok.js"], run_at: "document_idle" },
    ],
  };
  return {
    "manifest.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "background.js": run(background, { portal: origin, start: SOCIAL_START }),
    "viralflow.js": run(viralflowPage),
    "shop.js": run(shopPage),
    "social.js": run(socialPage),
    "tiktok.js": run(tiktokPage),
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
