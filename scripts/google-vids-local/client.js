/* Local-only official Picker. Never log Google responses or persist credentials. */
let csrf = "", pickerReady = false, busy = false;
const element = id => document.getElementById(id);
const phases = { WAITING_CONFIGURATION: "รอตั้งค่า Google Cloud", WAITING_OWNER_CONSENT: "รอคุณอนุญาต Google", WAITING_OWNER_PICKER: "เชื่อมแล้ว — เลือกโปรเจกต์เดิม", READY_TO_DOWNLOAD: "เข้าถึงไฟล์ได้ — พร้อมดาวน์โหลด", DOWNLOADING_EXISTING_PROJECT: "กำลังรับวิดีโอเดิม", CHECKING_LOCAL_VIDEO: "กำลังตรวจรูปแบบวิดีโอ", LOCAL_IMPORT_COMPLETE_REVIEW_REQUIRED: "รับไฟล์แล้ว — รอตรวจเนื้อหา", STOPPED: "ล้างการเชื่อมต่อแล้ว", BLOCKED: "การทดสอบติดข้อจำกัด" };
async function post(path, data = {}) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...data, csrf }) });
  const result = await response.json(); if (!response.ok) throw new Error("LOCAL_ACTION_BLOCKED"); return result;
}
function showFailure() { element("message").textContent = "ขั้นตอนนี้ยังไม่ผ่าน ตรวจการตั้งค่า/สิทธิ์ Google ก่อนลองใหม่ ไม่มีการสร้างวิดีโอหรือโพสต์"; }
async function status() {
  const response = await fetch("/api/status", { cache: "no-store" });
  if (!response.ok) throw new Error("LOCAL_STATUS_BLOCKED");
  const state = await response.json(); csrf = state.csrf;
  element("status").textContent = phases[state.phase] || "รอตรวจสอบ";
  element("setup").hidden = state.configured;
  element("connect").disabled = !state.configured || state.connected || busy || state.phase === "STOPPED";
  element("picker").disabled = !state.connected || state.selected || busy;
  element("download").disabled = !state.selected || state.phase !== "READY_TO_DOWNLOAD" || busy;
  element("disconnect").disabled = !state.connected;
  if (state.error) showFailure();
  if (state.result) {
    element("results").hidden = false;
    const { media, technicalFormat, qualityStatus, databaseJobImport } = state.result;
    const lines = [`ไฟล์ MP4 รับเข้า Local แล้ว`, `ความยาว ${media.duration.toFixed(2)} วินาที · ภาพ ${media.width} × ${media.height}`, `มีเสียง: ${media.hasAudio ? "มี" : "ไม่มี"}`, `รูปแบบทางเทคนิค: ${technicalFormat === "PASS" ? "ผ่าน" : "ต้องตรวจ"}`, `Quality Check เดิม: ${qualityStatus === "PASS" ? "ผ่าน" : "รอตรวจเพิ่มเติม"}`, `บันทึกงานในฐานข้อมูล: ${databaseJobImport === "NOT_TESTED" ? "ยังไม่ได้ทดสอบ" : "ตรวจเพิ่มเติม"}`];
    element("checks").replaceChildren(...lines.map(text => { const li = document.createElement("li"); li.textContent = text; return li; }));
  }
}
element("connect").onclick = async () => {
  busy = true;
  try { const result = await post("/api/connect"); window.location.assign(result.authorizeUrl); }
  catch { busy = false; showFailure(); }
};
async function loadPicker() {
  if (pickerReady) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script"); script.src = "https://apis.google.com/js/api.js";
    script.onerror = () => reject(new Error("PICKER_SCRIPT_UNAVAILABLE"));
    script.onload = () => window.gapi.load("picker", { callback: () => { pickerReady = true; resolve(); }, onerror: reject, timeout: 15000, ontimeout: reject });
    document.head.append(script);
  });
}
element("picker").onclick = async () => {
  busy = true;
  try {
    await loadPicker(); const access = await post("/api/picker");
    const view = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS).setMimeTypes("application/vnd.google-apps.vid");
    const picker = new window.google.picker.PickerBuilder().setAppId(access.appId).setDeveloperKey(access.key)
      .setOAuthToken(access.token).setOrigin(window.location.origin).addView(view)
      .setCallback(async data => {
        if (data.action === window.google.picker.Action.PICKED) {
          const docs = data[window.google.picker.Response.DOCUMENTS];
          if (!Array.isArray(docs) || docs.length !== 1) { showFailure(); busy = false; return; }
          try { await post("/api/select", { fileId: docs[0].id, ...(docs[0].resourceKey ? { resourceKey: docs[0].resourceKey } : {}) }); }
          catch { showFailure(); }
          picker.dispose(); busy = false; await status();
        } else if (data.action === window.google.picker.Action.CANCEL) { picker.dispose(); busy = false; await status(); }
      }).build();
    // Picker has consumed the token; do not retain our own copy.
    access.token = ""; picker.setVisible(true);
  } catch { busy = false; showFailure(); }
};
element("download").onclick = async () => { busy = true; try { await post("/api/download"); } catch { showFailure(); } finally { busy = false; await status(); } };
element("disconnect").onclick = async () => { await post("/api/disconnect"); window.location.reload(); };
status().catch(showFailure);
setInterval(() => status().catch(showFailure), 3000);
