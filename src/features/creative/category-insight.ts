/** Category playbooks: how people in a category usually decide, what stops them scrolling, which moods and
 * looks suit it, and what must never be claimed. Everything here is an editorial HYPOTHESIS about an
 * audience until the account's own results confirm it; it is never presented as measured fact. */
export type CategoryFamily = "WATCH_ACCESSORY" | "BEAUTY" | "HOME_KITCHEN" | "GADGET" | "FASHION" | "FOOD_SNACK" | "HEALTH_SUPPLEMENT" | "BABY_TOY" | "PET" | "GENERAL";

export interface VisualStyle { mood: string; lighting: string; background: string; palette: [string, string, string]; grade: "WARM" | "COOL" | "NEUTRAL" | "VIVID" | "MONO" }
export interface CategoryPlaybook {
  family: CategoryFamily;
  audiences: string[];
  needs: string[];
  stopReasons: string[];
  interestReasons: string[];
  styles: VisualStyle[];
  /** Formats that usually work here, best first; still filtered by evidence and media. */
  formats: AdFormat[];
  /** Hook patterns; `{product}` and `{fact}` are filled from verified data only. */
  hooks: Record<AdFormat, string[]>;
  /** Scenes an AI model may invent here without touching the product (atmosphere, context, graphics). */
  contextScenes: string[];
  forbiddenClaims: RegExp[];
  forbiddenNote: string;
}

export type AdFormat = "PROBLEM_SOLUTION" | "CURIOSITY" | "LIFESTYLE" | "PRODUCT_DETAIL" | "BUYING_GUIDE" | "COMPARISON" | "CINEMATIC_HERO" | "UGC_STORY" | "ASMR_SENSORY";
export const AD_FORMAT_LABEL: Record<AdFormat, string> = {
  PROBLEM_SOLUTION: "ปัญหา → ทางออก", CURIOSITY: "ชวนสงสัย / Pattern Interrupt", LIFESTYLE: "ไลฟ์สไตล์ / สถานการณ์ใช้งาน",
  PRODUCT_DETAIL: "เจาะรายละเอียดสินค้า", BUYING_GUIDE: "ก่อนตัดสินใจซื้อ", COMPARISON: "เปรียบเทียบจากหลักฐาน",
  CINEMATIC_HERO: "Cinematic Hero Ad", UGC_STORY: "เรื่องเล่าแบบ UGC (ไม่ปลอมรีวิว)", ASMR_SENSORY: "ASMR / Sensory",
};

const FORBIDDEN_COMMON = [/รักษา|หายขาด|การันตี|100\s*%|ดีที่สุดในโลก|อันดับ\s*1|ขายดีที่สุด|รวยเร็ว/];
const generalHooks: Record<AdFormat, string[]> = {
  PROBLEM_SOLUTION: ["เคยเจอแบบนี้ไหม?", "เรื่องเล็กที่กวนใจทุกวัน"], CURIOSITY: ["ของชิ้นนี้มีอะไรที่คนมองข้าม?", "รู้ไหมว่า {product} …"],
  LIFESTYLE: ["วันธรรมดาที่ง่ายขึ้นนิดเดียว", "สำหรับคนที่ชอบชีวิตไม่ซับซ้อน"], PRODUCT_DETAIL: ["ดูให้ชัดก่อนตัดสินใจ", "ซูมดูทีละจุด"],
  BUYING_GUIDE: ["ก่อนกดซื้อ เช็ก 3 อย่างนี้", "จะซื้อ {product} ดูตรงไหน?"], COMPARISON: ["ต่างกันตรงไหน?", "เทียบให้เห็นจากสเปกจริง"],
  CINEMATIC_HERO: ["{product}", "เรียบ แต่จำได้"], UGC_STORY: ["เล่าให้ฟังแบบตรง ๆ", "ทำไมคนถึงยังเลือกแบบนี้"],
  ASMR_SENSORY: ["ฟังเสียงนี้", "ลองดูใกล้ ๆ"],
};

const PLAYBOOKS: CategoryPlaybook[] = [
  { family: "WATCH_ACCESSORY",
    audiences: ["คนทำงาน/นักศึกษาที่อยากได้นาฬิกาใช้ทุกวันแบบไม่ต้องคิดมาก", "สายมินิมอลหรือสายเรโทรที่ชอบดีไซน์คลาสสิก", "คนที่มองหาของขวัญราคาจับต้องได้"],
    needs: ["ใส่สบาย ไม่หนักข้อมือ", "ดูเวลาได้เร็วโดยไม่ต้องหยิบมือถือ", "ดีไซน์ที่เข้ากับหลายลุค"],
    stopReasons: ["ภาพมาโครของรายละเอียดหน้าปัดที่ไม่ค่อยได้เห็น", "ตัวเลขข้อเท็จจริงที่จับต้องได้ เช่น น้ำหนัก", "ความรู้สึกเรโทร/คลาสสิก"],
    interestReasons: ["ความเรียบง่ายและความคุ้นตา", "สเปกที่ยืนยันได้จากผู้ผลิต"],
    styles: [
      { mood: "มินิมอลสะอาดตา", lighting: "soft top key light with gentle rim light", background: "seamless matte paper backdrop with soft gradient", palette: ["#0B1F3A", "#2EC8FF", "#F5F7FA"], grade: "COOL" },
      { mood: "เรโทรอบอุ่น", lighting: "warm late-afternoon window light", background: "warm wooden desk surface, shallow depth of field", palette: ["#2B1B12", "#F2A541", "#FFF4E0"], grade: "WARM" },
    ],
    formats: ["PRODUCT_DETAIL", "LIFESTYLE", "CINEMATIC_HERO", "BUYING_GUIDE", "CURIOSITY", "PROBLEM_SOLUTION"],
    hooks: { ...generalHooks, LIFESTYLE: ["ชีวิตวุ่นแค่ไหน ข้อมือก็ไม่ต้องหนัก", "สำหรับคนที่ชอบความเรียบง่าย"], PRODUCT_DETAIL: ["ซูมดูทุกปุ่มก่อนซื้อ", "หน้าปัดนี้บอกอะไรบ้าง?"] },
    contextScenes: ["busy morning desk with phone notifications, laptop and coffee, no wristwatch visible", "city commute motion blur, abstract", "calm minimalist desk at dawn"],
    forbiddenClaims: [...FORBIDDEN_COMMON, /กันน้ำ\s*\d+\s*(เมตร|ม\.)/], forbiddenNote: "ห้ามอ้างระดับกันน้ำ ความทนทาน หรือฟังก์ชันที่ไม่มีในข้อเท็จจริงที่บันทึก" },
  { family: "BEAUTY",
    audiences: ["คนที่ดูแลผิวทุกวันและอ่านส่วนผสมก่อนซื้อ", "มือใหม่ที่อยากได้ขั้นตอนง่าย"],
    needs: ["รู้ว่าเนื้อสัมผัสเป็นแบบไหน", "รู้ว่าใช้ขั้นตอนไหน", "ความมั่นใจว่าไม่โฆษณาเกินจริง"],
    stopReasons: ["ภาพเท็กซ์เจอร์ระยะใกล้", "ขั้นตอนสั้นที่ทำตามได้"], interestReasons: ["ส่วนผสมที่ระบุบนฉลาก", "ขนาดและราคา"],
    styles: [{ mood: "สดใส ใส สะอาด", lighting: "diffused high-key beauty light", background: "pastel acrylic blocks with water ripples", palette: ["#FDE2E4", "#E2ECE9", "#5C4D7D"], grade: "VIVID" }],
    formats: ["ASMR_SENSORY", "PRODUCT_DETAIL", "BUYING_GUIDE", "LIFESTYLE", "CINEMATIC_HERO"],
    hooks: { ...generalHooks, ASMR_SENSORY: ["ฟังเนื้อสัมผัสนี้", "ใกล้ขึ้นอีกนิด"] },
    contextScenes: ["soft morning bathroom vanity mood, no person, no product", "water droplets on pastel acrylic"],
    forbiddenClaims: [...FORBIDDEN_COMMON, /ขาวขึ้น|หน้าใสใน\s*\d+|ลดสิว|ลดฝ้า|ก่อน\s*-?\s*หลัง/], forbiddenNote: "ห้ามอ้างผลลัพธ์บนผิว ก่อน/หลัง หรือผลทางการแพทย์" },
  { family: "HOME_KITCHEN",
    audiences: ["คนอยู่คอนโด/บ้านที่อยากให้งานบ้านเร็วขึ้น", "คนชอบจัดบ้านให้เป็นระเบียบ"],
    needs: ["ประหยัดเวลา", "ประหยัดพื้นที่", "ใช้งานง่าย"], stopReasons: ["สถานการณ์ปัญหาที่ทุกคนเคยเจอ", "ภาพก่อนจัด/หลังจัดที่เป็นของจริง"],
    interestReasons: ["ขนาดและการใช้งานจริง", "ราคาเมื่อเทียบประโยชน์"],
    styles: [{ mood: "บ้านอบอุ่นเป็นระเบียบ", lighting: "natural window daylight", background: "clean kitchen counter, light wood and white tiles", palette: ["#F7F3EB", "#7FB685", "#2F3E46"], grade: "WARM" }],
    formats: ["PROBLEM_SOLUTION", "LIFESTYLE", "BUYING_GUIDE", "PRODUCT_DETAIL", "COMPARISON"],
    hooks: generalHooks, contextScenes: ["cluttered countertop mood shot, no product", "tidy calm kitchen corner"],
    forbiddenClaims: [...FORBIDDEN_COMMON, /ฆ่าเชื้อ\s*99|ไร้สารพิษ/], forbiddenNote: "ห้ามอ้างการฆ่าเชื้อหรือความปลอดภัยที่ไม่มีเอกสารรับรอง" },
  { family: "GADGET",
    audiences: ["สายเทคที่ดูสเปกก่อนซื้อ", "คนทำงานที่อยากได้อุปกรณ์ช่วยให้โต๊ะทำงานดีขึ้น"],
    needs: ["สเปกตรงความต้องการ", "ใช้ร่วมกับอุปกรณ์เดิมได้", "คุ้มราคา"], stopReasons: ["ตัวเลขสเปกเด่น", "ดีไซน์ที่ดูล้ำ"],
    interestReasons: ["การเชื่อมต่อและขนาด", "การเปรียบเทียบสเปกจริง"],
    styles: [{ mood: "เทคล้ำ คม", lighting: "hard rim light with neon accents", background: "dark reflective surface with cyan and magenta light streaks", palette: ["#0A0A12", "#00E5FF", "#FF2E88"], grade: "COOL" }],
    formats: ["PRODUCT_DETAIL", "COMPARISON", "CURIOSITY", "CINEMATIC_HERO", "BUYING_GUIDE"],
    hooks: generalHooks, contextScenes: ["dark desk setup with soft neon light streaks, no device", "abstract circuit-light motion"],
    forbiddenClaims: [...FORBIDDEN_COMMON, /แบตอึด\s*\d+|ชาร์จไว\s*\d+/], forbiddenNote: "ห้ามอ้างสเปก แบตเตอรี่ หรือความเร็วที่ไม่มีในเอกสารผู้ผลิต" },
  { family: "FASHION", audiences: ["คนที่แต่งตัวตามสไตล์ของตัวเอง", "คนที่หาไอเท็มใส่ได้หลายลุค"],
    needs: ["ไซซ์และวัสดุ", "การแมตช์ชุด"], stopReasons: ["การเปลี่ยนลุคเร็ว", "สีและผิวสัมผัสระยะใกล้"], interestReasons: ["วัสดุ ขนาด สี"],
    styles: [{ mood: "แฟชั่นสตรีท", lighting: "editorial soft box with contrast", background: "urban concrete wall with soft shadows", palette: ["#111111", "#E9E4DA", "#C8553D"], grade: "NEUTRAL" }],
    formats: ["LIFESTYLE", "PRODUCT_DETAIL", "CINEMATIC_HERO", "BUYING_GUIDE"], hooks: generalHooks, contextScenes: ["urban street mood, no clothing items"],
    forbiddenClaims: FORBIDDEN_COMMON, forbiddenNote: "ห้ามอ้างวัสดุหรือแบรนด์ที่ไม่ได้ยืนยัน" },
  { family: "FOOD_SNACK", audiences: ["คนชอบลองของกินใหม่", "คนหาของว่างระหว่างวัน"],
    needs: ["รสชาติ ปริมาณ ราคา"], stopReasons: ["เสียงและภาพระยะใกล้ที่น่ากิน"], interestReasons: ["ส่วนผสมบนฉลาก", "ขนาดบรรจุ"],
    styles: [{ mood: "อบอุ่นน่ากิน", lighting: "warm backlight with steam glow", background: "rustic table with soft bokeh", palette: ["#3B1F0E", "#F4A259", "#FFF8EC"], grade: "WARM" }],
    formats: ["ASMR_SENSORY", "PRODUCT_DETAIL", "LIFESTYLE", "CURIOSITY"], hooks: generalHooks, contextScenes: ["cozy snack-time table mood, no food item"],
    forbiddenClaims: [...FORBIDDEN_COMMON, /ไม่อ้วน|ลดน้ำหนัก|เพื่อสุขภาพ/], forbiddenNote: "ห้ามอ้างผลต่อสุขภาพหรือน้ำหนักตัว" },
  { family: "HEALTH_SUPPLEMENT", audiences: ["ผู้ใหญ่ที่อ่านฉลากอย่างละเอียด"], needs: ["ข้อมูลฉลากและเลขทะเบียน"],
    stopReasons: ["คำถามชวนอ่านฉลาก"], interestReasons: ["ข้อมูลบนฉลากที่ได้รับอนุญาต"],
    styles: [{ mood: "สะอาด น่าเชื่อถือ", lighting: "clinical soft light", background: "white and mint gradient", palette: ["#F4FBF8", "#3AAFA9", "#17252A"], grade: "NEUTRAL" }],
    formats: ["BUYING_GUIDE", "PRODUCT_DETAIL"], hooks: generalHooks, contextScenes: ["calm clean abstract gradient"],
    forbiddenClaims: [...FORBIDDEN_COMMON, /ป้องกันโรค|รักษา|ลดน้ำหนัก|เสริมภูมิ/], forbiddenNote: "หมวดสุขภาพ: ห้ามกล่าวอ้างสรรพคุณใด ๆ นอกฉลากที่ได้รับอนุญาต ต้องตรวจโดยคน" },
  { family: "BABY_TOY", audiences: ["พ่อแม่ที่ให้ความสำคัญกับความปลอดภัย"], needs: ["วัสดุ อายุที่เหมาะสม มาตรฐาน"],
    stopReasons: ["สีสันและการเล่นที่เห็นได้จริง"], interestReasons: ["ช่วงอายุและวัสดุบนฉลาก"],
    styles: [{ mood: "สดใสปลอดภัย", lighting: "soft even daylight", background: "pastel play mat", palette: ["#FFF3B0", "#9AD1D4", "#335C67"], grade: "VIVID" }],
    formats: ["PRODUCT_DETAIL", "BUYING_GUIDE", "LIFESTYLE"], hooks: generalHooks, contextScenes: ["pastel playroom mood, no children"],
    forbiddenClaims: [...FORBIDDEN_COMMON, /ปลอดภัย\s*100|เสริมพัฒนาการ/], forbiddenNote: "ห้ามอ้างพัฒนาการหรือความปลอดภัยเกินเอกสารรับรอง" },
  { family: "PET", audiences: ["เจ้าของสัตว์เลี้ยงที่อยากให้น้องสบาย"], needs: ["ขนาด วัสดุ การทำความสะอาด"],
    stopReasons: ["อารมณ์น่ารักของบ้านที่มีสัตว์เลี้ยง"], interestReasons: ["ขนาดและวัสดุ"],
    styles: [{ mood: "อบอุ่นขี้เล่น", lighting: "warm soft daylight", background: "cozy living room floor", palette: ["#FFF1E6", "#E07A5F", "#3D405B"], grade: "WARM" }],
    formats: ["LIFESTYLE", "PROBLEM_SOLUTION", "PRODUCT_DETAIL"], hooks: generalHooks, contextScenes: ["cozy living-room floor mood, no animals, no product"],
    forbiddenClaims: FORBIDDEN_COMMON, forbiddenNote: "ห้ามอ้างผลต่อสุขภาพสัตว์" },
];
const GENERAL: CategoryPlaybook = { family: "GENERAL", audiences: ["ผู้ชมทั่วไปที่สนใจของใช้ใหม่"], needs: ["รู้ว่าสินค้าคืออะไรและเหมาะกับใคร"],
  stopReasons: ["ภาพที่ไม่คุ้นตา", "คำถามสั้นที่ตรงจุด"], interestReasons: ["ข้อเท็จจริงที่ยืนยันได้"],
  styles: [{ mood: "สะอาดร่วมสมัย", lighting: "soft studio key light", background: "smooth two-tone gradient sweep", palette: ["#1E293B", "#38BDF8", "#F8FAFC"], grade: "NEUTRAL" }],
  formats: ["PRODUCT_DETAIL", "CURIOSITY", "BUYING_GUIDE", "CINEMATIC_HERO", "PROBLEM_SOLUTION"], hooks: generalHooks,
  contextScenes: ["abstract soft gradient studio atmosphere"], forbiddenClaims: FORBIDDEN_COMMON, forbiddenNote: "ห้ามอ้างคุณสมบัติที่ไม่มีหลักฐาน" };

const MATCHERS: Array<[CategoryFamily, RegExp]> = [
  ["WATCH_ACCESSORY", /watch|นาฬิกา|accessor|เครื่องประดับ|jewel/i], ["BEAUTY", /beauty|skin|cosmetic|ความงาม|สกินแคร์|เครื่องสำอาง|serum|เซรั่ม/i],
  ["HOME_KITCHEN", /home|kitchen|บ้าน|ครัว|storage|clean|ทำความสะอาด/i], ["GADGET", /gadget|electronic|tech|อิเล็กทรอนิกส์|อุปกรณ์|charger|หูฟัง|earbud/i],
  ["FASHION", /fashion|cloth|apparel|เสื้อ|กางเกง|รองเท้า|กระเป๋า|bag|shoe/i], ["FOOD_SNACK", /food|snack|ขนม|อาหาร|เครื่องดื่ม|drink|coffee|กาแฟ/i],
  ["HEALTH_SUPPLEMENT", /health|supplement|อาหารเสริม|วิตามิน|vitamin/i], ["BABY_TOY", /baby|toy|ของเล่น|เด็ก|kid/i], ["PET", /pet|สัตว์เลี้ยง|แมว|หมา|dog|cat/i],
];
/** Adapter lookup from the stored category key first, then the title; unknown categories get the general playbook. */
export function categoryPlaybook(categoryKey: string, title = ""): CategoryPlaybook {
  const hit = MATCHERS.find(([, re]) => re.test(categoryKey)) ?? MATCHERS.find(([, re]) => re.test(title));
  return PLAYBOOKS.find(p => p.family === hit?.[0]) ?? GENERAL;
}
