import { buildGrowthRecommendation, recommendCategories } from "../growth/strategy";

export interface TopicEvidence {
  name: string; key: string; source: "TIKTOK_DISPLAY" | "tiktok_shop" | "MOCK";
  capturedAt: string; authorized: boolean; confidence: number; momentum: number;
  accountEffect: number | null;
}
/** Rank existing authorized Category Intelligence observations, not an invented trend feed. */
export function chooseGrowthTopics(rows: TopicEvidence[], now: Date): string[] {
  const real = rows.filter(r => r.source !== "MOCK" && r.authorized && r.name.trim() &&
    Number.isFinite(r.confidence) && r.confidence > 0 && r.confidence <= 1 &&
    Number.isFinite(r.momentum) && r.momentum >= 0 && r.momentum <= 100 &&
    Date.parse(r.capturedAt) <= now.getTime() && now.getTime() - Date.parse(r.capturedAt) <= 7 * 86400000);
  const categories = recommendCategories(real.map(r => ({ categoryKey: r.key, accountEffect: r.accountEffect ?? 0,
    categoryMomentum: r.momentum, confidence: r.confidence })), .75);
  return [...new Set(categories.filter(c => c.action !== "REDUCE").toSorted((a,b)=>b.score-a.score||b.confidence-a.confidence||a.categoryKey.localeCompare(b.categoryKey)).map(c => real.find(r => r.key === c.categoryKey)!.name))];
}
/** An evidence-bound draft brief, not a claim that an LLM or video provider has run. */
export function growthCreativeBrief(topic: string) {
  const strategy = buildGrowthRecommendation({ state: "NEW", patterns: [], categories: [], confidence: 0 });
  return `Topic: ${JSON.stringify(topic)}. Hook: สิ่งที่ควรรู้เกี่ยวกับ ${topic}. ` +
    `Script plan: introduce the topic, explain one point supported by the selected source, then ${strategy.cta}. ` +
    `Use original vertical visuals with a clear opening, one demonstration and a short closing. ` +
    `Do not invent facts, testimonials, guarantees, medical claims or personal product experience. ` +
    `Verify the factual script and originality before export. Google Vids is assisted; no video has been generated.`;
}
