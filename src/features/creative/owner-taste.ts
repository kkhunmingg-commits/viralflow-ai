/** What the owner has actually approved or rejected, stored as data the director and critic read.
 * The system uses it to decide what "looks good" without the owner re-sending examples each time.
 * Signals were measured with the critic's own analyser on the owner's files (28 Oct 2026). */
export type ProductionStyle = "FLOW_NATIVE_TAKE" | "MULTI_SHOT_EDIT";
export type StyleTag = "PASTED_PHOTO_CARD" | "GRADIENT_KINETIC_TYPE" | "STATIC_MACRO_PUSH_IN" | "HANDS_IN_STYLED_SET" | "SILENT_TRACK";

export interface StyleVerdict { tag: StyleTag; verdict: "APPROVED" | "REJECTED"; reasonTh: string; source: string }
export const OWNER_STYLE_VERDICTS: StyleVerdict[] = [
  { tag: "HANDS_IN_STYLED_SET", verdict: "APPROVED", source: "owner reference Hands_reviewing_electric_spin_sc…_fbc2c4e4.mp4",
    reasonTh: "ช็อตต่อเนื่องดูเหมือนถ่ายจริง มือหยิบ/กดสินค้าในฉากที่จัดสวย แสงนุ่ม ไม่มีการ์ดหรือข้อความแปะ" },
  { tag: "PASTED_PHOTO_CARD", verdict: "REJECTED", source: "owner feedback on CASIO_LIFESTYLE_FLOW_CONTEXT_FINAL.mp4",
    reasonTh: "ภาพสินค้าวางเป็นการ์ดบนพื้นหลัง ดูตัดแปะ ไม่ใช่โฆษณาจริง" },
  { tag: "GRADIENT_KINETIC_TYPE", verdict: "REJECTED", source: "owner feedback on CASIO_LIFESTYLE_FLOW_CONTEXT_FINAL.mp4",
    reasonTh: "ฉากตัวหนังสือบนพื้นไล่สีดูเป็นสไลด์ ไม่ใช่โฆษณา" },
  { tag: "STATIC_MACRO_PUSH_IN", verdict: "REJECTED", source: "owner rejection of Casio_watch_camera_push-in_20261028015602.mp4",
    reasonTh: "ซูมหน้าปัดอย่างเดียว ไม่มีเรื่องราว ไม่มีบริบท และตัวเลขเพี้ยน" },
  { tag: "SILENT_TRACK", verdict: "REJECTED", source: "owner rejection of Casio_watch_camera_push-in_20261028015602.mp4", reasonTh: "แทบไม่มีเสียง" },
];

/** Measured on the approved reference: one continuous 8 s take, no cuts, steady natural motion, audible track. */
export const APPROVED_REFERENCE_BENCHMARK = {
  source: "owner reference Hands_reviewing_electric_spin_sc…_fbc2c4e4.mp4",
  production: "FLOW_NATIVE_TAKE" as ProductionStyle,
  durationSeconds: 8, width: 720, height: 1280, cuts: 0, loudnessLufs: -15.1, meanBrightness: 136.9, meanSaturation: 9.3,
  burnedInText: false,
};

export const DEFAULT_PRODUCTION: ProductionStyle = "FLOW_NATIVE_TAKE";
export const rejectedTags = () => new Set(OWNER_STYLE_VERDICTS.filter(v => v.verdict === "REJECTED").map(v => v.tag));
