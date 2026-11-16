/**
 * Endless, non-repeating clip ideas for the channel's AI girl (16 Nov owner: "16 ideas are not enough, we post 2–3
 * a day; clips may follow on from each other, at most 5, and the direction must not wander: a day goes morning,
 * noon, evening, bedtime"). Ideas come as short story arcs of 3–5 episodes built from pools of places, outfits,
 * food and moves, so there are tens of thousands of combinations. Pure.
 */

export const GIRL_SERIES = ["วันหนึ่งของน้อง", "เที่ยวกับน้อง", "แปลงลุควับ", "ก่อน/หลัง", "ชาเลนจ์เต้น", "สายแซ่บ", "POV แฟน", "เลือก 1 หรือ 2"] as const;
export type GirlSeries = (typeof GIRL_SERIES)[number];

export interface Episode {
  /** Thai, shown in the title and caption, e.g. "ตื่นนอน: ยืดเส้นริมหน้าต่าง". */
  label: string;
  start: string; turn: string; end: string;
  /** The Thai she says (short: Flow's audio step fails on long lines). */
  line: string;
  music: boolean;
  hashtags: readonly string[];
  /** 16 Nov owner: "more exciting, teasing, medium sexy up to the limit". GLAM = confident, alluring and fitted;
   * FLIRTY = playful teasing to the viewer; unset = cute. Each changes the STYLE line of the prompt. */
  vibe?: "FLIRTY" | "GLAM";
}
export interface Arc { series: GirlSeries; name: string; episodes: Episode[] }

type Random = () => number;
const pick = <T,>(list: readonly T[], random: Random): T => list[Math.floor(random() * list.length) % list.length];
function pickSome<T>(list: readonly T[], n: number, random: Random): T[] {
  const pool = [...list], out: T[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(random() * pool.length) % pool.length, 1)[0]);
  return out;
}

// ---------------------------------------------------------------- Pools

interface Look { th: string; en: string }
const OUTFITS: readonly Look[] = [
  { th: "เดรสยาวสีขาว", en: "a flowy white long-sleeve midi dress" },
  { th: "เสื้อไหมพรมครีม", en: "a soft cream knit sweater and a pleated skirt" },
  { th: "ชุดเดนิม", en: "a light denim jacket over a white top and jeans" },
  { th: "ชุดสายเกาหลี", en: "a pastel cardigan, a white blouse and a long skirt" },
  { th: "ชุดสตรีท", en: "a plain cropped oversized hoodie, cargo pants and sneakers" },
  { th: "ชุดวินเทจ", en: "a vintage floral blouse and high-waisted wide trousers" },
  { th: "ชุดสปอร์ต", en: "a modest matching sports set with a zip-up jacket" },
  { th: "ชุดทำงานเก๋ๆ", en: "a beige blazer, a silk shirt and tailored trousers" },
  { th: "ชุดไทยประยุกต์", en: "an elegant modern Thai silk dress in gold and cream with a neat sash" },
  { th: "ชุดผ้าซิ่น", en: "a Thai northern-style sinh skirt with a simple fitted blouse" },
  { th: "ชุดปาร์ตี้วิบวับ", en: "a sparkly long-sleeve knee-length party dress" },
  { th: "ชุดลายดอกไปทะเล", en: "a long-sleeve floral sundress and a straw hat" },
  { th: "ชุดสีพาสเทล Y2K", en: "a pastel Y2K-style knit top, a long skirt and hair clips" },
  { th: "ชุดมินิมอลขาวดำ", en: "a minimal black-and-white shirt dress" },
  { th: "ชุดหน้าหนาว", en: "a long camel coat, a knit scarf and boots" },
  { th: "ชุดนักศึกษาสไตล์ลำลอง", en: "a crisp white shirt, a long navy skirt and a tote bag" },
  { th: "ชุดสีแดงสดใส", en: "a bright red long-sleeve midi dress" },
  { th: "ชุดลูกไม้หวานๆ", en: "a sweet lace-collar blouse and a long tiered skirt" },
] as const;
const HOME_CLOTHES: readonly Look[] = [
  { th: "ชุดนอนลายการ์ตูน", en: "loose pastel cartoon-print pajamas" },
  { th: "เสื้อยืดตัวโคร่ง", en: "an oversized grey t-shirt and shorts-length lounge pants that reach the knee" },
  { th: "ฮู้ดดี้ตัวใหญ่", en: "a huge cosy hoodie with the hood up" },
  { th: "ชุดอยู่บ้านผ้าฝ้าย", en: "a simple cotton lounge set" },
] as const;
interface Trip { th: string; arrive: string; spot: string; food: { th: string; en: string }; night: string; tag: string }
const TRIPS: readonly Trip[] = [
  { th: "เชียงใหม่", arrive: "a misty mountain viewpoint at sunrise above a sea of clouds", spot: "a quiet Nimman café with plants and wood", food: { th: "ข้าวซอย", en: "a bowl of khao soi" }, night: "a lantern-lit old-city street", tag: "#เชียงใหม่" },
  { th: "ภูเก็ต", arrive: "a white-sand beach with turquoise water", spot: "the colourful Sino-Portuguese shophouses of Phuket old town", food: { th: "โอต๋าว", en: "a plate of o-taw oyster omelette" }, night: "a beach bar with soft lights and waves", tag: "#ภูเก็ต" },
  { th: "กระบี่", arrive: "a longtail boat by tall limestone cliffs", spot: "a clear lagoon between limestone rocks", food: { th: "ซีฟู้ดย่าง", en: "grilled seafood at a beach stall" }, night: "a fire show on the sand seen from a distance", tag: "#กระบี่" },
  { th: "เขาใหญ่", arrive: "a green field with mountains and a breezy sky", spot: "a farm café with cows and flowers", food: { th: "สเต๊กฟาร์ม", en: "a farm-style steak on a wooden table" }, night: "a camp with fairy lights and a small campfire", tag: "#เขาใหญ่" },
  { th: "หัวหิน", arrive: "a calm beach with horses walking in the distance", spot: "a seaside night market entrance in the afternoon", food: { th: "หมึกย่าง", en: "grilled squid on sticks" }, night: "the colourful night market", tag: "#หัวหิน" },
  { th: "น่าน", arrive: "a winding mountain road with endless green hills", spot: "a temple mural courtyard, standing respectfully", food: { th: "ข้าวแคบ", en: "local crispy rice crackers at a market" }, night: "a quiet riverside with soft warm lights", tag: "#น่าน" },
  { th: "เยาวราช", arrive: "busy Yaowarat road with red neon signs", spot: "an old Chinese shophouse café", food: { th: "ขนมปังปิ้งเยาวราช", en: "toasted buns with custard" }, night: "Yaowarat road glowing with neon at night", tag: "#เยาวราช" },
  { th: "ปาย", arrive: "a canyon edge at golden hour", spot: "a bamboo bridge over rice fields", food: { th: "โรตีกล้วย", en: "a banana roti" }, night: "Pai walking street with string lights", tag: "#ปาย" },
  { th: "เกาะช้าง", arrive: "a jungle beach with palm trees", spot: "a waterfall pool in the forest", food: { th: "น้ำมะพร้าวปั่น", en: "a coconut smoothie in a coconut shell" }, night: "a candlelit beach dinner table", tag: "#เกาะช้าง" },
  { th: "อยุธยา", arrive: "ancient brick temple ruins under a blue sky, standing respectfully", spot: "a river boat on the Chao Phraya", food: { th: "ก๋วยเตี๋ยวเรือ", en: "small bowls of boat noodles" }, night: "the temple ruins lit up at night, seen from afar", tag: "#อยุธยา" },
] as const;
const BREAKFASTS = [{ th: "โจ๊ก", en: "a bowl of Thai rice porridge" }, { th: "ปาท่องโก๋", en: "Thai doughnut sticks with pandan custard" },
  { th: "กาแฟเย็น", en: "a Thai iced coffee" }, { th: "ข้าวเหนียวหมูปิ้ง", en: "grilled pork skewers with sticky rice" }, { th: "สมูทตี้โบวล์", en: "a colourful smoothie bowl" },
  { th: "ขนมปังปิ้ง", en: "buttered toast with a glass of milk" }, { th: "ไข่กระทะ", en: "a sizzling Thai pan egg breakfast" }, { th: "ชาไทย", en: "an orange Thai iced tea" }] as const;
const WAKES = [
  { th: "ยืดเส้นริมหน้าต่าง", en: "she wakes up in bed as morning sun comes through the curtains and stretches sleepily" },
  { th: "ปิดนาฬิกาปลุก", en: "she reaches out from under the duvet to switch off a ringing alarm clock, then sits up yawning" },
  { th: "แมวปลุก", en: "a fluffy cat pats her cheek to wake her and she opens her eyes smiling" },
  { th: "เช้าวันฝนตก", en: "she wakes up to gentle rain on the window and pulls the blanket around her shoulders" },
  { th: "ตื่นสาย", en: "she jolts awake, looks at her phone in surprise and laughs at herself" },
] as const;
const LUNCH_SPOTS = [{ th: "ร้านริมทาง", en: "a busy Thai street-food stall" }, { th: "ฟู้ดคอร์ท", en: "a bright food court" },
  { th: "ร้านในซอย", en: "a small family-run shop in a quiet soi" }, { th: "กินที่บ้าน", en: "her small home dining table" }] as const;
const LUNCHES = [{ th: "ส้มตำ", en: "a plate of spicy papaya salad" }, { th: "ข้าวซอย", en: "a bowl of khao soi" }, { th: "ต้มยำกุ้ง", en: "a bowl of tom yum goong" },
  { th: "ข้าวขาหมู", en: "braised pork leg on rice" }, { th: "ข้าวมันไก่", en: "Hainanese chicken rice" }, { th: "ผัดไทย", en: "a plate of pad thai" },
  { th: "ก๋วยเตี๋ยวเรือ", en: "boat noodles" }, { th: "กะเพราไข่ดาว", en: "basil pork with a fried egg" }, { th: "หมูกระทะ", en: "a sizzling Thai barbecue grill" },
  { th: "ชาบู", en: "a bubbling shabu hot pot" }, { th: "ข้าวผัดปู", en: "crab fried rice" }] as const;
const MORNING = [
  { th: "วิ่งเช้าในสวน", en: "jogging slowly through a green park with a lake" },
  { th: "ตลาดเช้า", en: "walking through a lively Thai morning market" },
  { th: "คาเฟ่ลับ", en: "sitting in a sunny hidden café" },
  { th: "รดน้ำต้นไม้", en: "watering plants on a small balcony garden" },
  { th: "โยคะ", en: "doing gentle yoga on a mat by the window" },
  { th: "ตักบาตร", en: "respectfully offering food to a monk on a quiet street at dawn, kneeling politely" },
  { th: "จัดดอกไม้", en: "arranging fresh flowers in a vase by a sunny window" },
  { th: "เดินเล่นกับหมา", en: "walking a small fluffy dog along a leafy street" },
] as const;
const AFTERNOON = [
  { th: "ช้อปปิ้ง", en: "browsing clothes racks in a bright boutique" },
  { th: "ทำงานที่คาเฟ่", en: "typing on a laptop in a quiet café" },
  { th: "ทำขนม", en: "baking cookies in a home kitchen" },
  { th: "เล่นกับแมว", en: "playing with a fluffy orange cat on a sofa" },
  { th: "ร้านหนังสือ", en: "reading in a cosy bookstore corner" },
  { th: "ทำเล็บ", en: "getting a pastel manicure at a cute nail salon" },
  { th: "ปลูกต้นไม้", en: "repotting small plants on a balcony" },
  { th: "ทำกับข้าว", en: "cooking a simple stir-fry in a bright home kitchen" },
] as const;
const EVENING = [
  { th: "ดูพระอาทิตย์ตกริมแม่น้ำ", en: "on a riverside pier watching the sunset" },
  { th: "ดาดฟ้ายามเย็น", en: "on a city rooftop at golden hour" },
  { th: "ตลาดนัดกลางคืน", en: "at a Thai night market with neon lights" },
  { th: "ปั่นจักรยานยามเย็น", en: "riding a bicycle along a quiet road at dusk" },
  { th: "สวนสาธารณะยามเย็น", en: "in a park as the street lamps turn on" },
  { th: "ชิงช้าริมทะเลสาบ", en: "on a swing by a lake at sunset" },
] as const;
const BEDTIME = [
  { th: "สกินแคร์ก่อนนอน", en: "doing her skincare at a vanity in soft lamplight", turn: "she pats on cream and smiles at the mirror", end: "she switches off the lamp and waves goodnight" },
  { th: "อ่านหนังสือบนเตียง", en: "reading a book in bed under a warm lamp", turn: "she yawns and closes the book", end: "she snuggles into the duvet and waves goodnight" },
  { th: "กอดแมวก่อนนอน", en: "lying in bed hugging a fluffy cat", turn: "the cat purrs and taps her nose", end: "she whispers goodnight and closes her eyes with a smile" },
  { th: "ฟังเสียงฝน", en: "sitting by a rainy window with a warm mug", turn: "she draws a small heart on the fogged glass", end: "she slips into bed and waves goodnight" },
] as const;
const MAKEUP = [
  { th: "ลุคหวานเกาหลี", en: "soft Korean-style makeup with gradient lips and rosy cheeks" },
  { th: "ลุคสาวไทยคมๆ", en: "defined Thai glam makeup with bronzed cheeks and sharp brows" },
  { th: "ลุคหน้าเงา", en: "dewy glass-skin makeup with glossy lips" },
  { th: "ลุคตาแมว", en: "elegant cat-eye liner and a nude lip" },
  { th: "ลุคพีชๆ", en: "peachy blush and a coral lip" },
] as const;
const HAIR = [
  { th: "ลอนใหญ่", en: "big bouncy glossy waves" }, { th: "ผมตรงเงา", en: "sleek, shiny straight hair" },
  { th: "หางม้าสูง", en: "a neat high ponytail with a ribbon" }, { th: "มวยเกาหลี", en: "a soft low bun with face-framing strands" },
  { th: "ถักเปีย", en: "two neat braids" },
] as const;
const DANCE_SPOTS = [
  { th: "ห้องนอน", en: "her bedroom with fairy lights" }, { th: "ดาดฟ้า", en: "a rooftop at sunset with the city behind" },
  { th: "ริมทะเล", en: "a sunny beach" }, { th: "คาเฟ่", en: "a pastel café corner" }, { th: "สวนสาธารณะ", en: "a green park lawn" },
  { th: "ห้องซ้อมกระจก", en: "a dance studio with a mirror wall" }, { th: "ระเบียงวันฝนตก", en: "a balcony with gentle rain behind" },
  { th: "สะพานไม้ริมน้ำ", en: "a wooden pier over calm water" }, { th: "ถนนไฟนีออน", en: "a street with colourful neon signs at night" },
] as const;
const DANCE_MOVES = [
  { th: "เต้นมือ", en: "a fast, catchy hand-dance choreography with finger hearts" },
  { th: "เต้นสเต็ปน่ารัก", en: "cute bouncy side steps with shoulder bounces" },
  { th: "เต้นเคป๊อป", en: "a simple K-pop style point choreography" },
  { th: "ชัฟเฟิล", en: "light shuffle steps" },
  { th: "เต้นช้าๆ ชิลๆ", en: "a slow, smooth sway with arm waves" },
] as const;

// Fitted, fashionable and confident (16 Nov owner: "sexy, medium up to the limit"), still inside what TikTok shows on
// For You and what Flow agrees to make: no lingerie, swimwear, see-through or deep cleavage.
const GLAM_OUTFITS: readonly Look[] = [
  { th: "เดรสรัดรูปสีดำ", en: "a sleek fitted black bodycon midi dress with a square neckline" },
  { th: "เดรสเปิดไหล่สีแดง", en: "a fitted red off-the-shoulder midi dress" },
  { th: "เดรสซาตินแชมเปญ", en: "a champagne satin slip midi dress with a light cropped jacket" },
  { th: "ครอปท็อปกับยีนส์เอวสูง", en: "a fitted white crop top and high-waisted flared jeans" },
  { th: "ชุดหนังเท่ๆ", en: "a cropped black leather jacket, a fitted top and a black mini skirt with boots" },
  { th: "ชุดออกกำลังกาย", en: "a matching fitted sports top and high-waisted leggings" },
  { th: "มินิเดรสวิบวับ", en: "a sparkly silver long-sleeve mini dress" },
  { th: "เสื้อเชิ้ตผูกเอว", en: "an oversized white shirt knotted at the waist with denim shorts" },
  { th: "เดรสผ่าข้าง", en: "an elegant emerald satin maxi dress with a side slit" },
  { th: "ชุดไทยแซ่บ", en: "a fitted modern Thai silk top with a gold sash and a long silk skirt" },
] as const;
const GLAM_SPOTS = [
  { th: "ไฟนีออนกลางคืน", en: "a city street with neon lights at night" }, { th: "รูฟท็อปบาร์", en: "a rooftop lounge with city lights" },
  { th: "ทางเดินแฟชั่น", en: "a hotel corridor with warm lights, like a runway" }, { th: "ลิฟต์กระจก", en: "a mirrored elevator" },
  { th: "ห้องแต่งตัว", en: "a glamorous dressing room with bulb mirrors" }, { th: "ริมสระยามค่ำ", en: "beside a glowing pool at a night party" },
  { th: "ยิม", en: "a modern gym with mirrors" }, { th: "ถนนฝนตก", en: "a rainy street at night with reflections" },
] as const;
const GLAM_MOVES = [
  { th: "เดินเข้าหากล้อง", en: "walks slowly toward the camera like a runway model", end: "stops close to the lens, tilts her head and gives a slow confident smile" },
  { th: "สะบัดผม", en: "flips her long hair over one shoulder", end: "looks back over her shoulder at the camera and winks" },
  { th: "ส่งสายตา", en: "leans on the wall and slowly lifts her eyes to the lens", end: "smirks, bites her lip lightly and looks away shyly" },
  { th: "หมุนตัวโชว์ชุด", en: "does a slow spin to show the outfit", end: "ends with one hand on her hip and a playful eyebrow raise" },
  { th: "เต้นเอวช้าๆ", en: "sways her hips slowly to the beat", end: "points at the camera and blows a kiss" },
] as const;
const GLAM_LINES = ["มองนานๆ ระวังหลงนะ", "ใจเต้นแรงไหมคะ", "กดติดตามก่อน แล้วค่อยมองต่อ", "ชุดนี้แรงไปไหม", "คืนนี้ว่างไหมคะ"] as const;
const POV = [
  { th: "รอแฟนกลับบ้าน", start: "she leans in the doorway in a cosy oversized shirt, arms folded, pretending to be cross", turn: "she squints at the lens suspiciously", end: "she breaks into a smile and opens her arms for a hug", line: "ไปไหนมาคะ ไม่คิดถึงเหรอ" },
  { th: "หึงแฟน", start: "she sits on a sofa hugging a cushion, pouting at the lens", turn: "she leans closer to the lens and narrows her eyes", end: "she pokes the lens with one finger and laughs", line: "เมื่อกี้มองใครคะ" },
  { th: "เดตแรก", start: "she sits across a candlelit café table, resting her chin on her hand and gazing at the lens", turn: "she tucks her hair behind her ear shyly", end: "she slides her drink toward the lens and smiles", line: "ลองชิมของเค้าไหม" },
  { th: "ปลุกแฟน", start: "she leans over the lens in soft morning light, hair falling around her face", turn: "she taps the lens gently with a finger", end: "she laughs and pulls back the curtains", line: "ตื่นได้แล้วค่ะ คนขี้เซา" },
  { th: "แฟนง้อ", start: "she turns her back to the lens, arms folded", turn: "she peeks over her shoulder, trying not to smile", end: "she turns around and holds out her pinky finger to the lens", line: "ง้อดีๆ ก่อนสิ" },
  { th: "ขอให้ไปส่ง", start: "she stands by a car at night in a pretty outfit, swinging her bag", turn: "she walks closer to the lens", end: "she tugs the lens gently by an imaginary sleeve and smiles", line: "ไปส่งหน่อยได้ไหมคะ" },
  { th: "ทำกับข้าวให้แฟน", start: "she cooks in a bright kitchen wearing an apron, then turns to the lens", turn: "she blows on a spoonful of food", end: "she holds the spoon out toward the lens", line: "อ้ามม ชิมหน่อยค่ะ" },
  { th: "ดูหนังด้วยกัน", start: "she sits on a sofa under a blanket in the light of a TV, eating popcorn", turn: "a jump scare makes her gasp and grab toward the lens", end: "she hides her face then peeks out laughing", line: "อย่าปล่อยมือนะ" },
] as const;

// ---------------------------------------------------------------- Arcs

function dayArc(random: Random): Arc {
  const [breakfast, lunch, wake, lunchSpot] = [pick(BREAKFASTS, random), pick(LUNCHES, random), pick(WAKES, random), pick(LUNCH_SPOTS, random)];
  const [morning, afternoon, evening, bedtime, outfit, night] = [pick(MORNING, random), pick(AFTERNOON, random), pick(EVENING, random), pick(BEDTIME, random), pick(OUTFITS, random), pick(HOME_CLOTHES, random)];
  const tags = ["#ชีวิตประจำวัน", "#dayinmylife", "#vlog"];
  // Five episodes in time order: the morning or the afternoon one is left out at random.
  const skip = random() < 0.5 ? 1 : 3;
  return { series: "วันหนึ่งของน้อง", name: `วันหนึ่งของน้อง (${morning.th} · ${lunch.th})`, episodes: [
    { label: `ตื่นนอน (${wake.th}) + ${breakfast.th}`, start: `${wake.en}, wearing pyjamas`, turn: `she sits at a small table with ${breakfast.en}`,
      end: "she takes a happy bite and waves good morning to the camera", line: "อรุณสวัสดิ์ค่ะ", music: false, hashtags: tags },
    { label: `ช่วงเช้า: ${morning.th} · ${outfit.th}`, start: `she is ${morning.en}, wearing ${outfit.en}`, turn: "she looks back at the camera and smiles", end: "she gives a little peace sign", line: "เช้านี้อากาศดีมาก", music: true, hashtags: tags },
    { label: `มื้อกลางวัน: ${lunch.th} (${lunchSpot.th})`, start: `she sits at ${lunchSpot.en} in ${outfit.en} with ${lunch.en} in front of her`, turn: "she takes a bite and her eyes light up",
      end: "she nods enthusiastically and points at the food", line: `${lunch.th}ร้านนี้อร่อยมาก`, music: false, hashtags: [...tags, "#ของกิน"] },
    { label: `ช่วงบ่าย: ${afternoon.th} · ${outfit.th}`, start: `she is ${afternoon.en}, in ${outfit.en}`, turn: "she notices the camera and laughs", end: "she waves the camera closer", line: "บ่ายนี้ชิลๆ ค่ะ", music: true, hashtags: tags },
    { label: `ช่วงเย็น: ${evening.th} · ${outfit.th}`, start: `she is ${evening.en}, in ${outfit.en}`, turn: "the warm light hits her face as she turns to the camera", end: "she smiles softly as the sky turns pink",
      line: "เย็นนี้สวยมากเลย", music: true, hashtags: tags },
    { label: `ก่อนนอน: ${bedtime.th} (${night.th})`, start: `she is ${bedtime.en}, in ${night.en}`, turn: bedtime.turn, end: bedtime.end, line: "ฝันดีนะคะทุกคน", music: false, hashtags: [...tags, "#ก่อนนอน"] },
  ].filter((_, i) => i !== skip) };
}

function tripArc(random: Random): Arc {
  const trip = pick(TRIPS, random), packing = pick(HOME_CLOTHES, random), [outfit, outfit2, outfit3] = pickSome(OUTFITS, 3, random);
  const tags = ["#เที่ยวไทย", trip.tag, "#travel"];
  return { series: "เที่ยวกับน้อง", name: `ทริป${trip.th} (${outfit.th})`, episodes: [
    { label: `แพ็กกระเป๋าไป${trip.th} · ${outfit.th}`, start: `she sits on her bedroom floor in ${packing.en}, folding clothes into an open suitcase`, turn: "she zips the suitcase shut and snaps her fingers at the lens; the shot cuts on the beat",
      end: `she is now in ${outfit.en}, pulling the suitcase out of the door with a big smile`, line: `ไป${trip.th}กันค่ะ`, music: true, hashtags: tags },
    { label: `ถึง${trip.th}แล้ว · ${outfit.th}`, start: `she arrives at ${trip.arrive}, in ${outfit.en}`, turn: "she spreads her arms and takes a deep breath", end: "she turns to the camera with an excited smile",
      line: `ถึง${trip.th}แล้ว สวยมาก`, music: true, hashtags: tags },
    { label: `เที่ยว${trip.th} · ${outfit2.th}`, start: `she walks around ${trip.spot} in ${outfit2.en}`, turn: "she stops, looks around in wonder and points something out", end: "she poses happily for the camera", line: "ที่นี่ต้องมาสักครั้ง", music: true, hashtags: tags },
    { label: `กิน${trip.food.th}ที่${trip.th} · ${outfit2.th}`, start: `she sits at a local table in ${outfit2.en} with ${trip.food.en}`, turn: "she tries it and her eyes widen", end: "she gives a big thumbs-up", line: `${trip.food.th}อร่อยมาก`, music: false, hashtags: [...tags, "#ของกิน"] },
    { label: `คืนสุดท้ายที่${trip.th} · ${outfit3.th}`, start: `she strolls through ${trip.night} in ${outfit3.en}`, turn: "she slows down and looks back at the camera", end: "she waves goodbye softly", line: "ไว้มาอีกนะคะ", music: true, hashtags: tags },
  ] };
}

function flipArc(random: Random): Arc {
  const pairs = pickSome(OUTFITS, 5, random), homes = pickSome(HOME_CLOTHES, 4, random), spots = pickSome(DANCE_SPOTS, 5, random);
  const tags = ["#แปลงร่าง", "#outfit", "#ootd"];
  return { series: "แปลงลุควับ", name: `แปลงลุค 5 สไตล์ (${pairs[0].th})`, episodes: pairs.map((look, i) => ({
    label: `${homes[i % homes.length].th} → ${look.th} ที่${spots[i].th}`,
    start: `she stands at a mirror in ${homes[i % homes.length].en}, making a cute shy face at the camera`,
    turn: ["she spins quickly and the shot cuts on the beat mid-spin", "she snaps her fingers at the lens and the shot cuts on the beat",
      "she covers the lens with her palm and the shot cuts on the beat", "she flips her hair toward the lens and the shot cuts on the beat"][i % 4],
    end: `she now wears ${look.en} in ${spots[i].en}, posing and smiling at the camera`,
    line: ["ลุคนี้ให้กี่คะแนน", "ชอบลุคนี้ไหม", "ชุดนี้ไปไหนดี", "ลุคไหนสวยกว่า", "แปลงร่างเสร็จแล้ว"][i % 5], music: true, hashtags: tags,
  })) };
}

function beforeAfterArc(random: Random): Arc {
  const looks = pickSome(MAKEUP, 3, random), hairs = pickSome(HAIR, 2, random), outfits = pickSome(OUTFITS, 5, random);
  const tags = ["#ก่อนหลัง", "#grwm", "#แต่งหน้า"];
  return { series: "ก่อน/หลัง", name: `ก่อน/หลัง (${looks[0].th})`, episodes: [
    ...looks.map((look, i) => ({ label: `หน้าสด → ${look.th} · ${outfits[i].th}`, start: "she sits at a vanity with a fluffy headband and bare natural skin, shrugging playfully at the camera",
      turn: "she swipes a big makeup brush across the lens and the shot cuts on the beat", end: `she now has ${look.en} and wears ${outfits[i].en}, smiling and blowing a small kiss`,
      line: "หน้าสดกับหน้าแต่ง ชอบแบบไหน", music: true, hashtags: tags })),
    ...hairs.map((hair, i) => ({ label: `ผมยุ่ง → ${hair.th} · ${outfits[3 + i].th}`, start: "she looks at the camera with frizzy messy morning hair, pulling a funny face",
      turn: "she covers the lens with a comb and the shot cuts on the beat", end: `she now has ${hair.en} and wears ${outfits[3 + i].en}, turning her head slowly`,
      line: "ผมพังแค่ไหนก็เอาอยู่", music: true, hashtags: [...tags, "#ทำผม"] })),
  ] };
}

function danceArc(random: Random): Arc {
  const move = pick(DANCE_MOVES, random), spots = pickSome(DANCE_SPOTS, 4, random), outfits = pickSome(OUTFITS, 4, random);
  const tags = ["#เต้น", "#เต้นตามเทรนด์", "#dancechallenge"];
  return { series: "ชาเลนจ์เต้น", name: `ชาเลนจ์${move.th} 4 ที่`, episodes: spots.map((spot, i) => ({
    label: `${move.th}ที่${spot.th} · ${outfits[i].th}`, start: `she is already dancing ${move.en} at ${spot.en}, wearing ${outfits[i].en}`,
    turn: "the moves sync to the beat with small head tilts, a hair flip and a wink at the lens", vibe: "FLIRTY" as const, end: "she finishes the move with a cute pose and laughs at the camera",
    line: ["เต้นตามกันได้นะ", "วันนี้มาเต้นที่นี่", "ใครเต้นได้บ้าง", "อีกรอบไหม"][i % 4], music: true, hashtags: tags,
  })) };
}

function glamArc(random: Random): Arc {
  const outfits = pickSome(GLAM_OUTFITS, 4, random), spots = pickSome(GLAM_SPOTS, 4, random), moves = pickSome(GLAM_MOVES, 4, random), lines = pickSome(GLAM_LINES, 4, random);
  const tags = ["#สายแซ่บ", "#ootd", "#สาวสวย"];
  return { series: "สายแซ่บ", name: `สายแซ่บ ${outfits.length} ลุค (${outfits[0].th})`, episodes: outfits.map((look, i) => ({
    label: `${look.th} · ${spots[i].th} · ${moves[i].th}`,
    start: `she ${moves[i].en} at ${spots[i].en}, wearing ${look.en}`,
    turn: "she locks eyes with the camera as the beat drops", end: `she ${moves[i].end}`,
    line: lines[i], music: true, hashtags: tags, vibe: "GLAM" as const,
  })) };
}

function povArc(random: Random): Arc {
  const scenes = pickSome(POV, 4, random);
  const tags = ["#POV", "#แฟน", "#คนรัก"];
  return { series: "POV แฟน", name: `POV เป็นแฟนน้อง (${scenes[0].th})`, episodes: scenes.map(scene => ({
    label: `POV: ${scene.th}`, start: `POV, the camera is her boyfriend's eyes: ${scene.start}`, turn: scene.turn, end: scene.end,
    line: scene.line, music: false, hashtags: tags, vibe: "FLIRTY" as const,
  })) };
}

function chooseArc(random: Random): Arc {
  const pairs = pickSome([...GLAM_OUTFITS, ...OUTFITS], 8, random), spots = pickSome(GLAM_SPOTS, 4, random);
  const tags = ["#เลือกชุด", "#ootd", "#1หรือ2"];
  return { series: "เลือก 1 หรือ 2", name: `ให้เลือกชุด 1 หรือ 2 (${pairs[0].th})`, episodes: [0, 1, 2, 3].map(i => ({
    label: `1 ${pairs[i * 2].th} หรือ 2 ${pairs[i * 2 + 1].th}`,
    start: `at ${spots[i].en}, she holds up one finger to the camera, wearing ${pairs[i * 2].en}, and does a little pose`,
    turn: "she spins and the shot cuts on the beat mid-spin",
    end: `she now wears ${pairs[i * 2 + 1].en}, holds up two fingers and raises her eyebrows at the camera`,
    line: "1 หรือ 2 คะ คอมเมนต์มา", music: true, hashtags: tags, vibe: "FLIRTY" as const,
  })) };
}

const BUILDERS: Record<GirlSeries, (random: Random) => Arc> = {
  "วันหนึ่งของน้อง": dayArc, "เที่ยวกับน้อง": tripArc, "แปลงลุควับ": flipArc, "ก่อน/หลัง": beforeAfterArc, "ชาเลนจ์เต้น": danceArc,
  "สายแซ่บ": glamArc, "POV แฟน": povArc, "เลือก 1 หรือ 2": chooseArc,
};
/** Until results say otherwise, the teasing series come up more often than the cute everyday ones (16 Nov owner). */
const DEFAULT_WEIGHTS: Partial<Record<GirlSeries, number>> = { "สายแซ่บ": 2, "POV แฟน": 1.5, "เลือก 1 หรือ 2": 1.5, "ชาเลนจ์เต้น": 1.2 };

export const episodeTitle = (series: GirlSeries, episode: Pick<Episode, "label">) => `สาว AI: ${series} | ${episode.label}`;
export function seriesFromTitle(title: string): GirlSeries | null {
  const match = /^สาว AI: (.+?) \| /.exec(title);
  return match && (GIRL_SERIES as readonly string[]).includes(match[1]) ? match[1] as GirlSeries : null;
}

/**
 * A new arc of `series` (or one chosen by weight, never the series of the arc just finished) whose episodes have not
 * been made before. Tries a few draws; with tens of thousands of combinations one is nearly always fresh.
 */
export function newArc(random: Random, options: { made?: ReadonlySet<string>; lastSeries?: GirlSeries | null; weights?: Record<string, number> } = {}): Arc {
  const made = options.made ?? new Set<string>();
  const pool = GIRL_SERIES.filter(s => s !== options.lastSeries);
  let best: Arc | null = null, bestFresh = -1;
  for (let attempt = 0; attempt < 12; attempt++) {
    const total = pool.reduce((sum, s) => sum + Math.max(0.1, options.weights?.[s] ?? DEFAULT_WEIGHTS[s] ?? 1), 0);
    let roll = random() * total, series = pool[pool.length - 1];
    for (const s of pool) { roll -= Math.max(0.1, options.weights?.[s] ?? DEFAULT_WEIGHTS[s] ?? 1); if (roll <= 0) { series = s; break; } }
    const arc = BUILDERS[series](random);
    const fresh = arc.episodes.filter(e => !made.has(episodeTitle(arc.series, e))).length;
    if (fresh === arc.episodes.length) return arc;
    if (fresh > bestFresh) { best = arc; bestFresh = fresh; }
  }
  // Everything drawn was made before (only after years of posting): repeat the freshest draw rather than stall.
  return bestFresh > 0 ? { ...best!, episodes: best!.episodes.filter(e => !made.has(episodeTitle(best!.series, e))) } : best!;
}

/** Example arcs for the page, so the owner sees what is coming. */
export const sampleArcs = (random: Random) => GIRL_SERIES.map(s => BUILDERS[s](random));
