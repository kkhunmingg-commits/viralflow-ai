import { ClaimLedger, normalizeProposition } from "./claim-ledger";
import type { ComplianceInput, RiskFinding, SemanticAssessment, SemanticCategory, SemanticRiskClassifier } from "./contracts";

/** These are neutral refusals, not product facts, endorsements or treatment advice. */
export const SAFE_LIVE_TEMPLATES = Object.freeze({
  medical: "ขออภัย ฉันไม่สามารถให้คำแนะนำในการรักษาโรคได้ กรุณาปรึกษาบุคลากรทางการแพทย์",
  guarantee: "ฉันไม่สามารถรับประกันผลลัพธ์ได้ กรุณาตรวจสอบข้อมูลที่ยืนยันได้ก่อนตัดสินใจ",
  timeline: "ฉันยังไม่มีข้อมูลที่ยืนยันระยะเวลาเห็นผล จึงไม่สามารถระบุวันได้",
  sensitive: "สำหรับการตั้งครรภ์หรือข้อกังวลด้านสุขภาพ กรุณาปรึกษาบุคลากรทางการแพทย์",
  unknown: "ฉันยังไม่มีข้อมูลที่ยืนยันเรื่องนี้ จึงไม่ขอกล่าวอ้างเพิ่มเติม",
  certification: "ฉันยังไม่มีหลักฐานยืนยันการรับรองนี้ กรุณาตรวจสอบเอกสารของสินค้า",
});
export const NEUTRAL_CHAT_PHRASES=Object.freeze(["สวัสดีค่ะ", "ยินดีต้อนรับค่ะ", "ขอสักครู่นะคะ กำลังตรวจสอบข้อมูลให้ค่ะ",
  "ขอบคุณที่แวะมาคุยกันค่ะ", "ขอบคุณที่มาทักทายค่ะ", "ยินดีที่ได้คุยกันค่ะ", "ขอบคุณค่ะ", "ยินดีค่ะ",
  "สนใจสอบถามเรื่องสินค้าได้เลยนะคะ", "ขอบคุณที่คุยเป็นเพื่อนนะคะ",
  "ขอบคุณที่แวะมาคุยกันค่ะ สนใจสอบถามเรื่องสินค้าได้เลยนะคะ", "ยังไม่พบข้อมูลนี้ในข้อมูลสินค้าของร้านค่ะ",
  "ตรวจสอบข้อมูลสินค้า", "ดูรายละเอียดสินค้า", "ขอบคุณสำหรับคำถาม", "ขอบคุณที่รับชม", "ไม่ใช่ยา", "ไม่ใช้แทนการรักษา", "ไม่มีการรับประกันผลลัพธ์"]);
const neutral = new Set([...Object.values(SAFE_LIVE_TEMPLATES), ...NEUTRAL_CHAT_PHRASES].map(normalizeProposition));
export const isNeutralStatement = (text: string) => neutral.has(normalizeProposition(text));
export const contentTexts = (input: ComplianceInput) => [input.content.hook, input.content.script, input.content.cta,
  input.content.caption, ...(input.content.hashtags ?? []), input.content.transcript, ...(input.content.onScreenText ?? []),
  input.content.coverText, ...(input.content.visibleClaims ?? []), ...(input.content.metadata ?? [])].filter((text): text is string => Boolean(text?.trim()));

/** Lexical evidence is one layer. Decisions also require polarity, proposition grounding, scope and current evidence. */
const concepts: Array<[SemanticCategory, RegExp]> = [
  ["MEDICAL_TREATMENT", /(?:รักษา|หายขาด|กำจัด|หมดไป|cure|heal|treat).{0,35}(?:สิว|ฝ้า|โรค|แผล|eczema|acne|melasma|disease)|(?:สิว|ฝ้า|โรค|acne).{0,30}(?:หาย|หมด|ไม่กลับ)/iu],
  ["DISEASE_PREVENTION", /ป้องกัน.{0,20}(?:โรค|มะเร็ง|เบาหวาน)|prevent.{0,25}(?:disease|cancer)/iu],
  ["DIAGNOSIS", /วินิจฉัย|ตรวจพบโรค|diagnos/iu],
  ["REPLACEMENT_FOR_MEDICAL_CARE", /แทน.{0,20}(?:ยา|หมอ|แพทย์|การรักษา)|ไม่ต้อง.{0,20}(?:ไปหาหมอ|กินยา)|replace.{0,20}(?:doctor|medicine|treatment)/iu],
  ["GUARANTEED_RESULT", /(?:แน่นอน|รับประกัน|ทุกคน.{0,20}(?:ได้ผล|เห็นผล)|ไม่มีทาง.{0,35}(?:เหมือนเดิม|ไม่เปลี่ยน)|guarantee|everyone.{0,25}results)/iu],
  ["ABSOLUTE_CLAIM", /100\s*%|ไม่มีผลข้างเคียง|ไม่แพ้(?:แน่|เลย)|ปลอดภัย.{0,10}(?:ทุกคน|ทุกสภาพ)|no side effects|always works/iu],
  ["TIME_BOUND_RESULT", /(?:ใน|ภายใน|แค่|within|after)\s*\d+\s*(?:วัน|นาที|ชั่วโมง|days?|minutes?|hours?)|ทันที|instant/iu],
  ["FAKE_CERTIFICATION", /อย\.|FDA|แพทย์.{0,15}(?:รับรอง|แนะนำ)|ผ่าน.{0,10}(?:ทดสอบ|รับรอง)|dermatologist|clinically|certif/iu],
  ["UNSUPPORTED_SUPERIORITY", /อันดับ\s*(?:1|หนึ่ง)|ดีที่สุด|เหนือกว่า.{0,20}(?:แบรนด์|ทุก)|No\.?\s*1|best|award|รางวัล/iu],
  ["MISLEADING_COMPARISON", /เทียบ.{0,20}(?:ยี่ห้อ|แบรนด์)|ดีกว่า|better than/iu],
  ["FAKE_SCARCITY", /เหลือ.{0,10}\d+.{0,8}ชิ้น|วันนี้วันสุดท้าย|หมดใน|last chance|only \d+ left/iu],
  ["MISLEADING_PRICE", /ลด.{0,10}\d+\s*%|จาก\s*\d+.{0,10}เหลือ|discount|free|ฟรี|ราคา|บาท|THB|\$/iu],
  ["FAKE_TESTIMONIAL", /รีวิวจริง|ลูกค้า.{0,15}(?:ยืนยัน|ทุกคน)|ผู้ใช้จริง|testimonial|real customer/iu],
  ["FALSE_BEFORE_AFTER", /ก่อน.{0,5}หลัง|before.{0,5}after/iu],
  ["BODY_MANIPULATION", /ปลูกผม|ผมงอก|เปลี่ยน.{0,15}(?:รูปร่าง|สีผิว)|ลด.{0,10}(?:รอบเอว|น้ำหนัก)|hair regrowth|body transform/iu],
  ["RESTRICTED_PRODUCT", /ยาเสพติด|บุหรี่|อาวุธ|weapon|narcotic/iu],
  ["EXAGGERATED_FUNCTIONALITY", /ชาร์จ.{0,10}ไม่.{0,5}หมด|ไม่ต้องชาร์จ|infinite battery|ทะลุ.{0,10}(?:กำแพง|ผนัง)|impossible/iu],
];

const explicitRiskNegation = /^(?:ไม่(?:ได้)?(?:รักษา|ช่วยรักษา|รับประกัน|ป้องกันโรค|วินิจฉัย|ใช้แทน)|ไม่ได้อ้างว่า(?:จะ)?(?:รักษา|ป้องกันโรค|วินิจฉัย|รับประกัน|ใช้แทน)|(?:does not|do not|cannot|not intended to)\s+(?:cure|heal|treat|prevent|diagnose|replace|guarantee)|not\s+(?:a\s+)?(?:cure|treatment|guarantee))/iu;
const hasAdditionalAssertion = /แต่|แล้ว|และ|however|\b(?:but|and)\b/iu;

/** A verified description of temporary makeup coverage is not evidence of a fabricated biological change. */
function isGroundedBeforeAfterContext(clause:string,grounded:boolean):boolean {
  if(!grounded)return false;
  if(/ถาวร|permanent|หายขาด|cure|heal|treat|ผมงอก|hair regrowth|ลดน้ำหนัก|weight loss/iu.test(clause))return false;
  const cosmetic=/เครื่องสำอาง|คอนซีลเลอร์|makeup|concealer/iu.test(clause)&&/ชั่วคราว|temporary/iu.test(clause);
  const assembly=/ประกอบ|ติดตั้ง|assembly|installation/iu.test(clause);
  return cosmetic||assembly;
}

export class GroundedSemanticClassifier implements SemanticRiskClassifier {
  async classify(input: ComplianceInput, signal?: AbortSignal): Promise<SemanticAssessment> {
    signal?.throwIfAborted();
    const ledger = new ClaimLedger(input.scope, input.claims, input.evidence, Date.parse(input.now ?? new Date().toISOString()), input.satisfiedConditions);
    const findings: RiskFinding[] = [], assertions: string[] = [];
    for (const text of contentTexts(input)) {
      if (isNeutralStatement(text)) continue;
      const clauses = ledger.match(text).length ? [text] : text.split(/[\n;!?。]|,(?!\d)|(?<!\d)\.(?!\d)/u).map(value => value.trim()).filter(Boolean);
      for (const clause of clauses) {
        if (isNeutralStatement(clause)) continue;
        const question = /ไหม|หรือไม่|ใช่หรือ|\?$|^(?:can|is|will)\b/iu.test(clause)
          || /^(?:does|do)\b/iu.test(clause) && !explicitRiskNegation.test(clause);
        // A short explicit negation of an unsafe claim is different from a promise followed by a disclaimer.
        const matching = ledger.match(clause).map(row => row.id);
        const hits = concepts.filter(([category, pattern]) => pattern.test(clause)
          && !(category === "FALSE_BEFORE_AFTER" && isGroundedBeforeAfterContext(clause,matching.length>0)));
        // “No need to recharge” and “no way you will stay the same” are affirmative promises.
        const negated = hits.length === 1 && explicitRiskNegation.test(clause) && !hasAdditionalAssertion.test(clause);
        const polarity = negated ? "NEGATED" : question ? "QUESTION" : "ASSERTED";
        // An outgoing rhetorical question can still imply a product fact. Question
        // wording cannot bypass ledger grounding, even when no risk concept matches.
        if (polarity !== "NEGATED") assertions.push(clause);
        for (const [category] of hits) findings.push({ category, confidence: .9, text: clause, polarity, claimRefs: matching });
        if (polarity !== "NEGATED" && matching.length === 0) findings.push({ category: "UNKNOWN_FACT", confidence: 1, text: clause, polarity, claimRefs: [] });
      }
    }
    // No open-ended sentence is made factual through absence of a dictionary hit.
    return { findings, assertions, complete: true, uncertainty: [] };
  }
}

/** An optional local semantic model may add paraphrase findings, but cannot override deterministic grounding. */
export class CompositeSemanticClassifier implements SemanticRiskClassifier {
  constructor(private readonly semantic: SemanticRiskClassifier, private readonly grounded = new GroundedSemanticClassifier()) {}
  async classify(input: ComplianceInput, signal?: AbortSignal) {
    const base = await this.grounded.classify(input, signal);
    try {
      const semantic = await this.semantic.classify(input, signal);
      return { findings: [...base.findings, ...semantic.findings], assertions: [...new Set([...base.assertions, ...semantic.assertions])],
        complete: base.complete && semantic.complete, uncertainty: [...base.uncertainty, ...semantic.uncertainty] };
    } catch {
      return { ...base, complete: false, uncertainty: ["SEMANTIC_PROVIDER_UNAVAILABLE"] };
    }
  }
}
