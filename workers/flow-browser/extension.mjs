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

export const EXTENSION_VERSION = "1.5.4";
export const EXTENSION_DIR = "chrome-extension";

const SHOPEE = ["co.th", "com.my", "sg", "ph", "vn", "co.id", "com", "tw", "com.br"].flatMap(tld => [`https://shopee.${tld}/*`, `https://*.shopee.${tld}/*`]);
const LAZADA = ["co.th", "com.my", "sg", "com.ph", "vn", "co.id"].flatMap(tld => [`https://lazada.${tld}/*`, `https://*.lazada.${tld}/*`]);
/** 25 Nov (Lucky): TikTok Shop's own web pages, where the best-sellers (with TikTok's sales numbers) are read. */
const TIKTOK_SHOP = ["https://shop.tiktok.com/*"];
/** TikTok Shop's LIVE Manager (LIVE console) on the web: where the live basket is filled and products are pinned. */
const LIVE_MANAGER = ["https://shop.tiktok.com/streamer/*"];
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
          // The owner's showcase (LIVE Manager) is read through ~40 list pages, ~4 s each (26 Nov: 1,966 products took
          // about 2.5 minutes): give it 6 minutes.
          const timer = setTimeout(() => done([]), /\/streamer\//.test(urls[i]) ? 360_000 : 30_000);
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
      if (msg.type === "vf-basket") {
        try {
          const response = await fetch(portal + "/api/tiktok-shop/live-basket", { credentials: "include", headers: { "x-viralflow-extension": "1" }, cache: "no-store" });
          const body = await response.json().catch(() => ({}));
          return { ok: response.ok && !!body.ok, signedIn: body.signedIn !== false, products: Array.isArray(body.products) ? body.products : [], pinEverySec: Number(body.pinEverySec) || 180 };
        } catch { return { ok: false, offline: true, products: [] }; }
      }
      if (msg.type === "vf-live-comment") {
        // 27 Nov: TikTok refuses the comment reader on this network, so LIVE Manager's own chat is passed to Praew through
        // the open AI LIVE tab (the Praew control page on this computer only accepts that page's origin).
        const tabs = await chrome.tabs.query({ url: portal + "/ai-live*" });
        if (!tabs.length) return { ok: false, noTab: true };
        try { return await chrome.tabs.sendMessage(tabs[0].id, { type: "vf-live-comment", user: msg.user, text: msg.text }) || { ok: false }; }
        catch { return { ok: false, noTab: true }; }
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
  if (location.pathname.startsWith("/ai-live")) {
    // Comments read from LIVE Manager's chat go to Praew's control page on this computer (it accepts this origin).
    chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
      if (!msg || msg.type !== "vf-live-comment") return;
      fetch("http://127.0.0.1:8760/api/comment", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ user: String(msg.user || "").slice(0, 24), text: String(msg.text || "").slice(0, 200) }) })
        .then(r => reply({ ok: r.ok, status: r.status }), () => reply({ ok: false, offline: true }));
      return true;
    });
    return;
  }
  // A clip was just approved for posting (or the page was opened): look for work now instead of within a minute.
  try { chrome.runtime.sendMessage({ type: "vf-kick" }); } catch { /* extension reloading */ }
  const tt = document.getElementById("vf-tt");
  if (tt) {
    // 25 Nov: ViralFlow's TikTok Shop page. Pull best-sellers from TikTok Shop's pages, or save what the owner sent from one.
    const status = text => { const el = document.getElementById("vf-tt-status"); if (el) { el.hidden = false; el.textContent = text; } };
    const saveChunk = async items => {
      const response = await fetch("/api/tiktok-shop/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items }) });
      const body = await response.json().catch(() => ({}));
      return { ok: response.ok && !!body.ok, saved: Number(body.saved) || 0, text: body.message || "บันทึกไม่สำเร็จ" };
    };
    // A showcase holds up to 2,000 products: send them 400 at a time.
    const save = async items => {
      let last = { ok: false, saved: 0, text: "บันทึกไม่สำเร็จ" }, saved = 0;
      for (let i = 0; i < items.length; i += 400) { last = await saveChunk(items.slice(i, i + 400)); saved += last.saved; }
      return { ...last, saved, text: items.length > 400 && saved ? `ได้สินค้าจาก TikTok Shop ${saved} รายการ` : last.text };
    };
    let total = 0;
    chrome.runtime.onMessage.addListener(msg => {
      if (!msg || msg.type !== "vf-tt-batch") return;
      (async () => {
        if (msg.items && msg.items.length) {
          const r = await save(msg.items); total += r.saved;
          // A whole showcase came back: products it no longer lists lose their mark.
          if (r.saved && msg.items.some(i => i && i.showcase)) {
            await fetch("/api/tiktok-shop/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: [], closeShowcase: true }) }).catch(() => null);
          }
        }
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
    // 26 Nov (Lucky: only products that pay commission): the owner's own showcase in LIVE Manager, with commissions.
    const showcase = document.getElementById("vf-tt-showcase");
    if (showcase) {
      showcase.disabled = false;
      showcase.onclick = () => {
        showcase.disabled = true; total = 0;
        status("กำลังอ่านโชว์เคสของคุณใน LIVE Manager (แท็บเบื้องหลัง ประมาณ 3 นาที อย่าปิดแท็บนั้น)… ต้องล็อกอิน TikTok ใน Chrome นี้");
        chrome.runtime.sendMessage({ type: "vf-tt-pull", urls: [showcase.dataset.url] });
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
 * 26 Nov (Lucky: pin the basket automatically): on TikTok Shop's LIVE Manager (shop.tiktok.com/streamer/…), signed in
 * as the owner. Every 15 s it asks ViralFlow for the live basket (the owner's switched-on TikTok picks), adds any that
 * are missing to the LIVE product list through LIVE Manager's own "Product URL" box, and while the owner is live it
 * pins the next one every few minutes; Praew presents whatever is pinned. It only adds and pins: it never removes a
 * product, never starts or ends a live, and a button on the page pauses it. Never reads cookies or passwords.
 */
function liveManagerPage() {
  const send = msg => new Promise(done => { try { chrome.runtime.sendMessage(msg, answer => done(answer || {})); } catch { done({}); } });
  const wait = ms => new Promise(done => setTimeout(done, ms));
  /**
   * In a tab ViralFlow opened to read the owner's showcase: list every showcase product with its commission, through
   * the same list LIVE Manager's "Showcase products" page loads (the owner's own sign-in, read only), and hand it back.
   */
  async function readShowcase() {
    const num = v => { const m = String(v == null ? "" : v).replace(/,/g, "").match(/\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; };
    const get = url => new Promise(done => { const x = new XMLHttpRequest(); x.open("GET", url); x.withCredentials = true;
      x.onload = () => { try { done(JSON.parse(x.responseText)); } catch { done(null); } }; x.onerror = () => done(null); x.send(); });
    // The list sometimes says has_more: false early or answers a page empty: read up to data.total, each page up to 4 tries.
    const byId = new Map();
    let total = null;
    for (let offset = 0; offset < 2500 && (total == null || offset < total); offset += 50) {
      let data = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        const body = await get(`/api/v1/streamer_desktop/search_product/list?size=50&offset=${offset}&origin=2&user_language=en&locale=en&aid=253642&app_name=i18n_ecom_alliance&device_platform=web&carrier_region=th`);
        data = body && body.data;
        if (data && (data.products || []).length) break;
        await wait(800);
      }
      if (data && data.total) total = Number(data.total);
      for (const p of (data && data.products) || []) {
        if (!p || !p.product_id || !p.title || p.is_hide) continue;
        const cover = p.cover && Array.isArray(p.cover.url_list) ? p.cover.url_list[0] : null;
        byId.set(String(p.product_id), { productId: String(p.product_id), title: String(p.title).slice(0, 300), shopName: p.seller_info && p.seller_info.shop_name || null,
          price: num(p.format_available_price), originalPrice: num(p.format_origin_price),
          commission: num(p.affiliate_info && p.affiliate_info.est_commission_expense), stock: p.stock_status === 1 ? num(p.stock_num) : 0,
          image: cover, showcase: true });
      }
      if (total == null && !(data && data.has_more)) break;
      await wait(300);
    }
    const items = [...byId.values()];
    return items;
  }
  const pendingRead = (async () => {
    for (let i = 0; i < 3; i++) { if ((await send({ type: "vf-tt-pending" })).pending) return true; await wait(600); }
    return false;
  })();
  const vis = el => !!el && el.getClientRects().length > 0;
  const text = el => ((el && (el.innerText || el.textContent)) || "").trim();
  const all = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
  const visibleButtons = root => all("button", root).filter(vis);
  async function until(find, ms) { const end = Date.now() + ms; while (Date.now() < end) { const v = find(); if (v) return v; await wait(300); } return null; }
  function setValue(input, value) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const ADD = /^(Add products|เพิ่มสินค้า)$/i;
  const PIN = /^(Pin|ปักหมุด|ปัก)$/i;
  const UNPIN = /^(Unpin|เลิกปักหมุด|ยกเลิกปักหมุด|เลิกปัก)$/i;
  const drawer = () => all(".arco-drawer").find(d => vis(d) && d.querySelector(".arco-tabs-header-title"));
  const blockingModal = () => all(".arco-modal").find(m => vis(m));

  pendingRead.then(async pending => {
    if (pending) { await wait(1500); await send({ type: "vf-tt-items", items: await readShowcase() }); return; }
    automate();
  });
  function automate() {
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:2147483647;max-width:360px;padding:10px 12px;border-radius:12px;background:#111;color:#fff;font:600 13px system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35);display:flex;gap:10px;align-items:center";
  const line = document.createElement("span");
  const toggle = document.createElement("button");
  toggle.style.cssText = "border:0;border-radius:8px;padding:6px 10px;font:700 12px system-ui,sans-serif;cursor:pointer";
  box.append(line, toggle);
  document.body.appendChild(box);
  let paused = false;
  const say = t => { line.textContent = "ViralFlow · " + t + (chatNote ? " · " + chatNote : ""); };
  const showToggle = () => { toggle.textContent = paused ? "▶ เริ่มออโต้" : "⏸ หยุดออโต้"; toggle.style.background = paused ? "#25c26e" : "#444"; toggle.style.color = "#fff"; };
  toggle.onclick = async () => { paused = !paused; showToggle(); await chrome.storage.local.set({ vfLivePaused: paused }); say(paused ? "หยุดออโต้ไว้" : "เริ่มออโต้แล้ว"); };
  chrome.storage.local.get("vfLivePaused").then(v => { paused = !!v.vfLivePaused; showToggle(); });
  showToggle();
  say("กำลังเชื่อม…");

  /** Tip pop-ups cover the page on every load: close them (✕, "Got it" or Esc). Esc on a confirm box only cancels it. */
  async function clearPopups() {
    for (let i = 0; i < 3; i++) {
      const modal = blockingModal();
      if (!modal) return true;
      const close = modal.querySelector(".arco-modal-close-icon") || visibleButtons(modal).find(b => /^(Got it|รับทราบ|เข้าใจแล้ว)$/i.test(text(b)));
      // Esc (what a person would press) closes the "AI-generated insights" one, which has no ✕; it never confirms anything.
      if (close) close.click();
      else for (const el of [document.activeElement, modal, document]) if (el) el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true }));
      await wait(800);
    }
    return !blockingModal();
  }

  async function openAddDrawer() {
    const open = drawer();
    if (open) return open;
    const empty = visibleButtons().find(b => ADD.test(text(b)) && !b.closest(".arco-drawer"));
    if (empty) { empty.click(); return until(drawer, 6000); }
    const plus = visibleButtons().find(b => /^\+?\s*(Add|เพิ่ม)$/i.test(text(b)));
    if (!plus) return null;
    for (let i = 0; i < 3; i++) {
      plus.click();
      const item = await until(() => {
        const menu = all(".arco-dropdown").find(vis);
        return menu && all("div,span", menu).find(e => ADD.test(text(e)));
      }, 2000);
      if (item) { item.click(); return until(drawer, 6000); }
    }
    return null;
  }

  /** Adds one product by its link; "added", "there" (already in the list or not addable) or "fail". */
  async function addOne(d, url) {
    const tab = all(".arco-tabs-header-title", d).find(t => /Product URL|URL|ลิงก์/i.test(text(t)));
    if (!tab) return "fail";
    if (!/active/.test(tab.className)) { tab.click(); await wait(800); }
    const pane = d.querySelector(".arco-tabs-content-item-active");
    const input = pane && pane.querySelector("input");
    const find = pane && pane.querySelector("button");
    if (!input || !find) return "fail";
    setValue(input, url);
    await wait(300);
    // The box keeps the last product's row until the new one loads: wait for the row to change (26 Nov: without this,
    // the 2nd and 3rd product read the 1st one's row and were skipped).
    const before = text(pane);
    find.click();
    await until(() => { const now = text(pane); return now !== before && /฿|Unidentified|ไม่พบ|ไม่รู้จัก/.test(now) && !/Loading/.test(now); }, 8000);
    await wait(600);
    const add = visibleButtons(d).find(b => ADD.test(text(b)));
    // A product row with "Add products" greyed out = it is already in the LIVE list (checked 26 Nov); no row = bad link.
    if (!add || add.disabled) return /฿/.test(text(pane)) && !/Unidentified|ไม่พบ|ไม่รู้จัก/.test(text(pane)) ? "there" : "fail";
    // The last product's "added" note can still be on screen: only a new one counts.
    const notes = () => all(".arco-message").filter(m => /success|สำเร็จ/i.test(text(m))).length;
    const seen = notes();
    add.click();
    // TikTok keeps one copy of a product: re-adding one already listed says nothing (or not "success") and changes nothing.
    const ok = await until(() => notes() > seen, 6000);
    return ok ? "added" : "there";
  }

  const checkedAt = new Map();
  // Adding a product that is already listed does nothing on TikTok's side (checked 26 Nov), so a slow recheck is safe.
  const RECHECK_MS = 30 * 60_000;
  const quietCount = new Map();
  async function fillBasket(products) {
    const due = products.filter(p => !checkedAt.has(p.productId) || Date.now() - checkedAt.get(p.productId) > RECHECK_MS);
    if (!due.length) return;
    if (!(await clearPopups())) { say("มีหน้าต่างค้างบนหน้านี้ ปิดก่อนแล้วระบบจะเติมตะกร้าต่อ"); return; }
    const d = await openAddDrawer();
    if (!d) { say("หาปุ่มเพิ่มสินค้าไม่เจอ"); return; }
    let added = 0, failed = 0;
    for (const p of due) {
      say(`กำลังเช็กสินค้าในตะกร้า ${p.title.slice(0, 30)}…`);
      const result = await addOne(d, p.url);
      if (result === "added") added++;
      if (result === "fail") failed++;
      // "there" without TikTok's note can also be an add that silently did not take: try once more on the next round.
      const quiet = (quietCount.get(p.productId) || 0) + (result === "there" ? 1 : 0);
      quietCount.set(p.productId, result === "added" ? 0 : quiet);
      if (result === "added" || quiet >= 2) checkedAt.set(p.productId, Date.now());
      await wait(2000);
    }
    const cancel = visibleButtons(d).find(b => /^(Cancel|ยกเลิก)$/i.test(text(b)));
    if (cancel) cancel.click();
    await wait(800);
    say(`ตะกร้าไลฟ์ครบ ${products.length} ตัว` + (added ? ` (เพิ่มใหม่ ${added})` : "") + (failed ? ` · เพิ่มไม่ได้ ${failed}` : ""));
  }

  /** The pin control of the product card that shows this title, or null when that card is not on screen. */
  function pinOf(title) {
    const key = title.replace(/\s+/g, " ").slice(0, 24);
    for (const b of all("button,[role=button]").filter(b => vis(b) && !b.closest(".arco-drawer"))) {
      const label = text(b) || b.getAttribute("aria-label") || "";
      const isPin = PIN.test(label), isUnpin = UNPIN.test(label);
      if (!isPin && !isUnpin) continue;
      let card = b.parentElement;
      for (let i = 0; i < 8 && card; i++, card = card.parentElement) {
        if (text(card).replace(/\s+/g, " ").includes(key)) return { button: b, pinned: isUnpin };
        if (all("button", card).filter(x => PIN.test(text(x)) || UNPIN.test(text(x))).length > 1) break;
      }
    }
    return null;
  }
  /** The product list only draws the cards in view: scroll it a screen at a time until the card shows up. */
  async function findPin(title) {
    let found = pinOf(title);
    if (found) return found;
    const list = all("div").find(e => /virtualized/.test(String(e.className)) && e.scrollHeight > e.clientHeight + 10)
      || all("div").find(e => /virtualized/.test(String(e.className)));
    const scroller = list && (list.scrollHeight > list.clientHeight + 10 ? list : list.parentElement);
    if (!scroller) return null;
    const start = scroller.scrollTop;
    scroller.scrollTop = 0;
    await wait(400);
    for (let i = 0; i < 40 && !(found = pinOf(title)); i++) {
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) break;
      scroller.scrollTop += Math.max(200, scroller.clientHeight - 80);
      await wait(400);
    }
    if (!found) scroller.scrollTop = start;
    return found;
  }
  /**
   * 27 Nov: the sidebar keeps its "Go LIVE now" button while a live from TikTok LIVE Studio runs, so that button says
   * nothing. A live shows its running clock (hh:mm:ss) over the video preview: that clock is the sign.
   */
  const live = () => all("span,div").some(e => vis(e) && !e.children.length && /^\d{2}:\d{2}:\d{2}$/.test(text(e)) && text(e) !== "00:00:00");
  let lastPinAt = 0, next = 0;
  async function pinNext(products, everySec) {
    if (!live()) { say(`ตะกร้า ${products.length} ตัวพร้อม · ระบบจะปักให้เองเมื่อเริ่มไลฟ์`); return; }
    if (Date.now() - lastPinAt < everySec * 1000) return;
    for (let tries = 0; tries < products.length; tries++) {
      const p = products[next % products.length];
      next++;
      const found = await findPin(p.title);
      if (!found) continue;
      if (!found.pinned) { found.button.click(); await wait(1000); }
      lastPinAt = Date.now();
      say(`📌 ปักแล้ว: ${p.title.slice(0, 40)} · ตัวต่อไปใน ${Math.round(everySec / 60)} นาที`);
      return;
    }
    say("ไลฟ์อยู่ แต่หาปุ่มปักของสินค้าในตะกร้าไม่เจอ");
  }

  let busy = false;
  async function tick() {
    if (busy || paused) return;
    busy = true;
    try {
      const basket = await send({ type: "vf-basket" });
      if (basket.offline) { say("ต่อ ViralFlow ไม่ได้ (เน็ตหรือเซิร์ฟเวอร์)"); return; }
      if (!basket.signedIn) { say("ล็อกอิน ViralFlow ใน Chrome นี้ก่อน"); return; }
      const products = (basket.products || []).filter(p => p && /^\d{6,30}$/.test(String(p.productId)) && /^https:\/\/shop\.tiktok\.com\//.test(String(p.url)));
      if (!products.length) { say("ยังไม่มีสินค้าที่เลือกไว้ขายในไลฟ์ (เลือกที่หน้า สินค้าขายดี TikTok)"); return; }
      if (!/\/streamer\/live\//.test(location.pathname)) { say("เปิดหน้า LIVE console เพื่อให้ระบบเติมและปักตะกร้า"); return; }
      await fillBasket(products);
      await pinNext(products, basket.pinEverySec || 180);
    } catch (error) {
      say("สะดุด: " + String(error && error.message || error).slice(0, 80));
    } finally { busy = false; }
  }
  setTimeout(tick, 4000);
  setInterval(tick, 15_000);

  /**
   * 27 Nov: Praew reads the viewers' comments from this page's Chat panel (TikTok blocks the comment reader on this
   * network). Only comments that appear after the page opened are sent, each once, while a live runs.
   */
  const seen = new WeakSet();
  let primed = false, sent = 0, chatNote = "";
  function chatList() {
    const header = all("div,span").find(e => vis(e) && !e.children.length && text(e) === "Chat");
    for (let box = header && header.parentElement, i = 0; box && i < 8; box = box.parentElement, i++) {
      const list = box.querySelector(".arco-list-content");
      if (list) return list;
    }
    return null;
  }
  function parseRow(row) {
    const lines = (row.innerText || "").split("\n").map(l => l.trim()).filter(Boolean);
    if (!lines.length) return null;
    if (lines.length >= 2) return { user: lines[0].replace(/[:：]$/, ""), text: lines.slice(1).join(" ") };
    const m = lines[0].match(/^(.{1,40}?)\s*[:：]\s*(.+)$/);
    return m ? { user: m[1], text: m[2] } : null;
  }
  async function readChat() {
    if (!live()) { primed = false; return; }
    const list = chatList();
    if (!list) return;
    const rows = Array.prototype.slice.call(list.children).flatMap(c => c.children.length === 1 && c.firstElementChild.children.length > 1 ? [c.firstElementChild] : [c]);
    for (const row of rows) {
      if (seen.has(row)) continue;
      seen.add(row);
      if (!primed) continue;
      const c = parseRow(row);
      if (!c || !c.text || /Welcome to TikTok LIVE|Community Guidelines/i.test(c.text)) continue;
      const answer = await send({ type: "vf-live-comment", user: c.user, text: c.text });
      if (answer.ok) sent++;
      chatNote = answer.ok ? `ส่งคอมเมนต์ให้แพรวแล้ว ${sent}` : answer.noTab ? "เปิดหน้า AI LIVE ของ ViralFlow ทิ้งไว้ แพรวถึงจะอ่านคอมเมนต์ได้" : "ส่งคอมเมนต์ให้แพรวไม่ได้ (โปรแกรมแพรวในเครื่องไม่ตอบ)";
    }
    primed = true;
  }
  setInterval(() => { readChat().catch(() => {}); }, 2000);
  }
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
    description: "ส่งสินค้าจาก Shopee/Lazada และสินค้าขายดีจาก TikTok Shop เข้า ViralFlow, เติมและปักตะกร้าไลฟ์ใน LIVE Manager ให้เอง และโพสต์คลิปที่คุณกดผ่านไป Facebook, Instagram, YouTube ด้วยบัญชีใน Chrome ของคุณ",
    permissions: ["storage", "alarms"],
    host_permissions: [`${origin}/*`, ...SHOPEE, ...LAZADA, ...SOCIAL, ...TIKTOK_SHOP],
    ...(icon ? { icons: { 128: "icon-128.png" }, action: { default_icon: { 128: "icon-128.png" }, default_title: "ViralFlow" } } : {}),
    background: { service_worker: "background.js" },
    content_scripts: [
      { matches: [`${origin}/product-clips*`, `${origin}/ai-live*`], js: ["viralflow.js"], run_at: "document_idle" },
      { matches: [...SHOPEE, ...LAZADA], js: ["shop.js"], run_at: "document_idle" },
      { matches: SOCIAL, js: ["social.js"], run_at: "document_idle" },
      { matches: TIKTOK_SHOP, exclude_matches: LIVE_MANAGER, js: ["tiktok.js"], run_at: "document_idle" },
      { matches: LIVE_MANAGER, js: ["live-manager.js"], run_at: "document_idle" },
    ],
  };
  return {
    "manifest.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "background.js": run(background, { portal: origin, start: SOCIAL_START }),
    "viralflow.js": run(viralflowPage),
    "shop.js": run(shopPage),
    "social.js": run(socialPage),
    "tiktok.js": run(tiktokPage),
    "live-manager.js": run(liveManagerPage),
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
