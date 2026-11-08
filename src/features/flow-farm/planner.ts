import { planFlowNative, type HandAction } from "@/features/creative/flow-native";
import type { DirectorFact } from "@/features/creative/ad-director";
import { categoryPlaybook } from "@/features/creative/category-insight";
import { shoppingMoment, trendCaption, trendFormatsFor } from "@/features/creative/trend-playbook";
import type { FlowClipKind } from "./contracts";
import { CTA_VARIANTS, type CtaId, type PlanGuide } from "./learning";
import { NICHE_KEYS, NICHES, nicheOfSeries, type NicheKey } from "./niches";
import { productAngle, viralAngle, viralVoice, VIRAL_DIRECTION, VIRAL_SAFETY, VIRAL_VOICE_STYLE, type ViralAngle } from "@/features/creative/viral-engine";

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
interface GrowthConcept {
  series: string; title: string; hashtags: readonly string[]; line: string; hook: string; twist: string; payoff: string; follow: string;
  /** Built from the start around a big surprise or escalation (Lucky, 8 Nov: clips must aim for viral); picked first. */
  energy?: "HIGH";
}

/** The owner found calm, slow scenes (a tidy desk) boring and not follow-worthy. These are the faceless AI formats
 * that pull follows on Thai TikTok now: miniature cooking, animals doing human jobs, impossible satisfying cuts,
 * sizzling Thai street food and tiny worlds. Ordered so neighbouring clips come from different series. */
const GROWTH_CONCEPTS: readonly GrowthConcept[] = [
  { series: "ครัวจิ๋ว", title: "ครัวจิ๋ว: กะเพราไข่ดาว", hashtags: ["#ครัวจิ๋ว", "#miniaturecooking", "#กะเพรา"],
    line: "กะเพราจานจิ๋ว ใครกินได้คำเดียวหมด",
    hook: "extreme close-up of a thumb-sized wok on a tiny gas stove already roaring with flame; tiny holy basil leaves and minced pork hit the oil and sizzle loudly while a tiny fried egg with lacy golden edges crisps at one side of the same wok",
    twist: "a toy-sized spatula tosses the pork and basil in the same wok, the leaves wilting glossy and dark in real time",
    payoff: "the spatula lifts a small heap of steaming kra pao with the fried egg on top out of the same wok toward the camera, a normal-size fork lying beside the stove for scale",
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
    hook: "macro shot of marinated pork slices dropping onto a hot dome grill at night, a small cup of spicy seafood sauce already sitting at the grill's edge; fat sizzles and flames flare up instantly",
    twist: "chopsticks flip a slice to reveal a perfect caramelised char while broth bubbles around the rim",
    payoff: "chopsticks dip the same glistening slice into that sauce cup and lift it toward the camera, steam rising, warm market lights bokeh",
    follow: "ติดตามไว้ พาตะลุยสตรีทฟู้ดไทยทุกวัน" },
  { series: "โลกจิ๋ว", title: "โลกจิ๋วในแก้วชานม", hashtags: ["#โลกจิ๋ว", "#miniatureworld", "#ชานมไข่มุก"],
    line: "ในแก้วชานมนี้ มีเมืองซ่อนอยู่",
    hook: "the camera dives straight down through the lid of a Thai milk tea cup, past drifting tapioca pearls",
    twist: "inside, a tiny glowing floating-market town appears, with miniature boats gliding between pearls",
    payoff: "a tiny boat drifts across the frame, then the camera rises back out to the full cup on the table, framed like the opening",
    follow: "ติดตามไว้ ตอนหน้าจะพาไปโลกจิ๋วในอะไรดี" },
  { series: "ครัวจิ๋ว", title: "ครัวจิ๋ว: ข้าวเหนียวมะม่วง", hashtags: ["#ครัวจิ๋ว", "#ข้าวเหนียวมะม่วง", "#miniaturecooking"],
    line: "ข้าวเหนียวมะม่วงชุดจิ๋ว กินกี่จานถึงอิ่ม",
    hook: "a coin-sized plate already holds a mound of glossy sticky rice beside a tiny fanned mango; a toy-sized spoon pats the rice into a neat dome, steam curling",
    twist: "thick coconut cream is poured from a thimble-sized jug over the same rice in slow motion, pooling around it",
    payoff: "a pinch of toasted mung beans is sprinkled on top and the same plate sits in warm light beside a real coin for scale",
    follow: "ติดตามไว้ พรุ่งนี้ครัวจิ๋วทำเมนูอะไรดี คอมเมนต์มาเลย" },
  { series: "แมวทำงาน", title: "แมวขายส้มตำ", hashtags: ["#แมว", "#ส้มตำ", "#catsoftiktok"],
    line: "แม่ค้าส้มตำร้านนี้ ถามว่าเผ็ดกี่เม็ด",
    hook: "a grey tabby cat in a tiny headscarf pounds a clay mortar with a wooden pestle at a Thai street stall, papaya shreds bouncing",
    twist: "the cat drops in chillies one by one, then stops and stares at the camera as if asking how spicy",
    payoff: "the cat pushes the same clay mortar of som tam forward and gives a slow, satisfied blink under warm stall lights",
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
    twist: "a pinch of crushed peanuts rains down into the same wok in slow motion and a tiny lime wedge is squeezed over it, droplets sparkling",
    payoff: "tiny tongs lift a twirl of noodles with the pink shrimp out of the same wok toward the camera, a real chopstick resting beside it for scale, steam curling",
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
    hook: "a square roti parcel, already folded around sliced banana and egg, sizzles in a pool of butter on a flat steel griddle at a night stall while a hand presses it flat with a metal spatula",
    twist: "the spatula flips the same roti over in one motion, revealing a crisp golden-brown underside, butter bubbling around its edges",
    payoff: "still on the griddle, the spatula edge chops the same roti into bite-size squares and a hand drizzles condensed milk over them from a squeeze bottle in a slow ribbon, warm stall lights glowing behind",
    follow: "ติดตามไว้ พาตะลุยสตรีทฟู้ดไทยทุกวัน" },
  { series: "สตรีทฟู้ดไทย", title: "ไข่กระทะไฟลุก", hashtags: ["#สตรีทฟู้ด", "#ไข่กระทะ", "#asmrfood"],
    line: "ไข่กระทะร้อน ๆ เช้านี้ เอาแบบนี้กี่กระทะ",
    hook: "eggs are already cracked into a small sizzling cast-iron pan at a morning street stall, the edges bubbling instantly",
    twist: "a hand sprinkles minced pork, Chinese sausage and spring onion from a small bowl onto the same pan as the yolks wobble",
    payoff: "a fork breaks a yolk and it flows slowly across the same pan, steam rising in the morning light",
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
  // Third wave: more niches (หมวด) so the channel can find what its audience likes: comedy, mystery, lucky numbers, dogs.
  { series: "หมาดราม่า", title: "หมาดราม่า: โดนแย่งที่นอน", hashtags: ["#หมา", "#หมาดราม่า", "#dogsoftiktok"],
    line: "ที่นอนของหนู แมวมาแย่งไปแล้ว ไม่ยอมนะ",
    hook: "a fluffy golden puppy stands frozen right beside its round dog bed, staring at the smug cat already curled up in it",
    twist: "the puppy flops onto the floor next to the bed and lets out a long dramatic sigh, ears drooping",
    payoff: "the cat slowly scoots over and the puppy squeezes in next to it, both settling with a contented blink",
    follow: "ติดตามไว้ พรุ่งนี้หมาดราม่าเรื่องอะไรอีก ทายกันมา" },
  { series: "หมาดราม่า", title: "หมาดราม่า: ไม่อยากอาบน้ำ", hashtags: ["#หมา", "#หมาดราม่า", "#dogsoftiktok"],
    line: "ได้ยินคำว่าอาบน้ำ หมาหายตัวทันที",
    hook: "in a hallway, a corgi is already tiptoeing backwards away from an open bathroom door as bath water runs inside, a long floor curtain hanging right beside it",
    twist: "it ducks behind that same curtain but its round fluffy bottom and wagging stump of a tail stick out",
    payoff: "the corgi peeks out, sees the camera and freezes with wide guilty eyes, in the opening framing",
    follow: "ติดตามไว้ พรุ่งนี้หมาดราม่าเรื่องอะไรอีก ทายกันมา" },
  { series: "หมาดราม่า", title: "หมาดราม่า: ขอขนมแบบมืออาชีพ", hashtags: ["#หมา", "#หมาขี้อ้อน", "#dogsoftiktok"],
    line: "สายตาแบบนี้ ใครจะใจแข็งไม่ให้ขนม",
    hook: "a small brown dog sits perfectly straight beside a kitchen counter, already staring up with huge glossy pleading eyes",
    twist: "it lifts one paw and slowly tilts its head, then the other paw, like it is practising a routine",
    payoff: "a treat drops into frame and the dog catches it mid-air, then wiggles its whole body with joy",
    follow: "ติดตามไว้ พรุ่งนี้หมาดราม่าเรื่องอะไรอีก ทายกันมา" },
  { series: "ผลไม้ปากแจ๋ว", title: "ผลไม้ปากแจ๋ว: ทุเรียนโดนแซว", hashtags: ["#ตลก", "#ผลไม้ปากแจ๋ว", "#ฮาๆ"],
    line: "ทุเรียนบอกว่า หอมนะ แต่ไม่มีใครกล้ายืนใกล้",
    hook: "photoreal fruits with small expressive cartoon eyes and mouths sit on a market table; a durian puffs out its spiky chest proudly",
    twist: "a mango, a banana and a mangosteen slowly lean away from the durian, fanning the air with leaves",
    payoff: "the durian looks around at the empty space and pouts, its spikes drooping, in the opening framing",
    follow: "ติดตามไว้ พรุ่งนี้ผลไม้ตัวไหนโดนแซวต่อ" },
  { series: "ผลไม้ปากแจ๋ว", title: "ผลไม้ปากแจ๋ว: มะนาวขี้งอน", hashtags: ["#ตลก", "#ผลไม้ปากแจ๋ว", "#ฮาๆ"],
    line: "มะนาวงอน เพราะไม่มีใครชวนไปใส่ส้มตำ",
    hook: "photoreal fruits with small cartoon eyes and mouths; a lime sits alone at the edge of a cutting board with a sulky face",
    twist: "a chilli and a tomato roll over and nudge it toward a clay mortar of som tam",
    payoff: "the lime hops into the mortar with a big grin and a tiny splash, the others cheering",
    follow: "ติดตามไว้ พรุ่งนี้ผลไม้ตัวไหนโดนแซวต่อ" },
  { series: "ผลไม้ปากแจ๋ว", title: "ผลไม้ปากแจ๋ว: แตงโมแข่งกลิ้ง", hashtags: ["#ตลก", "#ผลไม้ปากแจ๋ว", "#ฮาๆ"],
    line: "แข่งกลิ้งรอบนี้ แตงโมมั่นใจมาก",
    hook: "photoreal fruits with cartoon eyes line up at a chalk start line on a wooden table; a big watermelon grins confidently",
    twist: "the oranges race off but the watermelon only rocks in place, straining, its face going red",
    payoff: "a tiny grape gives it a push and the watermelon rolls slowly past the finish line, beaming",
    follow: "ติดตามไว้ พรุ่งนี้ผลไม้ตัวไหนโดนแซวต่อ" },
  { series: "ครัวป่วน", title: "ครัวป่วน: กาต้มน้ำขี้ตกใจ", hashtags: ["#ตลก", "#ครัวป่วน", "#ฮาๆ"],
    line: "กาต้มน้ำตัวนี้ ตกใจง่ายมาก",
    hook: "a shiny kitchen kettle with small cartoon eyes sits on a stove, already trembling as bubbles start inside",
    twist: "it whistles loudly, jumps in surprise at its own sound and its lid pops up like a hat",
    payoff: "the lid lands back on, the kettle looks around embarrassed and lets out a small puff of steam",
    follow: "ติดตามไว้ พรุ่งนี้ของในครัวชิ้นไหนป่วนต่อ" },
  { series: "ครัวป่วน", title: "ครัวป่วน: ทัพพีแอบชิม", hashtags: ["#ตลก", "#ครัวป่วน", "#ฮาๆ"],
    line: "ทัพพีบอกว่า ชิมนิดเดียว จริง ๆ นะ",
    hook: "a wooden ladle with tiny cartoon eyes is already sneaking out of a utensil jar toward a pot of tom yum on the stove beside it, the kitchen light off",
    twist: "it dips in for a sip and its eyes go wide from the spice, little steam puffs shooting out",
    payoff: "it tiptoes back into the same utensil jar and stands perfectly still beside the spoons, pretending nothing happened",
    follow: "ติดตามไว้ พรุ่งนี้ของในครัวชิ้นไหนป่วนต่อ" },
  { series: "ครัวป่วน", title: "ครัวป่วน: ไข่ไม่ยอมลงกระทะ", hashtags: ["#ตลก", "#ครัวป่วน", "#ฮาๆ"],
    line: "ไข่ฟองนี้ ไม่ยอมลงกระทะเด็ดขาด",
    hook: "an egg with tiny cartoon eyes clings to the rim of a hot frying pan, oil already sizzling below, an open egg carton further along the counter",
    twist: "a spatula gently nudges it and the egg rolls away along the counter at full speed toward the carton",
    payoff: "the same egg tucks itself into that egg carton and peeks out, while the pan sits waiting, in the opening framing",
    follow: "ติดตามไว้ พรุ่งนี้ของในครัวชิ้นไหนป่วนต่อ" },
  { series: "ลี้ลับยามดึก", title: "ลี้ลับยามดึก: ชิงช้าแกว่งเอง", hashtags: ["#เรื่องลี้ลับ", "#สยองขวัญ", "#ลี้ลับยามดึก"],
    line: "ตีสามแล้ว ชิงช้านี้ยังแกว่งอยู่ ทั้งที่ไม่มีลม",
    hook: "an empty wooden swing under a big banyan tree in a moonlit Thai village yard is already swinging slowly on its own",
    twist: "the swing stops dead mid-air for a second, fireflies freeze, then it starts swinging again",
    payoff: "the camera slowly pulls back; the swing creaks gently in the blue moonlight, framed like the opening",
    follow: "ติดตามไว้ คืนพรุ่งนี้มีเรื่องลี้ลับเรื่องใหม่" },
  { series: "ลี้ลับยามดึก", title: "ลี้ลับยามดึก: ลิฟต์ชั้น 13", hashtags: ["#เรื่องลี้ลับ", "#สยองขวัญ", "#ลี้ลับยามดึก"],
    line: "ตึกนี้ไม่มีชั้น 13 แต่ลิฟต์หยุดทุกคืน",
    hook: "inside an empty old apartment elevator at night, the floor indicator light is already climbing with a soft hum",
    twist: "the doors slide open onto a dim corridor with a single flickering lamp and a pair of slippers neatly placed",
    payoff: "the doors slowly close again on the empty corridor and the hum resumes, in the opening framing",
    follow: "ติดตามไว้ คืนพรุ่งนี้มีเรื่องลี้ลับเรื่องใหม่" },
  { series: "ลี้ลับยามดึก", title: "ลี้ลับยามดึก: ตุ๊กตาหันหน้า", hashtags: ["#เรื่องลี้ลับ", "#สยองขวัญ", "#ลี้ลับยามดึก"],
    line: "วางตุ๊กตาหันไปทางหน้าต่าง ตื่นมาหันมาทางเตียงทุกวัน",
    hook: "a porcelain doll in a Thai dress sits on a wooden shelf facing a moonlit window, curtains already drifting",
    twist: "the curtain sways across it and when it passes, the doll is facing the camera",
    payoff: "the camera creeps slowly toward the doll's calm face as the curtain settles, silent and still",
    follow: "ติดตามไว้ คืนพรุ่งนี้มีเรื่องลี้ลับเรื่องใหม่" },
  { series: "ตำนานไทย", title: "ตำนานไทย: ไฟพญานาค", hashtags: ["#ตำนานไทย", "#บั้งไฟพญานาค", "#เรื่องลี้ลับ"],
    line: "คืนออกพรรษา ลูกไฟสีแดงลอยขึ้นจากแม่น้ำโขง",
    hook: "the dark Mekong river at night, mist on the water, as a glowing red-orange fireball is already rising silently from the surface",
    twist: "two more fireballs rise in a row and the water ripples as if something huge moved underneath",
    payoff: "the fireballs fade high in the sky and the river goes calm and dark again, framed like the opening",
    follow: "ติดตามไว้ ตอนหน้าเล่าตำนานไทยเรื่องไหนดี" },
  { series: "ตำนานไทย", title: "ตำนานไทย: ต้นตะเคียนกลางป่า", hashtags: ["#ตำนานไทย", "#ต้นตะเคียน", "#เรื่องลี้ลับ"],
    line: "ต้นตะเคียนต้นนี้ ใครผ่านต้องไหว้ทุกครั้ง",
    hook: "a giant ancient takhian tree deep in a misty forest at dusk, wrapped in colourful silk ribbons that are already fluttering",
    twist: "the wind stops but the ribbons keep moving, and a faint warm glow appears between the roots",
    payoff: "a single jasmine garland slowly swings on a low branch as the light fades, the tree framed like the opening",
    follow: "ติดตามไว้ ตอนหน้าเล่าตำนานไทยเรื่องไหนดี" },
  { series: "ตำนานไทย", title: "ตำนานไทย: แมวดำหน้าศาล", hashtags: ["#ตำนานไทย", "#แมวดำ", "#เรื่องลี้ลับ"],
    line: "แมวดำนั่งเฝ้าศาลพระภูมิทุกคืน ไม่เคยกินอะไรเลย",
    hook: "a sleek black cat already sits perfectly still in front of a small Thai spirit house lit by candles at night",
    twist: "the candle flames lean toward the cat all at once and its eyes reflect a soft gold glow",
    payoff: "the cat slowly turns its head to look straight at the camera, then back to the shrine",
    follow: "ติดตามไว้ ตอนหน้าเล่าตำนานไทยเรื่องไหนดี" },
  { series: "ปาฏิหาริย์สายมู", title: "ปาฏิหาริย์สายมู: ควันธูปพญานาค", hashtags: ["#ปาฏิหาริย์", "#มูเตลู", "#เรื่องลี้ลับ"],
    line: "จุดธูปไหว้ศาลคืนนี้ ควันลอยขึ้นมาเป็นแบบนี้ เคยเห็นไหม",
    hook: "macro of three lit incense sticks in a brass bowl in front of a Thai shrine at night, smoke already curling upward in slow spirals",
    twist: "the smoke gathers into a long coiling serpent-like shape, like a naga rising, glowing faintly in the candlelight before it drifts apart",
    payoff: "the smoke swirls softly again in warm candlelight, in the opening framing",
    follow: "ติดตามไว้ คืนพรุ่งนี้มีเรื่องลี้ลับสายมูเรื่องใหม่" },
  { series: "ปาฏิหาริย์สายมู", title: "ปาฏิหาริย์สายมู: เทียนไม่ดับกลางลม", hashtags: ["#ปาฏิหาริย์", "#มูเตลู", "#เรื่องลี้ลับ"],
    line: "ลมแรงขนาดนี้ แต่เทียนเล่มนี้ไม่ดับเลย",
    hook: "a single golden candle burning on an old temple altar at night, strong wind already whipping the cloth and leaves around it",
    twist: "everything around it shakes in the wind, yet the candle flame stays perfectly upright and still, glowing brighter",
    payoff: "the wind dies down, the leaves settle and the flame gives one slow flicker, framed like the opening",
    follow: "ติดตามไว้ คืนพรุ่งนี้มีเรื่องลี้ลับสายมูเรื่องใหม่" },
  { series: "ปาฏิหาริย์สายมู", title: "ปาฏิหาริย์สายมู: บัวบานใต้แสงจันทร์", hashtags: ["#ปาฏิหาริย์", "#มูเตลู", "#เรื่องลี้ลับ"],
    line: "บัวในสระวัด บานกลางดึกคืนวันพระ",
    hook: "a still temple lotus pond under a full moon, mist drifting on the water, a white lotus bud already starting to open",
    twist: "the lotus opens fully in slow motion and a soft silver light glows from its centre, rippling across the water",
    payoff: "the glow fades gently and moonlight shimmers on the calm pond, in the opening framing",
    follow: "ติดตามไว้ คืนพรุ่งนี้มีเรื่องลี้ลับสายมูเรื่องใหม่" },
  { series: "ปาฏิหาริย์สายมู", title: "ปาฏิหาริย์สายมู: หินคริสตัลรับแสงจันทร์", hashtags: ["#ปาฏิหาริย์", "#มูเตลู", "#เรื่องลี้ลับ"],
    line: "คืนจันทร์เต็มดวง สายมูเอาหินมาวางรับแสงแบบนี้",
    hook: "a cluster of clear and rose quartz crystals on a wooden windowsill at night, full-moon light already pouring onto them",
    twist: "the moonlight seems to soak into the crystals, which begin to glow softly from within, one after another",
    payoff: "the crystals hold a gentle inner glow as a thin cloud drifts past the moon, framed like the opening",
    follow: "ติดตามไว้ คืนพรุ่งนี้มีเรื่องลี้ลับสายมูเรื่องใหม่" },
  { series: "สายมู", title: "สายมู: แมวกวักทองคำ", hashtags: ["#สายมู", "#มูเตลู", "#แมวกวัก"],
    line: "แมวกวักตัวนี้กวักเงินมาให้ ใครรับ พิมพ์สาธุ",
    hook: "a gleaming golden lucky cat statue on a shop counter is already waving its paw, gold coins glinting beside it",
    twist: "with each wave, a few shiny gold coins tumble gently out of a red pouch beside it",
    payoff: "the cat's eyes catch a warm sparkle of light as coins settle in a small pile, in the opening framing",
    follow: "ติดตามไว้ พรุ่งนี้มีของมงคลชิ้นใหม่" },
  { series: "สายมู", title: "สายมู: ดอกบัวบานรับโชค", hashtags: ["#สายมู", "#มูเตลู", "#ดอกบัว"],
    line: "ดอกบัวบานตรงหน้า ขอพรได้หนึ่งข้อ พิมพ์สาธุ",
    hook: "a pink lotus bud in a brass bowl of water in front of a golden Buddha image, its petals already starting to open",
    twist: "the lotus blooms fully in slow motion and a soft golden light glows from its centre",
    payoff: "a single petal drifts onto the water and the light softly pulses, calm and still",
    follow: "ติดตามไว้ พรุ่งนี้มีของมงคลชิ้นใหม่" },
  { series: "สายมู", title: "สายมู: ระฆังวัดยามเช้า", hashtags: ["#สายมู", "#มูเตลู", "#วัดไทย"],
    line: "ได้ยินเสียงระฆังนี้ ขอให้มีแต่เรื่องดี ๆ พิมพ์สาธุ",
    hook: "a row of small golden temple bells along an eave at sunrise, the first bell already swinging and ringing",
    twist: "the bells ring one after another down the row as morning mist lifts off the temple roof",
    payoff: "warm sunlight floods the golden roof as the last bell sways to a stop, in the opening framing",
    follow: "ติดตามไว้ พรุ่งนี้มีของมงคลชิ้นใหม่" },
  { series: "เที่ยววิวสวย", title: "เที่ยววิวสวย: ทะเลหมอกดอยตอนเช้า", hashtags: ["#เที่ยวไทย", "#ทะเลหมอก", "#วิวสวย"],
    line: "ตื่นตีห้ามาเจอวิวนี้ คุ้มไหม",
    hook: "a steaming enamel mug of coffee on a wooden railing at a mountain campsite, a sea of clouds already rolling below at sunrise",
    twist: "the sun breaks over the ridge and golden light sweeps across the cloud sea and a small tent beside the railing",
    payoff: "the camera pulls back to show the tent, the mug and the endless glowing clouds, framed like the opening",
    follow: "ติดตามไว้ พรุ่งนี้พาไปเที่ยวที่ไหนต่อ" },
  { series: "เที่ยววิวสวย", title: "เที่ยววิวสวย: กางเต็นท์ริมน้ำตก", hashtags: ["#เที่ยวไทย", "#แคมป์ปิ้ง", "#วิวสวย"],
    line: "กางเต็นท์ข้างน้ำตก หลับฟังเสียงน้ำทั้งคืน",
    hook: "a dome tent already glowing warm from a lantern inside, beside a waterfall in a green forest at dusk",
    twist: "fireflies rise from the grass and the waterfall shimmers in the lantern light",
    payoff: "the camera drifts slowly around the tent as the forest turns deep blue, the lantern still glowing",
    follow: "ติดตามไว้ พรุ่งนี้พาไปเที่ยวที่ไหนต่อ" },
  { series: "เที่ยววิวสวย", title: "เที่ยววิวสวย: ทะเลใสกลางเกาะ", hashtags: ["#เที่ยวไทย", "#ทะเลไทย", "#วิวสวย"],
    line: "น้ำใสขนาดนี้ อยู่ในไทยจริง ๆ นะ",
    hook: "aerial shot already gliding low over crystal-clear turquoise water toward a white-sand island with a longtail boat",
    twist: "the camera dips to the surface and colourful fish dart under the boat's shadow",
    payoff: "the camera rises back up to the island and the bright water, framed like the opening",
    follow: "ติดตามไว้ พรุ่งนี้พาไปเที่ยวที่ไหนต่อ" },
  { series: "แต่งห้องฟิน", title: "แต่งห้องฟิน: ห้องรกกลายเป็นห้องฝัน", hashtags: ["#แต่งห้อง", "#roommakeover", "#ห้องสวย"],
    line: "ห้องรกแบบนี้ แต่งใหม่ใน 8 วินาที",
    hook: "a messy small bedroom with clothes piled on a chair, already starting to tidy itself in a fast smooth time-lapse where every item moves as a whole object",
    twist: "the clothes fold and slide into a drawer, fairy lights already strung on the wall switch on and the bed smooths into crisp white linen",
    payoff: "the finished cosy room glows warmly at night, same framing as the first frame",
    follow: "ติดตามไว้ พรุ่งนี้แต่งห้องไหนต่อ" },
  { series: "แต่งห้องฟิน", title: "แต่งห้องฟิน: มุมทำงานมินิมอล", hashtags: ["#แต่งห้อง", "#deskmakeover", "#มุมทำงาน"],
    line: "มุมทำงานแบบนี้ นั่งทั้งวันก็ไม่เบื่อ",
    hook: "a bare wooden desk by a window, a warm desk lamp already clicking on in the evening light",
    twist: "a hand sets down a small plant, a ceramic mug and a soft LED strip one by one with satisfying clicks",
    payoff: "the camera slowly pushes in on the cosy finished desk as rain streaks the window",
    follow: "ติดตามไว้ พรุ่งนี้แต่งห้องไหนต่อ" },
  { series: "แต่งห้องฟิน", title: "แต่งห้องฟิน: ระเบียงคอนโดสายชิล", hashtags: ["#แต่งห้อง", "#ระเบียง", "#คอนโด"],
    line: "ระเบียงเล็ก ๆ ก็ชิลได้",
    hook: "an empty condo balcony at sunset, a folded rattan chair already unfolding by itself",
    twist: "string lights already hooked along the railing switch on bulb by bulb and a hand slides two potted plants into the corners",
    payoff: "the city lights come on beyond the cosy balcony as the camera settles, framed like the opening",
    follow: "ติดตามไว้ พรุ่งนี้แต่งห้องไหนต่อ" },
  { series: "แกดเจ็ตล้ำ", title: "แกดเจ็ตล้ำ: แก้วกาแฟเปลี่ยนสี", hashtags: ["#แกดเจ็ต", "#ของมันต้องมี", "#gadget"],
    line: "แก้วนี้บอกได้ว่ากาแฟร้อนแค่ไหน",
    hook: "hot coffee is already pouring into a sleek matte black mug on a desk",
    twist: "the mug's surface ripples with colour, shifting from deep blue to glowing orange as it heats",
    payoff: "steam curls up from the glowing mug as the camera slowly orbits it",
    follow: "ติดตามไว้ พรุ่งนี้มีแกดเจ็ตล้ำอะไรอีก" },
  { series: "แกดเจ็ตล้ำ", title: "แกดเจ็ตล้ำ: โคมไฟลอยได้", hashtags: ["#แกดเจ็ต", "#ของมันต้องมี", "#gadget"],
    line: "หลอดไฟลอยกลางอากาศ เปิดปิดด้วยการแตะ",
    hook: "a glowing bulb is already hovering and slowly spinning above a wooden base on a dark bedside table",
    twist: "a fingertip taps the base and the bulb brightens, casting warm moving shadows around the room",
    payoff: "the bulb settles into a gentle bob, glowing softly in the dark, framed like the opening",
    follow: "ติดตามไว้ พรุ่งนี้มีแกดเจ็ตล้ำอะไรอีก" },
  { series: "แกดเจ็ตล้ำ", title: "แกดเจ็ตล้ำ: หุ่นยนต์ดูดฝุ่นจิ๋ว", hashtags: ["#แกดเจ็ต", "#ของมันต้องมี", "#gadget"],
    line: "หุ่นยนต์ตัวเท่าฝ่ามือ ทำความสะอาดโต๊ะให้",
    hook: "a palm-sized round robot is already gliding across a desk, sweeping crumbs into itself with a soft whirr",
    twist: "it reaches the desk edge, stops, beeps and turns neatly away",
    payoff: "it parks beside a laptop and its tiny light blinks to green",
    follow: "ติดตามไว้ พรุ่งนี้มีแกดเจ็ตล้ำอะไรอีก" },
  { series: "บิวตี้ ASMR", title: "บิวตี้ ASMR: ครีมหมุนวน", hashtags: ["#ASMR", "#skincare", "#บิวตี้"],
    line: "เนื้อครีมแบบนี้ ดูกี่รอบก็เพลิน",
    hook: "macro of a silky white cream already swirling in a glass jar under soft pink light",
    twist: "a spatula lifts a glossy ribbon of cream that folds back over itself in slow motion",
    payoff: "the surface settles into a smooth glossy swirl, catching the light, framed like the opening",
    follow: "ติดตามไว้ พรุ่งนี้ ASMR อะไรต่อ" },
  { series: "บิวตี้ ASMR", title: "บิวตี้ ASMR: ลิปสติกละลาย", hashtags: ["#ASMR", "#ลิปสติก", "#บิวตี้"],
    line: "สีนี้สวยจนอยากเก็บไว้ดูเฉย ๆ",
    hook: "a deep red lipstick bullet is already twisting up from its gold case on a marble surface",
    twist: "it is pressed into a glass and smears into a perfect glossy swatch, light rippling across it",
    payoff: "the lipstick twists back down and the case clicks shut beside the swatch",
    follow: "ติดตามไว้ พรุ่งนี้ ASMR อะไรต่อ" },
  { series: "บิวตี้ ASMR", title: "บิวตี้ ASMR: เซรั่มหยดน้ำ", hashtags: ["#ASMR", "#เซรั่ม", "#บิวตี้"],
    line: "หยดเดียวผิวฉ่ำ ดูแล้วชื่นใจ",
    hook: "a glass dropper is already releasing a single golden drop of serum onto a glossy surface in slow motion",
    twist: "the drop spreads into a shimmering clear circle with tiny bubbles rising",
    payoff: "a second drop falls into the centre and ripples spread outward softly",
    follow: "ติดตามไว้ พรุ่งนี้ ASMR อะไรต่อ" },
  { series: "สวนจิ๋วในบ้าน", title: "สวนจิ๋วในบ้าน: เมล็ดงอกใน 8 วิ", hashtags: ["#ปลูกต้นไม้", "#ต้นไม้ในบ้าน", "#plant"],
    line: "จากเมล็ดเดียว กลายเป็นต้นไม้ในพริบตา",
    hook: "macro time-lapse of soil in a small clay pot, a seed already cracking open and a green shoot pushing up",
    twist: "the shoot unfurls two leaves, then more leaves spiral upward toward window light",
    payoff: "the small leafy plant sways gently in the sunlight, framed like the opening",
    follow: "ติดตามไว้ พรุ่งนี้ปลูกอะไรต่อ" },
  { series: "สวนจิ๋วในบ้าน", title: "สวนจิ๋วในบ้าน: มุมต้นไม้ริมหน้าต่าง", hashtags: ["#ต้นไม้ในบ้าน", "#แต่งบ้าน", "#plant"],
    line: "มุมนี้มีต้นไม้ ห้องดูมีชีวิตขึ้นเลย",
    hook: "a sunny windowsill with one small pot, a watering can already tipping water into it",
    twist: "a hand sets down pots of monstera, pothos and cactus one by one beside it, leaves bouncing as they land",
    payoff: "morning light streams through the lush green corner as droplets glisten on leaves",
    follow: "ติดตามไว้ พรุ่งนี้ปลูกอะไรต่อ" },
  { series: "สวนจิ๋วในบ้าน", title: "สวนจิ๋วในบ้าน: ดอกไม้บานรับฝน", hashtags: ["#ต้นไม้", "#ดอกไม้", "#plant"],
    line: "ฝนตกปุ๊บ ดอกไม้บานปั๊บ",
    hook: "raindrops are already splashing onto a pot of closed flower buds on a balcony",
    twist: "the buds burst open into bright pink flowers in slow motion as water beads on the petals",
    payoff: "the rain eases and a sunbeam lights up the blooming pot, framed like the opening",
    follow: "ติดตามไว้ พรุ่งนี้ปลูกอะไรต่อ" },
  { series: "รถสวยติดล้อ", title: "รถสวยติดล้อ: ขับเลียบทะเลตอนเย็น", hashtags: ["#ขับรถเที่ยว", "#roadtrip", "#รถ"],
    line: "ขับเลียบทะเลตอนพระอาทิตย์ตก ฟินที่สุด",
    hook: "a camera mounted on a car's side is already gliding along a coastal road at golden hour, waves sparkling beside it",
    twist: "the road curves and the sun dips into the sea, painting the car's glossy paint orange",
    payoff: "the car rolls to a stop at a viewpoint as the last light fades, framed like the opening",
    follow: "ติดตามไว้ พรุ่งนี้พาขับไปไหนต่อ" },
  { series: "รถสวยติดล้อ", title: "รถสวยติดล้อ: ล้างรถฟองฟู", hashtags: ["#ล้างรถ", "#ASMR", "#รถ"],
    line: "ล้างรถแบบนี้ ดูแล้วสะอาดตาม",
    hook: "thick white foam is already sliding down the glossy dark paint of a parked car",
    twist: "a pressure rinse sweeps across, revealing a mirror-like shine that reflects the sky",
    payoff: "water beads roll off the gleaming paint in slow motion as the camera glides past",
    follow: "ติดตามไว้ พรุ่งนี้พาขับไปไหนต่อ" },
  { series: "รถสวยติดล้อ", title: "รถสวยติดล้อ: ขึ้นดอยในสายหมอก", hashtags: ["#ขับรถเที่ยว", "#ขึ้นดอย", "#รถ"],
    line: "ทางขึ้นดอยในหมอก ขับช้า ๆ ปลอดภัยนะ",
    hook: "headlights are already cutting through thick mist on a winding mountain road lined with pine trees",
    twist: "the car climbs above the mist and a sea of clouds appears beside the road",
    payoff: "the car pauses on the ridge, the cloud sea glowing in morning light",
    follow: "ติดตามไว้ พรุ่งนี้พาขับไปไหนต่อ" },
  { series: "แฟชั่นแปลงร่าง", title: "แฟชั่นแปลงร่าง: ชุดเดียวแต่งได้ 3 ลุค", hashtags: ["#แฟชั่น", "#แต่งตัว", "#ootd"],
    line: "เสื้อตัวเดียว แต่งได้ 3 ลุค เลือกลุคไหน",
    hook: "a flat-lay of a white shirt, jeans and sneakers on a wooden floor, hands already smoothing the shirt flat",
    twist: "the hands swap the jeans for a pleated skirt and the sneakers for loafers, then lay a blazer over the shirt, each item placed in one quick clean move",
    payoff: "the finished outfit lies neatly arranged on the floor as the camera pulls up, framed like the opening",
    follow: "ติดตามไว้ พรุ่งนี้แปลงร่างชุดไหนต่อ" },
  { series: "แฟชั่นแปลงร่าง", title: "แฟชั่นแปลงร่าง: รองเท้าผ้าใบใหม่เอี่ยม", hashtags: ["#แฟชั่น", "#sneakers", "#รองเท้า"],
    line: "รองเท้าคู่ใหม่ เสียงตอนแกะกล่องฟินมาก",
    hook: "a shoebox lid is already lifting off and tissue paper unfolds with a crisp rustle",
    twist: "a pair of clean white sneakers rises out and laces tie themselves into neat bows",
    payoff: "the sneakers land side by side on the box under a soft spotlight",
    follow: "ติดตามไว้ พรุ่งนี้แปลงร่างชุดไหนต่อ" },
  { series: "แฟชั่นแปลงร่าง", title: "แฟชั่นแปลงร่าง: กระเป๋าใบนี้ใส่อะไรได้บ้าง", hashtags: ["#แฟชั่น", "#whatsinmybag", "#กระเป๋า"],
    line: "กระเป๋าใบเล็ก แต่ใส่ของได้เยอะเกิน",
    hook: "a small leather bag sits open on a bed, a hand already dropping items into it one by one",
    twist: "a phone, a wallet, sunglasses and a small bottle slide in neatly, each keeping its real size",
    payoff: "the hand zips the same bag shut and it sits slightly full as the camera pushes in",
    follow: "ติดตามไว้ พรุ่งนี้แปลงร่างชุดไหนต่อ" },
  { series: "ฟิตจิ๋ว", title: "ฟิตจิ๋ว: แฮมสเตอร์เข้ายิม", hashtags: ["#ออกกำลังกาย", "#แฮมสเตอร์", "#fitness"],
    line: "แฮมสเตอร์ยังขยัน คุณล่ะวันนี้ออกกำลังยัง",
    hook: "a chubby hamster in a tiny sweatband is already running hard on a miniature treadmill in a tiny gym, a sunflower-seed dumbbell and a tiny towel already on the floor beside it",
    twist: "it hops off and lifts that seed dumbbell, cheeks puffing",
    payoff: "it flops onto the same tiny towel beside a mini water bottle, panting happily",
    follow: "ติดตามไว้ พรุ่งนี้ใครออกกำลังกายต่อ" },
  { series: "ฟิตจิ๋ว", title: "ฟิตจิ๋ว: แมวโยคะยามเช้า", hashtags: ["#โยคะ", "#แมว", "#fitness"],
    line: "โยคะตอนเช้ากับครูแมว ยืดตามไหวไหม",
    hook: "a fluffy cat on a tiny yoga mat is already stretching into a long downward-dog pose in morning sunlight",
    twist: "it rolls into a perfect loaf shape, then stretches one leg high into the air",
    payoff: "it settles into a calm sitting pose and blinks slowly at the camera",
    follow: "ติดตามไว้ พรุ่งนี้ใครออกกำลังกายต่อ" },
  { series: "ฟิตจิ๋ว", title: "ฟิตจิ๋ว: วิ่งเช้าริมสวน", hashtags: ["#วิ่ง", "#ออกกำลังกาย", "#fitness"],
    line: "วิ่งเช้าวันละนิด ร่างกายดีขึ้นเยอะ",
    hook: "low-angle shot of running shoes already hitting a park path at sunrise, dew flying off the grass",
    twist: "the camera rises to follow the runner's shadow stretching long across the path past a lake",
    payoff: "the shoes slow to a stop at a bench as the sun lights up the mist over the lake",
    follow: "ติดตามไว้ พรุ่งนี้ใครออกกำลังกายต่อ" },
  // Fourth wave (Lucky, 8 Nov: "our program is called Viral, these clips are too chill"): every idea is built around a
  // big surprise, an escalation or a reaction people send to friends, and is picked before the calmer ideas.
  { series: "แมวทำงาน", title: "แมวเชฟกระทะไฟลุก", energy: "HIGH", hashtags: ["#แมว", "#แมวทำงาน", "#catsoftiktok"],
    line: "เชฟแมวโชว์ไฟ ลูกค้าหนีหมดร้าน",
    hook: "a chubby orange cat in a tiny chef hat stands on a stool at a street-food wok, already tossing rice high into the air as a tall burst of orange flame leaps up from the wok",
    twist: "the cat flips the wok harder and the rice flies in a huge golden arc, the cat's eyes going wide as it tracks it",
    payoff: "the rice lands perfectly back in the same wok and the cat turns to the camera with a smug slow blink, flames still dancing",
    follow: "ติดตามไว้ พรุ่งนี้แมวไปทำงานอะไรต่อ ทายกันมา" },
  { series: "แมวทำงาน", title: "แมวพนักงานส่งของ", energy: "HIGH", hashtags: ["#แมว", "#แมวทำงาน", "#catsoftiktok"],
    line: "ไรเดอร์แมว ส่งไวกว่าคนอีก",
    hook: "a black cat in a tiny delivery jacket is already speeding toward the camera on a small scooter down a Bangkok soi, a delivery box strapped on the back",
    twist: "the scooter skids to a stylish stop sideways right in front of the camera, a little puff of dust rising",
    payoff: "the cat pops the box open and pushes a tiny steaming bowl of noodles toward the camera, then salutes with one paw",
    follow: "ติดตามไว้ พรุ่งนี้แมวไปทำงานอะไรต่อ ทายกันมา" },
  { series: "หมาดราม่า", title: "หมาดราม่า: โดนจับได้คาหนังคาเขา", energy: "HIGH", hashtags: ["#หมา", "#หมาดราม่า", "#dogsoftiktok"],
    line: "ใครกินขนมบนโต๊ะ หมาบอกไม่ใช่หนู",
    hook: "a golden retriever puppy is already halfway onto a kitchen chair, nose deep in a plate of cookies, crumbs flying",
    twist: "the kitchen light flicks on and the puppy freezes mid-chew, a cookie still sticking out of its mouth, eyes darting to the camera",
    payoff: "the puppy slowly slides off the chair and sits up perfectly straight, cheeks puffed, pretending nothing happened",
    follow: "ติดตามไว้ พรุ่งนี้หมาดราม่าเรื่องอะไรอีก ทายกันมา" },
  { series: "หมาดราม่า", title: "หมาดราม่า: แข่งกับแมว", energy: "HIGH", hashtags: ["#หมา", "#หมาแมว", "#dogsoftiktok"],
    line: "แข่งวิ่งรอบนี้ หมามั่นใจมาก แต่…",
    hook: "a corgi and a grey cat crouch side by side at a chalk start line in a sunny living room, both already wiggling, ready to sprint",
    twist: "they burst off together, the corgi's short legs blurring, and the cat simply leaps over it in one huge slow-motion jump",
    payoff: "the cat lands first on the sofa at the finish and the corgi skids into the cushion, ears flopping, tail still wagging",
    follow: "ติดตามไว้ พรุ่งนี้หมาดราม่าเรื่องอะไรอีก ทายกันมา" },
  { series: "ครัวจิ๋ว", title: "ครัวจิ๋ว: ไข่เจียวยักษ์ในกระทะจิ๋ว", energy: "HIGH", hashtags: ["#ครัวจิ๋ว", "#ไข่เจียว", "#miniaturecooking"],
    line: "ไข่เจียวฟูขนาดนี้ กระทะจิ๋วรับไหวไหม",
    hook: "beaten egg is already pouring into a thumb-sized wok of roaring hot oil, and it instantly erupts into a crackling, puffing golden cloud",
    twist: "the omelette keeps puffing up bigger and bigger, towering over the tiny wok while oil bubbles loudly around its lacy edges",
    payoff: "a toy-sized spatula flips the giant fluffy omelette over in the same wok, a real coin beside the stove for scale",
    follow: "ติดตามไว้ พรุ่งนี้ครัวจิ๋วทำเมนูอะไรดี คอมเมนต์มาเลย" },
  { series: "สตรีทฟู้ดไทย", title: "ชาไทยดึงสูงสามเมตร", energy: "HIGH", hashtags: ["#ชาไทย", "#สตรีทฟู้ด", "#asmrfood"],
    line: "ชงชาแบบนี้ ร้านนี้ไม่ธรรมดา",
    hook: "at a busy night-market stall, a vendor's hands are already pulling a stream of orange Thai tea from one steel jug down into another held far below",
    twist: "the hands pull the jugs further apart until the glossy orange stream is impossibly long, arcing through the warm market lights without spilling a drop",
    payoff: "the stream lands perfectly into a tall glass of crushed ice, foam rising to the rim in slow motion",
    follow: "ติดตามไว้ พาตะลุยสตรีทฟู้ดไทยทุกวัน" },
  { series: "ผลไม้ปากแจ๋ว", title: "ผลไม้ปากแจ๋ว: พริกท้าดวล", energy: "HIGH", hashtags: ["#ตลก", "#ผลไม้ปากแจ๋ว", "#ฮาๆ"],
    line: "พริกขี้หนูท้าทุกคน ใครกล้าสู้",
    hook: "photoreal fruits and vegetables with small cartoon eyes on a kitchen board; a tiny red chilli is already puffing itself up and glaring at a big calm cucumber",
    twist: "the chilli lets out a tiny burst of steam from its top and the cucumber's eyes go huge as it starts to sweat little droplets",
    payoff: "the cucumber faints backwards onto the board and the chilli does a tiny victory hop as the other fruits gasp",
    follow: "ติดตามไว้ พรุ่งนี้ผลไม้ตัวไหนโดนแซวต่อ" },
  { series: "ครัวป่วน", title: "ครัวป่วน: ข้าวโพดคั่วแตกตื่น", energy: "HIGH", hashtags: ["#ตลก", "#ครัวป่วน", "#ฮาๆ"],
    line: "ป๊อปคอร์นหม้อนี้ คุมไม่อยู่แล้ว",
    hook: "a small pot with cartoon eyes sits on a stove, its lid already rattling and jumping as popcorn starts popping inside",
    twist: "the lid shoots up and popcorn bursts out in a huge slow-motion fountain, the pot's eyes going wide in panic",
    payoff: "the popcorn rains down around the stove and the pot catches its own lid back on its head, looking embarrassed",
    follow: "ติดตามไว้ พรุ่งนี้ของในครัวชิ้นไหนป่วนต่อ" },
  { series: "ตัดแล้วเพลิน", title: "ผ่าลูกบอลน้ำผึ้ง", energy: "HIGH", hashtags: ["#asmr", "#oddlysatisfying", "#ตัดแล้วเพลิน"],
    line: "ผ่าลูกนี้แล้ว ข้างในทำเอาอึ้ง",
    hook: "a sharp knife is already pressing into a glossy amber sphere on a black marble board, the surface bending under the blade",
    twist: "the sphere splits open and thick golden honey cascades out in slow motion, glowing in a beam of light",
    payoff: "a honeycomb core is revealed, honey still flowing down the board as the knife lifts away",
    follow: "ติดตามไว้ พรุ่งนี้จะหั่นอะไรต่อ คอมเมนต์สั่งได้" },
  { series: "โลกจิ๋ว", title: "โลกจิ๋ว: พายุในแก้วน้ำ", energy: "HIGH", hashtags: ["#โลกจิ๋ว", "#miniatureworld", "#พายุ"],
    line: "ในแก้วน้ำใบนี้ มีพายุทั้งลูก",
    hook: "extreme macro of a clear glass of water on a table where a tiny storm cloud is already swirling above a miniature sailboat",
    twist: "tiny lightning flashes inside the glass and the waves rise high, the little boat climbing a giant wave in slow motion",
    payoff: "the sun breaks through the tiny cloud and a mini rainbow appears over the calm water as the boat sails on",
    follow: "ติดตามไว้ ตอนหน้าจะพาไปโลกจิ๋วในอะไรดี" },
  { series: "ลี้ลับยามดึก", title: "ลี้ลับยามดึก: ไฟดับทีละดวง", energy: "HIGH", hashtags: ["#เรื่องลี้ลับ", "#ลี้ลับยามดึก", "#หลอน"],
    line: "ไฟทางเดินดับทีละดวง แล้วมันกำลังมาทางนี้",
    hook: "a long empty apartment corridor at night, lit by a row of ceiling lamps; the farthest lamp is already flickering out",
    twist: "the lamps go dark one after another, faster and faster, the darkness racing down the corridor toward the camera with a low hum",
    payoff: "the lamp right above the camera buzzes, flickers, and holds on by a thread as the corridor behind it sits in total darkness",
    follow: "ติดตามไว้ คืนพรุ่งนี้มีเรื่องลี้ลับเรื่องใหม่" },
  { series: "แกดเจ็ตล้ำ", title: "แกดเจ็ตล้ำ: โดรนจิ๋วเสิร์ฟกาแฟ", energy: "HIGH", hashtags: ["#แกดเจ็ต", "#แกดเจ็ตล้ำ", "#tech"],
    line: "สั่งกาแฟปุ๊บ โดรนเสิร์ฟปั๊บ",
    hook: "a palm-sized unbranded drone is already zipping across a modern cafe counter, carrying a small paper coffee cup in its claw",
    twist: "it banks sharply around a stack of cups and drops into a perfect slow-motion hover right in front of the camera",
    payoff: "the claw opens and sets the cup down gently on the table without spilling, then the drone zips away out of frame",
    follow: "ติดตามไว้ พรุ่งนี้มีแกดเจ็ตอะไรอีก" },
  { series: "เที่ยววิวสวย", title: "เที่ยววิวสวย: ทะเลหมอกพุ่งขึ้นฟ้า", energy: "HIGH", hashtags: ["#ทะเลหมอก", "#เที่ยวไทย", "#วิวสวย"],
    line: "ยืนตรงนี้ตอนเช้า แล้วจะรู้ว่าคุ้ม",
    hook: "a fast drone shot already racing low over a sea of white mist between dark mountain ridges at sunrise",
    twist: "the drone shoots straight up through the mist and bursts out into blazing golden sunlight above the clouds",
    payoff: "it spins slowly to reveal a lone mountain peak with a tiny temple glowing above the endless mist",
    follow: "ติดตามไว้ พรุ่งนี้พาไปวิวไหนต่อ" },
  { series: "แต่งห้องฟิน", title: "แต่งห้องฟิน: กดทีเดียวห้องเปลี่ยนโหมด", energy: "HIGH", hashtags: ["#แต่งห้อง", "#แต่งห้องฟิน", "#roomtour"],
    line: "กดสวิตช์เดียว ห้องนี้เปลี่ยนโหมดทันที",
    hook: "in a dim, plain bedroom a finger is already pressing a wall switch, close to the camera",
    twist: "a wave of warm LED light races along the ceiling edge, the bed's headboard glows and a projector throws a starry sky across the ceiling",
    payoff: "the camera swoops back to show the whole cosy room glowing, stars slowly drifting across the ceiling",
    follow: "ติดตามไว้ พรุ่งนี้แต่งห้องแบบไหนต่อ" },
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
    hook: "a chubby white cat in a tiny knitted scarf ladles steaming hot cocoa into a mug already on the counter of a cosy winter street stall, misty breath in cold morning air",
    twist: "the cat drops a marshmallow in and it puffs up into a tiny cat-face shape",
    payoff: "the cat nudges that same steaming mug toward the camera and snuggles into its scarf",
    follow: "ติดตามไว้ พรุ่งนี้แมวไปทำงานอะไรต่อ ทายกันมา" },
  RAINY_SEASON: { series: "โลกจิ๋ว", title: "เมืองจิ๋วใต้ร่ม", hashtags: ["#หน้าฝน", "#โลกจิ๋ว", "#miniatureworld"],
    line: "ฝนตกในเมืองจิ๋ว ทุกคนหลบใต้ร่มใบเดียว",
    hook: "macro of heavy raindrops splashing on a tiny Bangkok street of miniature shophouses and tuk-tuks",
    twist: "a giant real umbrella slowly opens over the whole miniature street and the tiny lights turn on",
    payoff: "rain streams off the umbrella edge in a glowing curtain around the dry, lit-up tiny street",
    follow: "ติดตามไว้ ตอนหน้าจะพาไปโลกจิ๋วในอะไรดี" },
  NEW_YEAR: { series: "ครัวจิ๋ว", title: "ครัวจิ๋ว: เค้กปีใหม่", hashtags: ["#ปีใหม่", "#ครัวจิ๋ว", "#miniaturecooking"],
    line: "เค้กปีใหม่ชิ้นจิ๋ว ขอพรได้หนึ่งข้อ",
    hook: "a thumb-sized cake on a coin-sized plate is being frosted with a tiny spatula, sprinkles already falling",
    twist: "a tiny candle is pushed into the same cake and lit, miniature sparklers fizzing beside the plate",
    payoff: "the same tiny cake glows on its plate under warm fairy lights",
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
  "สตรีทฟู้ดไทย": "Real food physics: liquids pour and drip naturally, steam and smoke rise and fade, the dough or food keeps its real thickness and texture; hands have five fingers, stay steady and are the only thing that moves the food.",
  "โลกจิ๋ว": "The tiny world keeps a fixed layout and scale during the camera move; buildings and boats never melt, merge or pop in and out.",
  "หมาดราม่า": "Natural dog anatomy at all times: four legs, one tail, real fur that moves with each motion; expressions come from ears, eyes and posture, never human faces.",
  "ผลไม้ปากแจ๋ว": "Fruits keep their real shape, colour and texture; the small cartoon eyes and mouth stay fixed on the same spot of each fruit and move smoothly.",
  "ครัวป่วน": "Utensils keep their real shape and material; the small cartoon eyes stay fixed in place; movements are small, bouncy and physically plausible.",
  "ลี้ลับยามดึก": "Eerie, slow and quiet, not gory: no blood, no monsters, no faces in the dark; tension comes from stillness, shadows and something moving on its own.",
  "ตำนานไทย": "Atmospheric and respectful of Thai beliefs: mist, candlelight, moonlight; no blood or frightening faces; slow and steady camera.",
  // The owner dropped the lucky-number series: lottery and gambling hints break TikTok rules. Belief clips stay mystical.
  "ปาฏิหาริย์สายมู": "Mystical, reverent and calm: candlelight, moonlight, mist and soft glows; the strange moment forms naturally from the material (smoke, flame, water, light); never any digits, numbers, lottery tickets, money or gambling.",
  "เที่ยววิวสวย": "Real landscapes with natural light and weather; no people's faces; camera moves like a smooth drone or gimbal.",
  "แต่งห้องฟิน": "Furniture and objects keep their shape and size as they move into place; straight lines stay straight; warm, believable interior light.",
  "แกดเจ็ตล้ำ": "No brand names or logos on any device; materials look real (matte plastic, metal, glass); glowing effects stay subtle.",
  "บิวตี้ ASMR": "Macro product textures look real and glossy; no brand names; no faces; slow, smooth, satisfying motion.",
  "สวนจิ๋วในบ้าน": "Plants grow with natural leaf shapes and real soil texture; time-lapse motion is smooth, never morphing.",
  "รถสวยติดล้อ": "No brand logos or licence plates; cars keep their real shape; wheels turn in sync with motion; safe, calm driving.",
  "แฟชั่นแปลงร่าง": "No brand logos; fabric folds and drapes like real cloth; transitions are clean snaps, not melting.",
  "ฟิตจิ๋ว": "Natural animal anatomy; tiny gym props stay to scale; any person appears only as feet, hands or a shadow, never a face.",
  "สายมู": "Reverent, warm, golden light; sacred objects are shown respectfully, never stepped on or treated as toys; slow, graceful motion; never any digits, numbers, lottery tickets or gambling.",
};

/** Food series get the cooking-stage rule: the owner saw a roti clip where the dough turned into a plate mid-take,
 * because the prompt asked for three cooking stages and a final frame that "mirrors" the first. */
const FOOD_SERIES = new Set<string>(NICHES.FOOD.series);

/** Applies to every niche: one place, the same objects throughout, change only through a visible cause. */
const CONTINUITY = "CONTINUITY (most important): one unbroken shot in one location, like real footage from a single camera. " +
  "Every subject in the first frame is the same physical object in the last frame, with the same identity, size, colour and count. " +
  "Anything that changes does so gradually, at real-world speed, through a visible cause (a hand, a tool, heat, water, gravity or the action described above); " +
  "no object turns into a different object, nothing skips ahead in time, nothing teleports, multiplies, or appears or vanishes on its own, and the background, props and their positions stay fixed.";
const COOKING_CONTINUITY = "COOKING: show only one cooking stage, as if filmed on a phone at the stall. The same single portion of food stays in the same pan, griddle, wok or dish for all 8 seconds " +
  "and changes only through what the hands and utensils visibly do (press, flip, fold, toss, cut, pour, sprinkle). Every ingredient that is added is already visible in a bowl or a hand before it goes in. " +
  "The food never turns into a plate, bowl or different dish, never jumps ahead to a finished state, and only moves to other dishware if a hand is shown carrying it there.";

export function growthPrompt(concept: Pick<GrowthConcept, "hook" | "twist" | "payoff" | "line"> & { series?: string }, options: { strict?: boolean; angle?: ViralAngle } = {}) {
  const series = concept.series ? SERIES_REALISM[concept.series] : undefined;
  const food = concept.series ? FOOD_SERIES.has(concept.series) : false;
  // Lucky, 8 Nov: every warm-up clip is built to go viral (retention angle, escalation, energetic voice), not to relax.
  const angle = options.angle ?? viralAngle(0);
  return [
    "Photoreal, cinematic vertical 9:16 video, a full 8 seconds, one continuous take in one location, made to stop people scrolling on TikTok and make them follow for the next one.",
    `0–1 s HOOK: the very first frame is already mid-action, never an empty or static opening: ${concept.hook}.`,
    "1–3 s: the hook action keeps going smoothly and leads straight into the next beat, with no jump in time.",
    `3–5 s TWIST: ${concept.twist}.`,
    // "Mirror the opening" made Flow rewind the subject to its first state (dough back to a plate); only the camera returns.
    `6–8 s PAYOFF: ${concept.payoff}. Keep the energy up and end on motion. For a seamless loop the camera ends near its opening angle, but every subject keeps the state it has reached; nothing rewinds, resets or swaps back to look like the first frame.`,
    VIRAL_DIRECTION,
    `RETENTION ANGLE: ${angle.direction}`,
    CONTINUITY,
    ...(food ? [COOKING_CONTINUITY] : []),
    "CAMERA: dynamic and intentional: a fast push-in on the hook, then smooth macro or tracking motion that keeps the main subject in frame; crisp focus, rich colour, high detail, appetising or magical lighting.",
    // Learned from clips the owner threw away: smooth, physically believable motion is what makes an AI clip look real.
    "REALISM: smooth, steady motion with natural weight and momentum, like real footage shot at 24 fps with soft motion blur; lighting, colours and object shapes stay consistent from the first frame to the last; no morphing, warping, flicker, melting, extra limbs or fingers, or objects appearing from nowhere.",
    ...(series ? [`DETAIL: ${series}`] : []),
    ...(options.strict ? ["EXTRA CARE: earlier clips like this looked artificial. Prefer fewer, slower, simpler movements over complex action; keep every subject fully in frame and in focus; nothing changes shape."] : []),
    `AUDIO: crisp, exaggerated, punchy foley that matches every action (sizzle, crunch, pour, clink) with an impact hit on the twist and a whoosh into the peak, plus ${VIRAL_VOICE_STYLE} that says only: "${viralVoice(angle, concept.line)}" in the first 3 seconds — nothing else; no music.`,
    VIRAL_SAFETY,
    `AVOID: on-screen text, captions, subtitles, logos, brand names, watermarks, human faces, celebrities, slow, calm or empty openings, idle moments, cuts or scene changes, time jumps, ` +
      `one object morphing into another${food ? ", food turning into a plate or a different dish, finished food appearing without being cooked" : ""}, ending early.`,
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
 * Chooses the day's warm-up concepts. While the channel is still finding its niche, clips rotate across niches
 * (animals, food, comedy, mystery, lucky numbers...), favouring those that already did well; once a niche is chosen
 * (by the results or by the owner), about four in five clips come from it and the rest keep testing others.
 * Ideas made in the last days are skipped, and the same series never runs twice in a row when there is another choice.
 */
function chooseGrowth(count: number, guide: PlanGuide | undefined, seasonal: GrowthConcept | undefined, random: () => number) {
  const recent = new Set(guide?.recentTitles ?? []), picked: GrowthConcept[] = [], focus = guide?.focusNiche ?? null;
  // The season's clip leads only when it fits the channel's niche (or no niche is set yet).
  if (seasonal && count > 0 && !(guide?.recentTitles ?? []).slice(0, 6).includes(seasonal.title) &&
    (!focus || nicheOfSeries(seasonal.series) === focus)) picked.push(seasonal);
  const allSeries = [...new Set(GROWTH_CONCEPTS.map(c => c.series))];
  const nicheWeight = (key: NicheKey) => guide?.nicheWeights?.[key] ?? 1;
  while (picked.length < count) {
    const used = new Set(picked.map(c => c.title)), last = picked.at(-1);
    const open = (series: string) => GROWTH_CONCEPTS.filter(c => c.series === series && !used.has(c.title));
    const lastNiche = last ? nicheOfSeries(last.series) : null;
    const niches = NICHE_KEYS.filter(n => NICHES[n].series.some(sr => open(sr).length));
    if (!niches.length) { picked.push(GROWTH_CONCEPTS[picked.length % GROWTH_CONCEPTS.length]); continue; }
    let niche: NicheKey;
    if (focus && niches.includes(focus) && random() < 0.8) niche = focus;
    else {
      const others = niches.filter(n => n !== focus && n !== lastNiche);
      niche = weightedPick(others.length ? others : niches, nicheWeight, random);
    }
    let pool = NICHES[niche].series.filter(sr => allSeries.includes(sr) && sr !== last?.series && open(sr).length);
    if (!pool.length) pool = NICHES[niche].series.filter(sr => open(sr).length);
    const series = weightedPick(pool, sr => guide?.seriesWeights[sr] ?? 1, random);
    const options = open(series), fresh = options.filter(c => !recent.has(c.title));
    // Fresh ideas first, the high-energy ones (built around a big surprise) about three times in four; otherwise the
    // one made longest ago.
    const order = guide?.recentTitles ?? [], hot = fresh.filter(c => c.energy === "HIGH");
    picked.push(hot.length && random() < 0.75 ? hot[Math.floor(random() * hot.length)]
      : fresh.length ? fresh[Math.floor(random() * fresh.length)]
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
    for (const [index, concept] of chooseGrowth(input.count, guide, seasonal, random).entries()) {
      const episode = (episodes[concept.series] ?? 0) + 1; episodes[concept.series] = episode;
      const cta = weightedPick(CTA_VARIANTS.map(v => v.id), id => guide?.ctaWeights[id] ?? 1, random);
      const angle = viralAngle(index, input.offset ?? 0);
      // Caption: a curiosity hook people read first, "EP.n" so they follow for the next episode, the follow prompt,
      // and one real question that gets comments. The first line stays unique (it ends with the concept's own line),
      // because the learning loop pairs posted TikTok videos with clips by it.
      clips.push({ kind: "GROWTH", productId: null, title: concept.title,
        prompt: growthPrompt(concept, { strict: guide?.strictSeries.includes(concept.series), angle }),
        caption: `${angle.captionHook} · ${concept.series} EP.${episode} · ${concept.line}\n${ctaText(cta, concept)}\n${angle.engage}`,
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
      { trend: { format, variant, setTouch: moment?.setTouch || undefined, viral: productAngle(index, input.offset ?? 0) } });
    const shot = plan.selected[0];
    history.styleIds.push(shot.style.id); history.actions.push(shot.action); used.set(product.id, history);
    const { caption: base, hashtags } = trendCaption(product, format, variant, now), angle = productAngle(index, input.offset ?? 0);
    // A hook people read first and a real question at the end; the product line and facts stay as written.
    const caption = `${angle.captionHook}\n${base}\n${angle.engage}`;
    clips.push({ kind: "AFFILIATE", productId: product.id, title: `${product.title} · ${format.nameTh} · ${shot.style.nameTh}`, prompt: shot.prompt,
      caption, hashtags, referenceImagePath: product.imagePath });
  }
  return clips;
}
