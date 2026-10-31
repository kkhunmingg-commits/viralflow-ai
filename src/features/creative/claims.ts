/** Checks that what a clip says matches what it shows and what the evidence supports. It is a
 * keyword and number check, so it catches the mismatches found in pilots (a "watch it work" line
 * over a zoomed still, an invented figure); a person still reviews meaning and tone. */
export type ClaimVisual = "REAL_FOOTAGE_OPERATION" | "REAL_FOOTAGE" | "REAL_IMAGE" | "ORIGINAL_GRAPHIC" | "GENERATIVE";
export interface ClaimIssue { code: "DEMONSTRATION_WITHOUT_FOOTAGE" | "REAL_MEDIA_CLAIM_ON_GRAPHIC" | "UNSUPPORTED_NUMBER"; text: string }

const DEMONSTRATION = /สาธิต|ดูการทำงาน|ทำงานจริง|ใช้งานจริง|ทดสอบให้ดู|พิสูจน์|ก่อน\s*-?\s*หลัง|ผลลัพธ์จริง|จังหวะใช้งาน|before\s*\/?\s*after/i;
const REAL_MEDIA = /ภาพจริง|วิดีโอจริง|คลิปจริง|ภาพสินค้า/;
const numbers = (text: string) => (text.match(/[0-9][0-9.,]*/g) ?? []).map(n => n.replace(/[.,]+$/, "").replace(/,/g, ""));

/** `supported` holds verified facts plus the product name or topic, whose own figures (model numbers, sizes) are not new claims. */
export function claimIssues(lines: string[], visual: ClaimVisual, supported: string[]): ClaimIssue[] {
  const issues: ClaimIssue[] = [], factNumbers = new Set(supported.flatMap(numbers));
  for (const line of lines.map(l => l.trim()).filter(Boolean)) {
    if (DEMONSTRATION.test(line) && visual !== "REAL_FOOTAGE_OPERATION") issues.push({ code: "DEMONSTRATION_WITHOUT_FOOTAGE", text: line });
    if (REAL_MEDIA.test(line) && (visual === "ORIGINAL_GRAPHIC" || visual === "GENERATIVE")) issues.push({ code: "REAL_MEDIA_CLAIM_ON_GRAPHIC", text: line });
    // Figures such as list counts in a hook ("3 เรื่อง") are structure, not claims; only beats that state facts are checked.
    for (const n of numbers(line)) if (!factNumbers.has(n) && !/^[0-9] ?(เรื่อง|ข้อ)/.test(line.slice(line.indexOf(n)))) issues.push({ code: "UNSUPPORTED_NUMBER", text: line });
  }
  return issues;
}
