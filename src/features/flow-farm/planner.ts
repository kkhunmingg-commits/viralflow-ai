import { planFlowNative, type HandAction } from "@/features/creative/flow-native";
import type { DirectorFact } from "@/features/creative/ad-director";
import { categoryPlaybook } from "@/features/creative/category-insight";
import { shoppingMoment, trendCaption, trendFormatsFor } from "@/features/creative/trend-playbook";
import type { FlowClipKind } from "./contracts";
import { CTA_VARIANTS, type CtaId, type PlanGuide } from "./learning";

/** A product the one-click search found: best-selling (by stored score) with a cleared photograph. */
export interface FarmProduct {
  id: string; title: string; categoryKey: string; imagePath: string; imageAssetId: string; facts: DirectorFact[];
}
export interface PlannedClip {
  kind: FlowClipKind; productId: string | null; title: string; prompt: string; caption: string; hashtags: string[];
  referenceImagePath: string | null;
}

/** A warm-up clip: one 8-second take built to stop the scroll and earn a follow. No product, no claim.
 * `hook` is the first frame, already mid-action; `twist` lands near second 4; `payoff` is the last frame, framed
 * to loop back into the first. Each belongs to a `series`, because people follow a channel for the next episode. */
interface GrowthConcept { series: string; title: string; hashtags: readonly string[]; line: string; hook: string; twist: string; payoff: string; follow: string }

/** The owner found calm, slow scenes (a tidy desk) boring and not follow-worthy. These are the faceless AI formats
 * that pull follows on Thai TikTok now: miniature cooking, animals doing human jobs, impossible satisfying cuts,
 * sizzling Thai street food and tiny worlds. Ordered so neighbouring clips come from different series. */
const GROWTH_CONCEPTS: readonly GrowthConcept[] = [
  { series: "ครัวจิ๋ว", title: "ครัวจิ๋ว: กะเพราไข่ดาว", hashtags: ["#ครัวจิ๋ว", "#miniaturecooking", "#กะเพรา"],
    line: "กะเพราจานจิ๋ว ใครกินได้คำเดียวหมด",
    hook: "extreme close-up of a thumb-sized wok on a tiny gas stove already roaring with flame; tiny holy basil leaves and minced pork hit the oil and sizzle loudly",
    twist: "a tiny egg is cracked into a coin-sized pan and puffs into a crispy fried egg with lacy golden edges",
    payoff: "the tiny dish of rice, kra pao and fried egg is set on a miniature plate beside a normal-size fork for scale, steam curling up",
    follow: "ติดตามไว้ พรุ่งนี้ครัวจิ๋วทำเมนูอะไรดี คอมเมนต์มาเลย" },
  { series: "แมวทำงาน", title: "แมวบาริสต้า", hashtags: ["#แมว", "#แมวบาริสต้า", "#catsoftiktok"],
    line: "บาริสต้าร้านนี้ ทิปเป็นขนมแมวนะ",
    hook: "a fluffy orange cat in a tiny brown apron stands on its hind legs behind a cosy Thai cafe counter, paws already on the espresso machine handle, steam hissing",
    twist: "the cat pours milk into a cup and a perfect latte-art heart blooms on top",
    payoff: "the cat slides the cup toward the camera, blinks slowly and tilts its head as if waiting for a tip",
    follow: "ติดตามไว้ พรุ่งนี้แมวไปทำงานอะไรต่อ ทายกันมา" },
  { series: "ตัดแล้วเพลิน", title: "หั่นมะม่วงแก้ว", hashtags: ["#asmr", "#oddlysatisfying", "#ตัดแล้วเพลิน"],
    line: "มะม่วงลูกนี้ทำจากแก้ว ฟังเสียงตอนหั่น",
    hook: "a knife is already slicing into a glossy, translucent glass mango on a dark wooden board, light glowing through it",
    twist: "the slice falls away and the inside glitters like crystal with a golden glowing seed",
    payoff: "the knife lifts and the two crystal halves rock gently and settle, glinting, in the same framing as the first frame",
    follow: "ติดตามไว้ พรุ่งนี้จะหั่นอะไรต่อ คอมเมนต์สั่งได้" },
  { series: "สตรีทฟู้ดไทย", title: "หมูกระทะไฟลุก", hashtags: ["#หมูกระทะ", "#สตรีทฟู้ด", "#asmrfood"],
    line: "เสียงนี้คือเสียงหมูกระทะ ใครหิวยกมือ",
    hook: "macro shot of marinated pork slices dropping onto a hot dome grill at night; fat sizzles and flames flare up instantly",
    twist: "chopsticks flip a slice to reveal a perfect caramelised char while broth bubbles around the rim",
    payoff: "the glistening slice is dipped into spicy seafood sauce and lifted toward the camera, steam rising, warm market lights bokeh",
    follow: "ติดตามไว้ พาตะลุยสตรีทฟู้ดไทยทุกวัน" },
  { series: "โลกจิ๋ว", title: "โลกจิ๋วในแก้วชานม", hashtags: ["#โลกจิ๋ว", "#miniatureworld", "#ชานมไข่มุก"],
    line: "ในแก้วชานมนี้ มีเมืองซ่อนอยู่",
    hook: "the camera dives straight down through the lid of a Thai milk tea cup, past drifting tapioca pearls",
    twist: "inside, a tiny glowing floating-market town appears, with miniature boats gliding between pearls",
    payoff: "a tiny boat drifts across the frame, then the camera rises back out to the full cup on the table, framed like the opening",
    follow: "ติดตามไว้ ตอนหน้าจะพาไปโลกจิ๋วในอะไรดี" },
  { series: "ครัวจิ๋ว", title: "ครัวจิ๋ว: ข้าวเหนียวมะม่วง", hashtags: ["#ครัวจิ๋ว", "#ข้าวเหนียวมะม่วง", "#miniaturecooking"],
    line: "ข้าวเหนียวมะม่วงชุดจิ๋ว กินกี่จานถึงอิ่ม",
    hook: "a toy-sized spatula scoops glossy sticky rice into a thimble-sized bowl, steam curling",
    twist: "thick coconut cream is poured over it in slow motion and a tiny mango is sliced into perfect fans",
    payoff: "the finished miniature plate is lit by warm light beside a real coin for scale",
    follow: "ติดตามไว้ พรุ่งนี้ครัวจิ๋วทำเมนูอะไรดี คอมเมนต์มาเลย" },
  { series: "แมวทำงาน", title: "แมวขายส้มตำ", hashtags: ["#แมว", "#ส้มตำ", "#catsoftiktok"],
    line: "แม่ค้าส้มตำร้านนี้ ถามว่าเผ็ดกี่เม็ด",
    hook: "a grey tabby cat in a tiny headscarf pounds a clay mortar with a wooden pestle at a Thai street stall, papaya shreds bouncing",
    twist: "the cat drops in chillies one by one, then stops and stares at the camera as if asking how spicy",
    payoff: "the cat pushes a plate of som tam forward and gives a slow, satisfied blink under warm stall lights",
    follow: "ติดตามไว้ พรุ่งนี้แมวไปทำงานอะไรต่อ ทายกันมา" },
  { series: "ตัดแล้วเพลิน", title: "ตัดเค้กสบู่สีรุ้ง", hashtags: ["#asmr", "#oddlysatisfying", "#ตัดแล้วเพลิน"],
    line: "เสียงตัดแบบนี้ ฟังกี่รอบก็ไม่เบื่อ",
    hook: "a thin blade is already pressing down through a tall rainbow-layered soap block on a white marble table",
    twist: "the cut slice peels away revealing perfect pastel stripes and a sparkling glitter core",
    payoff: "the slice settles flat beside the block, crisp edges catching the light, framing matches the first frame",
    follow: "ติดตามไว้ พรุ่งนี้จะตัดอะไรต่อ คอมเมนต์สั่งได้" },
  { series: "สตรีทฟู้ดไทย", title: "ชีสยืดไข่ระเบิด", hashtags: ["#สตรีทฟู้ด", "#ชีสยืด", "#asmrfood"],
    line: "ชีสยืดขนาดนี้ ให้กี่คะแนน",
    hook: "a hand tears a golden fried cheese ball open at a night-market stall and the cheese stretches upward instantly",
    twist: "the cheese pull keeps stretching higher and higher until the camera tilts up to follow it",
    payoff: "the cheese finally snaps and drapes back down, glistening under neon market lights",
    follow: "ติดตามไว้ พาตะลุยสตรีทฟู้ดไทยทุกวัน" },
  { series: "โลกจิ๋ว", title: "ป่าจิ๋วในขวดแก้ว", hashtags: ["#โลกจิ๋ว", "#terrarium", "#miniatureworld"],
    line: "เมืองนี้อยู่ในขวดโหลใบเดียว",
    hook: "extreme macro inside a glass jar terrarium: morning mist rolls between moss hills and a tiny waterfall pours",
    twist: "tiny lanterns light up one by one along a miniature Thai wooden bridge as dusk falls inside the jar",
    payoff: "the camera pulls back to show the whole jar on a windowsill, the tiny lights still glowing",
    follow: "ติดตามไว้ ตอนหน้าจะพาไปโลกจิ๋วในอะไรดี" },
  // Second wave: more episodes per series, so a series that wins can keep going without repeating itself.
  { series: "ครัวจิ๋ว", title: "ครัวจิ๋ว: ผัดไทยกุ้งสด", hashtags: ["#ครัวจิ๋ว", "#ผัดไทย", "#miniaturecooking"],
    line: "ผัดไทยกระทะจิ๋ว กุ้งตัวเท่าเมล็ดข้าว",
    hook: "a fingertip-sized wok already tossing rice noodles in a flash of orange flame, a tiny shrimp curling pink as it hits the pan",
    twist: "a pinch of crushed peanuts rains down in slow motion and a tiny lime wedge is squeezed, droplets sparkling",
    payoff: "the tiny plate of pad thai is set beside a real chopstick for scale, steam curling, framed like the opening",
    follow: "ติดตามไว้ พรุ่งนี้ครัวจิ๋วทำเมนูอะไรดี คอมเมนต์มาเลย" },
  { series: "ครัวจิ๋ว", title: "ครัวจิ๋ว: ชาไทยแก้วจิ๋ว", hashtags: ["#ครัวจิ๋ว", "#ชาไทย", "#miniaturecooking"],
    line: "ชาไทยแก้วเท่านิ้วโป้ง หวานน้อยหรือหวานปกติ",
    hook: "deep orange Thai tea is already pouring from a thimble-sized cloth filter into a tiny glass full of crushed ice, ice crackling",
    twist: "a thin stream of evaporated milk swirls into the tea and blooms into slow creamy clouds",
    payoff: "a tiny straw is dropped in and the glass sits beside a real coin, condensation beading, in the opening framing",
    follow: "ติดตามไว้ พรุ่งนี้ครัวจิ๋วทำเมนูอะไรดี คอมเมนต์มาเลย" },
  { series: "แมวทำงาน", title: "แมวช่างตัดผม", hashtags: ["#แมว", "#แมวทำงาน", "#catsoftiktok"],
    line: "ร้านตัดผมร้านนี้ ช่างเป็นแมว กล้าตัดไหม",
    hook: "a tuxedo cat in a tiny barber vest is already combing the fluffy fur of a small dog sitting in a miniature barber chair",
    twist: "the cat holds up a hand mirror and the dog's tail starts wagging at its neat new look",
    payoff: "the cat brushes off the chair with its paw and gives the camera a proud slow blink",
    follow: "ติดตามไว้ พรุ่งนี้แมวไปทำงานอะไรต่อ ทายกันมา" },
  { series: "แมวทำงาน", title: "แมวขับตุ๊กตุ๊ก", hashtags: ["#แมว", "#ตุ๊กตุ๊ก", "#catsoftiktok"],
    line: "ตุ๊กตุ๊กคันนี้ คนขับเป็นแมว ไปไหนดี",
    hook: "a ginger cat in tiny sunglasses already grips the handlebars of a small colourful tuk-tuk rolling down a sunny Bangkok soi",
    twist: "the cat honks the horn with one paw and two kittens pop their heads up in the back seat",
    payoff: "the tuk-tuk stops at the curb and the cat turns to the camera and tips its sunglasses down",
    follow: "ติดตามไว้ พรุ่งนี้แมวไปทำงานอะไรต่อ ทายกันมา" },
  { series: "ตัดแล้วเพลิน", title: "หั่นแตงโมคริสตัล", hashtags: ["#asmr", "#oddlysatisfying", "#ตัดแล้วเพลิน"],
    line: "แตงโมลูกนี้ข้างในเป็นคริสตัล ฟังเสียงตอนหั่น",
    hook: "a long knife is already sinking into a glossy watermelon on a black slate board, the rind crackling",
    twist: "the halves fall open and the flesh is clear red crystal with glowing seeds, light refracting through it",
    payoff: "the two crystal halves rock to a stop side by side, glinting, in the same framing as the first frame",
    follow: "ติดตามไว้ พรุ่งนี้จะหั่นอะไรต่อ คอมเมนต์สั่งได้" },
  { series: "ตัดแล้วเพลิน", title: "บีบสไลม์ทองคำ", hashtags: ["#asmr", "#oddlysatisfying", "#slime"],
    line: "สไลม์ทองคำ เสียงบีบแบบนี้ติดหูไหม",
    hook: "two hands are already pressing into a thick, glossy liquid-gold slime on a white table, it squelches and bubbles pop",
    twist: "the slime is stretched wide into a thin shimmering sheet that catches the light like foil",
    payoff: "the slime is folded back into a smooth gold dome that settles slowly, in the opening framing",
    follow: "ติดตามไว้ พรุ่งนี้จะบีบอะไรต่อ คอมเมนต์สั่งได้" },
  { series: "สตรีทฟู้ดไทย", title: "โรตีกล้วยไข่", hashtags: ["#โรตี", "#สตรีทฟู้ด", "#asmrfood"],
    line: "โรตีกล้วยไข่ ราดนมข้นเยอะ ๆ ใครชอบบ้าง",
    hook: "hands are already slapping and stretching a paper-thin roti dough over a hot griddle at a night stall, butter sizzling",
    twist: "sliced banana and beaten egg are folded inside and the roti puffs golden and crisp",
    payoff: "condensed milk drizzles in a slow ribbon over the cut squares, warm stall lights glowing behind",
    follow: "ติดตามไว้ พาตะลุยสตรีทฟู้ดไทยทุกวัน" },
  { series: "สตรีทฟู้ดไทย", title: "ไข่กระทะไฟลุก", hashtags: ["#สตรีทฟู้ด", "#ไข่กระทะ", "#asmrfood"],
    line: "ไข่กระทะร้อน ๆ เช้านี้ เอาแบบนี้กี่กระทะ",
    hook: "eggs are already cracked into a small sizzling cast-iron pan at a morning street stall, the edges bubbling instantly",
    twist: "minced pork, Chinese sausage and spring onion are scattered on top as the yolks wobble",
    payoff: "a fork breaks a yolk and it flows slowly across the pan, steam rising in the morning light",
    follow: "ติดตามไว้ พาตะลุยสตรีทฟู้ดไทยทุกวัน" },
  { series: "โลกจิ๋ว", title: "โลกจิ๋วในกล่องข้าว", hashtags: ["#โลกจิ๋ว", "#miniatureworld", "#ข้าวกล่อง"],
    line: "เปิดกล่องข้าวมาเจอเมืองทั้งเมือง",
    hook: "a lunch box lid is already lifting off and warm light spills out from inside",
    twist: "inside is a tiny rice-terrace village with miniature farmers and water glinting between the green steps",
    payoff: "a tiny bird flies out of the box and the camera settles back on the open lunch box, framed like the opening",
    follow: "ติดตามไว้ ตอนหน้าจะพาไปโลกจิ๋วในอะไรดี" },
  { series: "โลกจิ๋ว", title: "โลกจิ๋วในลูกมะพร้าว", hashtags: ["#โลกจิ๋ว", "#miniatureworld", "#มะพร้าว"],
    line: "ผ่ามะพร้าวลูกนี้ ข้างในเป็นเกาะ",
    hook: "a machete is already splitting a green coconut on a beach table and the top pops off",
    twist: "inside, a tiny tropical island floats in clear coconut water with a miniature longtail boat circling it",
    payoff: "the camera rises to show the open coconut on the sunny table, the tiny boat still drifting inside",
    follow: "ติดตามไว้ ตอนหน้าจะพาไปโลกจิ๋วในอะไรดี" },
];
/** The series a warm-up title belongs to (current and past concepts), for the learning loop. */
export function seriesOfTitle(title: string): string | null {
  const known = GROWTH_CONCEPTS.find(c => c.title === title) ?? Object.values(MOMENT_CONCEPTS).find(c => c.title === title);
  if (known) return known.series;
  const prefix = title.split(":")[0].trim();
  return GROWTH_CONCEPTS.some(c => c.series === prefix) ? prefix : null;
}
/** Season-aware warm-up concepts, used first while their moment lasts. */
const MOMENT_CONCEPTS: Record<string, GrowthConcept> = {
  COOL_SEASON: { series: "แมวทำงาน", title: "แมวขายโกโก้ร้อนหน้าหนาว", hashtags: ["#หน้าหนาว", "#แมว", "#catsoftiktok"],
    line: "หน้าหนาวแล้ว แมวขายโกโก้ร้อน รับกี่แก้ว",
    hook: "a chubby white cat in a tiny knitted scarf ladles steaming hot cocoa at a cosy winter street stall, misty breath in cold morning air",
    twist: "the cat drops a marshmallow in and it puffs up into a tiny cat-face shape",
    payoff: "the cat nudges the steaming mug toward the camera and snuggles into its scarf",
    follow: "ติดตามไว้ พรุ่งนี้แมวไปทำงานอะไรต่อ ทายกันมา" },
  RAINY_SEASON: { series: "โลกจิ๋ว", title: "เมืองจิ๋วใต้ร่ม", hashtags: ["#หน้าฝน", "#โลกจิ๋ว", "#miniatureworld"],
    line: "ฝนตกในเมืองจิ๋ว ทุกคนหลบใต้ร่มใบเดียว",
    hook: "macro of heavy raindrops splashing on a tiny Bangkok street of miniature shophouses and tuk-tuks",
    twist: "a giant real umbrella slowly opens over the whole miniature street and the tiny lights turn on",
    payoff: "rain streams off the umbrella edge in a glowing curtain around the dry, lit-up tiny street",
    follow: "ติดตามไว้ ตอนหน้าจะพาไปโลกจิ๋วในอะไรดี" },
  NEW_YEAR: { series: "ครัวจิ๋ว", title: "ครัวจิ๋ว: เค้กปีใหม่", hashtags: ["#ปีใหม่", "#ครัวจิ๋ว", "#miniaturecooking"],
    line: "เค้กปีใหม่ชิ้นจิ๋ว ขอพรได้หนึ่งข้อ",
    hook: "a thumb-sized cake is being frosted with a tiny spatula, sprinkles already falling",
    twist: "a tiny candle is lit and miniature sparklers burst around the cake",
    payoff: "the tiny cake glows on a coin-sized plate under warm fairy lights",
    follow: "ติดตามไว้ ปีหน้าครัวจิ๋วทำอะไรต่อ คอมเมนต์มาเลย" },
  SONGKRAN: { series: "แมวทำงาน", title: "แมวเล่นสงกรานต์", hashtags: ["#สงกรานต์", "#แมว", "#catsoftiktok"],
    line: "สงกรานต์นี้ แมวขอเล่นด้วย",
    hook: "a cat in a tiny flower-print shirt holds a small water gun on a sunny Thai street, water already spraying in sparkling arcs",
    twist: "a splash comes back at the cat and it freezes with a shocked face, droplets flying in slow motion",
    payoff: "the cat shakes off the water in slow motion, sunlight sparkling through the spray",
    follow: "ติดตามไว้ พรุ่งนี้แมวไปทำงานอะไรต่อ ทายกันมา" },
};

/** Series-specific realism notes: where Flow most often slips for that kind of scene. */
const SERIES_REALISM: Record<string, string> = {
  "ครัวจิ๋ว": "Keep the miniature scale consistent in every frame (tiny utensils next to real-size scale objects); food keeps its real texture, oil sheen and steam.",
  "แมวทำงาน": "Natural cat anatomy at all times: four legs, one tail, real fur that moves with each motion, paws that grip believably; no human hands, no morphing faces.",
  "ตัดแล้วเพลิน": "The cut follows real physics: the blade goes through cleanly in one motion, pieces keep their shape and weight, no jelly wobble on solid objects.",
  "สตรีทฟู้ดไทย": "Real food physics: liquids pour and drip naturally, steam and smoke rise and fade, hands have five fingers and stay steady.",
  "โลกจิ๋ว": "The tiny world keeps a fixed layout and scale during the camera move; buildings and boats never melt, merge or pop in and out.",
};

export function growthPrompt(concept: Pick<GrowthConcept, "hook" | "twist" | "payoff" | "line"> & { series?: string }, options: { strict?: boolean } = {}) {
  const series = concept.series ? SERIES_REALISM[concept.series] : undefined;
  return [
    "Photoreal, cinematic vertical 9:16 video, a full 8 seconds, one continuous take, made to stop people scrolling on TikTok.",
    `0–1 s HOOK: the very first frame is already mid-action, never an empty or static opening: ${concept.hook}.`,
    `3–5 s TWIST: ${concept.twist}.`,
    `6–8 s PAYOFF: ${concept.payoff}. Keep moving gently until the last frame; the final frame mirrors the opening framing so the clip loops seamlessly.`,
    "CAMERA: dynamic and intentional: a fast push-in on the hook, then smooth macro or tracking motion; crisp focus, rich colour, high detail, appetising or magical lighting.",
    // Learned from clips the owner threw away: smooth, physically believable motion is what makes an AI clip look real.
    "REALISM: smooth, steady motion with natural weight and momentum, like real footage shot at 24 fps with soft motion blur; lighting, colours and object shapes stay consistent from the first frame to the last; no morphing, warping, flicker, melting, extra limbs or fingers, or objects appearing from nowhere.",
    ...(series ? [`DETAIL: ${series}`] : []),
    ...(options.strict ? ["EXTRA CARE: earlier clips like this looked artificial. Prefer fewer, slower, simpler movements over complex action; keep every subject fully in frame and in focus; nothing changes shape."] : []),
    `AUDIO: crisp, exaggerated foley that matches every action (sizzle, crunch, pour, clink), plus a lively, playful Thai voice that says only: "${concept.line}" in the first 3 seconds — nothing else; no music.`,
    "AVOID: on-screen text, captions, subtitles, logos, brand names, watermarks, human faces, celebrities, slow or empty openings, cuts or scene changes, ending early.",
  ].join("\n");
}

/** Small seeded random source, so the same day and account plan the same batch. */
function seeded(seed: number) {
  let a = (seed * 2654435761) >>> 0 || 1;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function weightedPick<T>(items: T[], weight: (item: T) => number, random: () => number): T {
  const total = items.reduce((sum, item) => sum + Math.max(0, weight(item)), 0);
  let roll = random() * total;
  for (const item of items) { roll -= Math.max(0, weight(item)); if (roll <= 0) return item; }
  return items[items.length - 1];
}

/** The follow prompt for a clip; the variant ids match CTA_VARIANTS so the learning loop can tell them apart. */
export function ctaText(id: CtaId, concept: Pick<GrowthConcept, "series" | "follow">) {
  switch (id) {
    case "PART_TWO": return "ภาค 2 มาพรุ่งนี้ ติดตามไว้รอดูเลย";
    case "COMMENT_ASK": return `อยากให้${concept.series}ทำอะไรต่อ คอมเมนต์มา เดี๋ยวทำให้ดู กดติดตามไว้ด้วยนะ`;
    case "DONT_LOSE": return "กดติดตามไว้ก่อน เดี๋ยวเลื่อนหาไม่เจอ ตอนใหม่มาทุกวัน";
    case "RATE_IT": return "ให้คะแนนเต็ม 10 กี่คะแนน? ติดตามไว้ มีตอนใหม่ทุกวัน";
    default: return concept.follow;
  }
}

/**
 * Chooses the day's warm-up concepts. Series that brought more views, engagement and follows are picked more often, but
 * every series keeps a chance (so the channel keeps testing), ideas made in the last days are skipped, and two clips in a
 * row never come from the same series.
 */
function chooseGrowth(count: number, guide: PlanGuide | undefined, seasonal: GrowthConcept | undefined, random: () => number) {
  const recent = new Set(guide?.recentTitles ?? []), picked: GrowthConcept[] = [];
  if (seasonal && count > 0 && !(guide?.recentTitles ?? []).slice(0, 6).includes(seasonal.title)) picked.push(seasonal);
  const allSeries = [...new Set(GROWTH_CONCEPTS.map(c => c.series))];
  while (picked.length < count) {
    const used = new Set(picked.map(c => c.title)), last = picked.at(-1)?.series;
    const open = (series: string) => GROWTH_CONCEPTS.filter(c => c.series === series && !used.has(c.title));
    let pool = allSeries.filter(s => s !== last && open(s).length);
    if (!pool.length) pool = allSeries.filter(s => open(s).length);
    if (!pool.length) { picked.push(GROWTH_CONCEPTS[picked.length % GROWTH_CONCEPTS.length]); continue; }
    const series = weightedPick(pool, s => guide?.seriesWeights[s] ?? 1, random);
    const options = open(series), fresh = options.filter(c => !recent.has(c.title));
    // Fresh ideas first; otherwise the one made longest ago.
    const order = guide?.recentTitles ?? [];
    picked.push(fresh.length ? fresh[Math.floor(random() * fresh.length)]
      : options.toSorted((a, b) => order.indexOf(b.title) - order.indexOf(a.title))[0]);
  }
  return picked;
}

/** Plans `count` clips. A selling account with found products gets product ads (rotating products, sets and hand
 * actions); otherwise, or with no cleared product photo, it gets warm-up clips. `offset` rotates concepts by day. */
export function planBatch(input: { mode: FlowClipKind; count: number; products: FarmProduct[]; offset?: number; now?: Date; learning?: PlanGuide }): PlannedClip[] {
  const clips: PlannedClip[] = [], now = input.now ?? new Date(), moment = shoppingMoment(now);
  const seasonal = moment ? MOMENT_CONCEPTS[moment.key] : undefined;
  const affiliate = input.mode === "AFFILIATE" && input.products.length > 0;
  const used = new Map<string, { styleIds: string[]; actions: HandAction[] }>();
  if (!affiliate) {
    const random = seeded((input.offset ?? 0) + 1), guide = input.learning, episodes = { ...guide?.episodes };
    for (const concept of chooseGrowth(input.count, guide, seasonal, random)) {
      const episode = (episodes[concept.series] ?? 0) + 1; episodes[concept.series] = episode;
      const cta = weightedPick(CTA_VARIANTS.map(v => v.id), id => guide?.ctaWeights[id] ?? 1, random);
      // "EP.n" turns single clips into a series people follow for the next episode.
      clips.push({ kind: "GROWTH", productId: null, title: concept.title,
        prompt: growthPrompt(concept, { strict: guide?.strictSeries.includes(concept.series) }),
        caption: `${concept.series} EP.${episode} · ${concept.line}\n${ctaText(cta, concept)}`,
        hashtags: [...concept.hashtags, "#AIart", "#fyp", "#ฟีดดดシ"], referenceImagePath: null });
    }
    return clips;
  }
  for (let index = 0; index < input.count; index++) {
    const product = input.products[(index + (input.offset ?? 0)) % input.products.length];
    const history = used.get(product.id) ?? { styleIds: [], actions: [] };
    // Each clip of a product takes the next trend format of its category, so a batch is not five copies of one ad.
    const formats = trendFormatsFor(categoryPlaybook(product.categoryKey, product.title)), round = history.styleIds.length;
    const format = formats[(round + (input.offset ?? 0)) % formats.length], variant = round + (input.offset ?? 0);
    const plan = planFlowNative({ product: { id: product.id, title: product.title, categoryKey: product.categoryKey },
      facts: product.facts, assets: [{ id: product.imageAssetId, kind: "REAL_IMAGE", rightsCleared: true }], history },
      { trend: { format, variant, setTouch: moment?.setTouch || undefined } });
    const shot = plan.selected[0];
    history.styleIds.push(shot.style.id); history.actions.push(shot.action); used.set(product.id, history);
    const { caption, hashtags } = trendCaption(product, format, variant, now);
    clips.push({ kind: "AFFILIATE", productId: product.id, title: `${product.title} · ${format.nameTh} · ${shot.style.nameTh}`, prompt: shot.prompt,
      caption, hashtags, referenceImagePath: product.imagePath });
  }
  return clips;
}
