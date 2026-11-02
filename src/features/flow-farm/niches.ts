/**
 * Channel niches (หมวดของช่อง). A warm-up account first rotates across all of them; once one clearly brings more views,
 * engagement and follows, the channel focuses on it, and when it starts selling, products are picked to match it
 * (a pets channel sells pet supplies, a mystery channel sells mutelu items).
 */
export const NICHE_KEYS = ["PETS", "FOOD", "COMEDY", "MYSTERY", "LUCKY", "SATISFYING", "MINIATURE",
  "TRAVEL", "HOME", "GADGET", "BEAUTY", "GARDEN", "CAR", "FASHION", "FITNESS"] as const;
export type NicheKey = (typeof NICHE_KEYS)[number];

export interface Niche {
  label: string; series: readonly string[];
  /** Matched against a product's category key and title; null = any product fits. */
  products: RegExp | null; productLabel: string;
}
export const NICHES: Record<NicheKey, Niche> = {
  PETS: { label: "สัตว์น่ารัก", series: ["แมวทำงาน", "หมาดราม่า"],
    products: /pet|สัตว์เลี้ยง|แมว|หมา|สุนัข|dog|cat|อาหารสัตว์|ทราย|litter|ปลอกคอ|collar/i, productLabel: "ของใช้และอาหารสัตว์เลี้ยง" },
  FOOD: { label: "อาหาร", series: ["ครัวจิ๋ว", "สตรีทฟู้ดไทย"],
    products: /food|snack|ขนม|อาหาร|เครื่องดื่ม|drink|coffee|กาแฟ|ชา|tea|kitchen|ครัว|cook|หม้อ|กระทะ/i, productLabel: "อาหาร ขนม และของใช้ในครัว" },
  COMEDY: { label: "ตลก", series: ["ผลไม้ปากแจ๋ว", "ครัวป่วน"], products: null, productLabel: "สินค้าทั่วไปที่ขายดี" },
  MYSTERY: { label: "ลี้ลับ สยองขวัญ", series: ["ลี้ลับยามดึก", "ตำนานไทย"],
    products: /มู|มงคล|เครื่องราง|พระ|amulet|lucky|ธูป|incense|เทียน|candle|กำไล|หินนำโชค|crystal|คริสตัล|ไพ่|tarot|ฮวงจุ้ย/i, productLabel: "สินค้ามูเตลูและของมงคล" },
  LUCKY: { label: "ความเชื่อ มูเตลู", series: ["ปาฏิหาริย์สายมู", "สายมู"],
    products: /มู|มงคล|เครื่องราง|พระ|amulet|lucky|ธูป|incense|เทียน|candle|กำไล|หินนำโชค|crystal|คริสตัล|ไพ่|tarot|ฮวงจุ้ย/i, productLabel: "สินค้ามูเตลูและของมงคล" },
  SATISFYING: { label: "ตัดแล้วเพลิน ASMR", series: ["ตัดแล้วเพลิน"],
    products: /clean|ทำความสะอาด|slime|สไลม์|stationery|เครื่องเขียน|home|บ้าน|storage|จัดเก็บ/i, productLabel: "ของใช้ในบ้านและของทำความสะอาด" },
  MINIATURE: { label: "โลกจิ๋ว แฟนตาซี", series: ["โลกจิ๋ว"],
    products: /toy|ของเล่น|model|โมเดล|figure|ฟิกเกอร์|baby|เด็ก|kid/i, productLabel: "ของเล่น โมเดล และของเด็ก" },
  TRAVEL: { label: "ท่องเที่ยว วิวสวย", series: ["เที่ยววิวสวย"],
    products: /camp|แคมป์|เต็นท์|tent|travel|เดินทาง|กระเป๋าเดินทาง|luggage|outdoor|เดินป่า|hiking|ไฟฉาย|กระติก/i, productLabel: "อุปกรณ์แคมป์ปิ้งและของเดินทาง" },
  HOME: { label: "บ้านสวย แต่งห้อง", series: ["แต่งห้องฟิน"],
    products: /home|บ้าน|decor|ตกแต่ง|lamp|โคมไฟ|ผ้าม่าน|curtain|หมอน|pillow|ที่นอน|bedding|storage|จัดเก็บ|เฟอร์นิเจอร์|furniture/i, productLabel: "ของแต่งบ้านและของใช้ในบ้าน" },
  GADGET: { label: "แกดเจ็ตล้ำ ๆ", series: ["แกดเจ็ตล้ำ"],
    products: /gadget|electronic|tech|อิเล็กทรอนิกส์|charger|ชาร์จ|หูฟัง|earbud|speaker|ลำโพง|มือถือ|phone|smart|สมาร์ท|ไอที/i, productLabel: "แกดเจ็ตและอุปกรณ์ไอที" },
  BEAUTY: { label: "ความงาม ASMR", series: ["บิวตี้ ASMR"],
    products: /beauty|skin|cosmetic|ความงาม|สกินแคร์|เครื่องสำอาง|serum|เซรั่ม|ลิป|lip|ครีม|cream|น้ำหอม|perfume|hair|ผม/i, productLabel: "สกินแคร์ เครื่องสำอาง และของดูแลตัวเอง" },
  GARDEN: { label: "ต้นไม้ สวนสวย", series: ["สวนจิ๋วในบ้าน"],
    products: /plant|ต้นไม้|garden|สวน|กระถาง|pot|ปุ๋ย|fertilizer|เมล็ด|seed|รดน้ำ/i, productLabel: "ต้นไม้ กระถาง และอุปกรณ์ทำสวน" },
  CAR: { label: "รถ ขับเที่ยว", series: ["รถสวยติดล้อ"],
    products: /car|รถ|motor|มอเตอร์ไซค์|ยาง|tire|ที่วางมือถือในรถ|กล้องติดรถ|dash ?cam|น้ำยาเคลือบ|wax/i, productLabel: "ของแต่งรถและอุปกรณ์ในรถ" },
  FASHION: { label: "แฟชั่น แต่งตัว", series: ["แฟชั่นแปลงร่าง"],
    products: /fashion|cloth|apparel|เสื้อ|กางเกง|รองเท้า|กระเป๋า|bag|shoe|นาฬิกา|watch|เครื่องประดับ|jewel|หมวก|hat/i, productLabel: "เสื้อผ้า รองเท้า กระเป๋า และเครื่องประดับ" },
  FITNESS: { label: "สุขภาพ ออกกำลังกาย", series: ["ฟิตจิ๋ว"],
    products: /fitness|ออกกำลัง|gym|ยิม|sport|กีฬา|yoga|โยคะ|ดัมเบล|dumbbell|health|supplement|อาหารเสริม|วิตามิน|vitamin|โปรตีน|protein/i, productLabel: "อุปกรณ์ออกกำลังกายและสุขภาพ" },
};

export function nicheOfSeries(series: string | null): NicheKey | null {
  if (!series) return null;
  return NICHE_KEYS.find(key => NICHES[key].series.includes(series)) ?? null;
}
export const isNicheKey = (value: unknown): value is NicheKey => typeof value === "string" && (NICHE_KEYS as readonly string[]).includes(value);

/** Lottery and number-hint items are never sold on any channel: TikTok treats them as gambling. */
const LOTTERY = /หวย|สลาก|ใบ้เลข|เลขเด็ด|lottery|lotto/i;

/** Products that fit the channel's niche first, then the rest, so a niche with no matching product still sells something. */
export function productsForNiche<T extends { title: string; categoryKey: string }>(products: T[], niche: NicheKey | null): { items: T[]; matched: number } {
  const allowed = products.filter(p => !LOTTERY.test(p.title));
  const pattern = niche ? NICHES[niche].products : null;
  if (!pattern) return { items: allowed, matched: 0 };
  const fits = allowed.filter(p => pattern.test(p.categoryKey) || pattern.test(p.title));
  return { items: [...fits, ...allowed.filter(p => !fits.includes(p))], matched: fits.length };
}

/**
 * Niche score 0-100 the owner can read. 100 = clips in this niche do at least 1.6x the channel's average (views,
 * engagement, follows) over at least 6 posts; fewer posts scale the score down so one lucky clip cannot reach 100.
 * Untested niches score 0 and are still tried.
 */
export function nichePoints(group: { posted: number; score: number }) {
  if (!group.posted) return 0;
  return Math.max(0, Math.min(100, Math.round(group.score / 1.6 * 100 * Math.min(1, group.posted / 6))));
}

/**
 * The channel's main niche. A niche that reaches 100 becomes the main one; it stays main while it keeps 70 or more
 * (so one weak week does not flip the channel), otherwise the channel goes back to trying all niches.
 * The owner's own choice always wins.
 */
export function decideFocus(points: Partial<Record<NicheKey, number>>, current: NicheKey | null, ownerChoice: NicheKey | "AUTO" = "AUTO"): NicheKey | null {
  if (ownerChoice !== "AUTO") return ownerChoice;
  if (current && (points[current] ?? 0) >= 70) return current;
  const top = NICHE_KEYS.filter(k => (points[k] ?? 0) >= 100).toSorted((a, b) => (points[b] ?? 0) - (points[a] ?? 0))[0];
  return top ?? null;
}
