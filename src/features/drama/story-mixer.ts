import type { CastMember, DramaGenre, Line, Place, Role } from "./contracts";
import type { Beat, FixedPhase, GenreKit, Move } from "./genres";

/**
 * 19 Nov (Lucky): new stories without end, not the same twelve again. A mixed story is put together from parts of its
 * genre (a set of places, a key object, a plot with its hidden truth and ending, and a newly cast lead, ally and rival)
 * and played with the genre's own story moves, so every new season has new faces, new places and a new mystery while
 * the episodes still follow one clear line: opening, first clue, midpoint reveal, crisis, climax, ending.
 *
 * Free and deterministic: the same key always writes the same story. A series keeps the kit it was created with in
 * its bible, so later changes to these parts never change a story that is already running.
 */
export const MIX_PREFIX = "mix-";
export const isMixKey = (key: string) => key.startsWith(MIX_PREFIX);
export const mixKey = (genre: DramaGenre, n: number) => `${MIX_PREFIX}${genre.toLowerCase()}-${n}`;

const m = (id: string, t: string, th: string, en: string, level: 1 | 2 | 3, extra: Partial<Move> = {}): Move => ({ id, t, th, en, level, ...extra });
const say = (who: Role, line: string): Line => ({ who, line });

type Gender = "F" | "M";
type Band = "YOUNG" | "MID" | "OLD";
interface RoleSpec { gender: Gender | "ANY"; band: Band; outfits: string[] }
interface Pack { places: Place[] }
interface Plot {
  /** Title with {OBJT} (the object's short Thai name) or {PLACE} (place A's Thai name). */
  title: string; logline: string; truth: string; ending: string; reveal1: Line; reveal2: Line; finalLine: Line;
  roles: Record<Role, { trait: string; want: string; secret: string }>;
}
interface MixGenre {
  style: string; sound: string; hashtags: string[]; roles: Record<Role, RoleSpec>;
  packs: Pack[]; objects: Array<{ name: string; short: string; look: string }>; plots: Plot[];
  hooks: Line[]; moves: Move[]; cliffs: Move[]; beats: Record<FixedPhase, Beat>;
}

const place = (key: Place["key"], name: string, look: string): Place => ({ key, name, look });

// ---------------------------------------------------------------- People

const NAMES: Record<Gender, Record<Band, Array<[string, string]>>> = {
  F: {
    YOUNG: [["ใบเฟิร์น", "Fern"], ["มุก", "Muk"], ["น้ำหวาน", "Namwan"], ["ปราง", "Prang"], ["เมย์", "May"], ["ขวัญ", "Kwan"], ["ดาว", "Dao"],
      ["จูน", "June"], ["ฝน", "Fon"], ["อิง", "Ing"], ["ใบข้าว", "Baikhao"], ["มายด์", "Mind"], ["พิม", "Pim"], ["นิ้ง", "Ning"], ["แก้ม", "Kaem"], ["ออม", "Aom"]],
    MID: [["คุณหญิงรำไพ", "Madam Rampai"], ["ผู้จัดการนวล", "Manager Nuan"], ["เจ๊หงส์", "Jae Hong"], ["คุณดารินทร์", "Darin"], ["คุณวิภา", "Wipa"]],
    OLD: [["ยายบัว", "Grandma Bua"], ["ป้าศรี", "Aunt Sri"], ["ป้าละเอียด", "Aunt Laiad"], ["คุณนายพิไล", "Madam Pilai"], ["ยายเย็น", "Grandma Yen"]],
  },
  M: {
    YOUNG: [["ภูผา", "Phupha"], ["เต้", "Tae"], ["กันต์", "Kan"], ["ธาม", "Tham"], ["ไผ่", "Phai"], ["ต้นน้ำ", "Tonnam"], ["ภีม", "Peem"],
      ["ก้อง", "Kong"], ["ปั้น", "Pan"], ["โอ๊ต", "Oat"], ["นัท", "Nut"], ["เอิร์ธ", "Earth"], ["ไนท์", "Night"], ["ตะวัน", "Tawan"]],
    MID: [["เสี่ยกร", "Boss Korn"], ["ผู้กองเดชา", "Captain Decha"], ["คุณภาคิน", "Pakin"], ["อาจารย์ธีร์", "Professor Thee"], ["เฮียเม้ง", "Hia Meng"]],
    OLD: [["ลุงเสือ", "Uncle Suea"], ["ตาเปลี่ยน", "Grandpa Plian"], ["ลุงชิต", "Uncle Chit"], ["หลวงตาคำ", "Elder Kham"], ["ลุงบุญมา", "Uncle Boonma"]],
  },
};
const HAIR: Record<Gender, Record<Band, string[]>> = {
  F: {
    YOUNG: ["long straight black hair in a high ponytail", "shoulder-length wavy dark-brown hair", "a sleek black bob with blunt bangs",
      "long black hair worn loose with a side part", "hair tied in a neat low bun with a few loose strands", "long dark hair in a single side braid"],
    MID: ["a short layered black haircut", "dark hair pinned up in an elegant chignon", "chin-length black hair with a few grey strands"],
    OLD: ["thin silver hair in a tight bun", "short grey permed hair", "white hair pulled back under a dark headscarf"],
  },
  M: {
    YOUNG: ["short black undercut hair swept back", "messy medium-length black hair", "a neat side-parted short haircut", "a short buzz cut",
      "wavy black hair pushed off the forehead", "short spiky black hair"],
    MID: ["slicked-back black hair greying at the temples", "a shaved head", "short neat black hair with a heavy moustache"],
    OLD: ["short white hair", "a bald head with a ring of white hair", "thin combed-back grey hair"],
  },
};
const FACE: Record<Gender, Record<Band, string[]>> = {
  F: {
    YOUNG: ["a heart-shaped face with sharp dark eyes", "a round friendly face with dimples", "an oval face with a small beauty mark under the left eye",
      "high cheekbones and thick straight eyebrows", "big bright eyes and a small pointed chin"],
    MID: ["a sharp elegant face with red lipstick", "a calm stern face with thin eyebrows", "a warm round face with laugh lines"],
    OLD: ["a deeply lined kind face", "a thin stern face with sunken eyes", "a round wrinkled face and thick round glasses"],
  },
  M: {
    YOUNG: ["a sharp jawline and a clean-shaven face", "a friendly square face with light stubble", "thick eyebrows and a calm narrow face",
      "a boyish face with a small scar on the chin", "deep-set eyes and a short neat beard"],
    MID: ["a heavy square jaw and cold eyes", "a lean face with a thin scar across the cheek", "a broad smiling face that never reaches the eyes"],
    OLD: ["a weathered face with deep wrinkles", "a gaunt face with thick black-framed glasses", "a gentle face with a wispy white beard"],
  },
};
const BUILD: Record<Gender, string[]> = { F: ["slim", "petite", "tall and slender"], M: ["tall and lean", "broad-shouldered", "medium build"] };
const VOICE: Record<Gender, Record<Band, string[]>> = {
  F: { YOUNG: ["bright, clear young female voice", "soft, warm female voice", "confident, crisp female voice", "playful, quick female voice"],
    MID: ["cool, measured authoritative female voice", "sweet but sharp female voice"], OLD: ["thin, aged, slightly shaky elderly female voice"] },
  M: { YOUNG: ["deep, calm male voice", "warm, slightly husky male voice", "easygoing, friendly male voice", "low, steady male voice"],
    MID: ["deep, slow, cold male voice", "smooth, confident male voice"], OLD: ["low, gravelly elderly male voice"] },
};
const AGE: Record<Band, [number, number]> = { YOUNG: [23, 31], MID: [40, 52], OLD: [63, 74] };

// ---------------------------------------------------------------- Genres

const HORROR: MixGenre = {
  style: "Photorealistic Thai horror drama, cinematic 35mm look, low-key lighting, cold teal shadows with warm tungsten practicals, subtle film grain, slow deliberate camera",
  sound: "quiet room tone, creaking wood, distant insects, low drone; no music score",
  hashtags: ["#ละครสั้น", "#ละครผี", "#สยองขวัญ", "#เรื่องหลอน"],
  roles: {
    LEAD: { gender: "F", band: "YOUNG", outfits: ["a cream knit cardigan over a white blouse and dark jeans", "an oversized grey hoodie, black leggings and canvas sneakers", "a pale yellow cotton dress with a thin denim jacket"] },
    ALLY: { gender: "M", band: "YOUNG", outfits: ["a dark green field jacket over a white T-shirt and cargo trousers", "a checked flannel shirt over a black T-shirt and jeans", "a navy polo shirt, khaki shorts and a small camera bag"] },
    RIVAL: { gender: "ANY", band: "OLD", outfits: ["a faded indigo Thai cotton shirt and a dark sarong", "a plain white blouse buttoned to the neck and a long black skirt", "a brown traditional Thai shirt and loose black trousers"] },
  },
  packs: [
    { places: [
      place("A", "ห้องโถงเรือนไทยเก่า", "the dim main hall of an old Thai teak stilt house, creaking floorboards, a carved wooden cabinet, faded family portraits on the wall, one warm oil lamp"),
      place("B", "ท่าน้ำหลังเรือน", "a weathered wooden landing behind the old house over a dark river at dusk, a hanging lantern, mist on the water and a small spirit house"),
      place("C", "ห้องเก็บของใต้ถุน", "the low cramped space under the raised teak house, old clay jars, broken furniture, flood marks on the stilts, one bare bulb swinging"),
      place("D", "ระเบียงเรือน", "the long wooden veranda of the old Thai house at night, louvred shutters, worn boards, potted jasmine and moths around a lamp"),
      place("E", "ห้องนอนชั้นบน", "an old upstairs bedroom with a carved teak bed under a mosquito net, a vanity mirror, an old wall clock and moonlight through the shutters"),
    ] },
    { places: [
      place("A", "หอพักหญิงเก่า", "the shabby common room of an old girls' dormitory, metal bunk beds, a flickering fluorescent tube, peeling green paint and a dusty TV"),
      place("B", "สนามหลังหอ", "the overgrown yard behind the old dormitory at night, a dry fountain, tall weeds, a rusty swing and one yellow street lamp"),
      place("C", "ห้องดาดฟ้าที่ถูกล็อก", "a locked rooftop storage room, stacked old mattresses, a cracked water tank, newspapers taped over the window"),
      place("D", "ทางเดินหอพัก", "a long dim dormitory corridor, numbered wooden doors on both sides, a tiled floor and one buzzing light at the far end"),
      place("E", "ห้อง 13", "a small dorm room closed for years, a stripped bed, a school photo on the desk, dust on everything and a window facing the yard"),
    ] },
    { places: [
      place("A", "โถงโรงพยาบาลร้าง", "the abandoned lobby of an old provincial hospital, overturned wheelchairs, a dead reception desk, dust in the moonlight through broken windows"),
      place("B", "ลานหน้าตึกเก่า", "the cracked forecourt of the old hospital at night, a fallen sign, banyan roots splitting the concrete and fog around a single lamp post"),
      place("C", "ห้องเก็บศพ", "a cold tiled morgue room in the hospital basement, steel drawers along one wall, a dripping pipe and a flickering green light"),
      place("D", "ทางเดินผู้ป่วย", "a long hospital ward corridor, rusted beds behind half-drawn curtains, a tiled floor and emergency lights blinking red"),
      place("E", "ห้องพยาบาลเวร", "the small night-nurse room, a desk with old patient files, a kettle, a wall calendar from decades ago and a window onto the dark corridor"),
    ] },
  ],
  objects: [
    { name: "ตุ๊กตาไม้แกะสลัก", short: "ตุ๊กตาไม้", look: "a small carved wooden doll in a faded red silk dress" },
    { name: "กล่องดนตรีเก่า", short: "กล่องดนตรี", look: "an antique brass music box with a dancing figure on the lid" },
    { name: "หวีงาช้างโบราณ", short: "หวีโบราณ", look: "an old ivory-coloured comb with long black hairs caught in its teeth" },
    { name: "รูปถ่ายขาวดำในกรอบ", short: "รูปต้องห้าม", look: "an old black-and-white photograph of a young woman in a cracked wooden frame" },
    { name: "ผ้าซิ่นไหมโบราณ", short: "ผ้าซิ่น", look: "a folded antique purple silk sarong with gold thread, wrapped in white string" },
  ],
  plots: [
    { title: "{OBJT}ที่รอคน", logline: "{LEAD}ย้ายมาอยู่ที่ใหม่กับ{ALLY} แล้วพบ{OBJ}ที่{RIVAL}สั่งห้ามแตะ ทุกคืนมีเสียงเรียกชื่อเธอ",
      truth: "วิญญาณใน{OBJ}คือหญิงสาวที่ตายรอคนรักอยู่ที่นี่ และ{LEAD}คือหลานของคนรักคนนั้น", ending: "{LEAD}นำ{OBJ}ไปคืนที่ท่าน้ำ วิญญาณได้ไปสงบ {RIVAL}ยิ้มเป็นครั้งแรก",
      reveal1: say("RIVAL", "เขาไม่ได้อยากทำร้ายใคร เขาแค่รอคนคนหนึ่ง"), reveal2: say("RIVAL", "คนที่เขารอ... คือตาของหนู"), finalLine: say("RIVAL", "ไปสงบเถอะ คนที่รอมาถึงแล้ว"),
      roles: { LEAD: { trait: "กล้า ดื้อเงียบ", want: "อยากเริ่มชีวิตใหม่", secret: "ฝันเห็นหญิงชุดไทยตั้งแต่เด็ก" },
        ALLY: { trait: "ขี้กลัวแต่ไม่ทิ้งเพื่อน", want: "อยากถ่ายคลิปผีให้ดัง", secret: "แอบชอบ{LEAD}" },
        RIVAL: { trait: "เงียบ เก็บความลับ", want: "อยากให้ทุกคนออกไปก่อนคืนวันพระใหญ่", secret: "เคยเห็นหญิงคนนั้นตายกับตา" } } },
    { title: "คืนที่{OBJT}กลับมา", logline: "{OBJ}ที่ถูกทิ้งไปแล้วกลับมาวางที่เดิมทุกเช้า {LEAD}กับ{ALLY}ต้องหาว่าใครส่งมันกลับมา ก่อนจะมีคนหายไปอีก",
      truth: "{RIVAL}คือคนที่ทำให้เจ้าของ{OBJ}ตาย และวิญญาณกลับมาเพื่อให้ความจริงถูกเปิด", ending: "{RIVAL}ยอมสารภาพต่อหน้าทุกคน วิญญาณปล่อย{ALLY}กลับมา และ{OBJ}ก็ไม่กลับมาอีก",
      reveal1: say("RIVAL", "มันไม่ได้กลับมาเอง... มันกลับมาหาฉัน"), reveal2: say("RIVAL", "คืนนั้นฉันเป็นคนปิดประตูขังเธอไว้"), finalLine: say("LEAD", "เธอได้ยินแล้วนะ ไปได้แล้ว"),
      roles: { LEAD: { trait: "ช่างสังเกต ไม่ยอมแพ้", want: "อยากรู้ความจริงของที่นี่", secret: "พี่สาวเคยหายไปที่นี่" },
        ALLY: { trait: "ตลก ใจดี", want: "อยากพา{LEAD}ออกไปอย่างปลอดภัย", secret: "เคยหยิบ{OBJ}ไปขาย" },
        RIVAL: { trait: "ใจดีต่อหน้า เย็นชาลับหลัง", want: "อยากให้เรื่องเก่าเงียบไปตลอดกาล", secret: "รู้ว่าใครตายในคืนนั้น" } } },
    { title: "{PLACE} ตีสาม", logline: "ทุกตีสาม{PLACE}จะมีเสียงเดินและ{OBJ}ย้ายที่เอง {LEAD}กับ{ALLY}ตั้งกล้องจับภาพ แต่สิ่งที่เห็นทำให้{RIVAL}หน้าซีด",
      truth: "{OBJ}ผูกวิญญาณเด็กหญิงไว้ เธอไม่ใช่ผี แต่เป็นคนเฝ้าที่นี่ไม่ให้สิ่งที่ร้ายกว่าออกมา", ending: "{LEAD}ทำพิธีส่งเด็กหญิงไปสงบ แล้วผนึกสิ่งร้ายไว้ด้วยตัวเอง {RIVAL}ขอบคุณทั้งน้ำตา",
      reveal1: say("RIVAL", "เด็กคนนั้นไม่ได้หลอกใคร เขาเฝ้าเราอยู่"), reveal2: say("RIVAL", "ถ้าเขาไป สิ่งที่อยู่ข้างล่างจะขึ้นมา"), finalLine: say("LEAD", "ไม่ต้องเฝ้าแล้วนะ ฉันดูแลต่อเอง"),
      roles: { LEAD: { trait: "ใจเย็น มีสัมผัสพิเศษ", want: "อยากพิสูจน์ว่าตัวเองไม่ได้บ้า", secret: "ได้ยินเสียงคนตายมาตั้งแต่เด็ก" },
        ALLY: { trait: "เชื่อแต่หลักฐาน", want: "อยากได้คลิปจริงสักคลิป", secret: "กล้องของเขาจับภาพได้ก่อนที่จะบอก" },
        RIVAL: { trait: "ดุ ขี้ระแวง", want: "อยากให้ทุกคนอยู่ห่างจากชั้นล่าง", secret: "เคยเป็นคนผูกวิญญาณไว้เอง" } } },
  ],
  hooks: [say("LEAD", "ไม่เป็นไร... ใจเย็นไว้ก่อน"), say("ALLY", "เมื่อกี้เห็นเหมือนกันใช่ไหม"), say("LEAD", "เราต้องรู้ให้ได้ว่ามันคืออะไร"),
    say("ALLY", "ผมว่าเราออกไปจากที่นี่เถอะ"), say("LEAD", "ไม่ คืนนี้ฉันจะไม่หนี")],
  moves: [
    m("knock", "เสียงเคาะ", "{LEAD}ได้ยินเสียงเคาะเป็นจังหวะดังมาจากความมืด", "{LEAD} freezes as slow rhythmic knocking comes from somewhere close; she turns her head toward the sound very slowly", 1, { say: say("LEAD", "ใคร... อยู่ตรงนั้น") }),
    m("photo", "รูปที่มีคนเกิน", "{ALLY}พบคนแปลกหน้ายืนอยู่ข้างหลังในรูปเก่า", "{ALLY} lifts an old framed photo close to his face; a blurred extra figure stands behind the people in it; his hands start to shake", 1, { at: "A", say: say("ALLY", "ทุกรูป... มีคนนี้ยืนอยู่ข้างหลัง"), clue: "มีคนแปลกหน้าอยู่ในรูปเก่าทุกรูป" }),
    m("diary", "สมุดบันทึก", "{LEAD}พบสมุดบันทึกเก่าที่เขียนถึง{OBJ}", "{LEAD} opens a dusty notebook under the lamp, her fingers tracing faded Thai handwriting and a pencil sketch of {OBJ}", 1, { say: say("LEAD", "คนเขียนรู้เรื่อง{OBJ}"), clue: "สมุดบันทึกพูดถึงพิธีที่ริมน้ำ" }),
    m("warning", "คำเตือน", "{RIVAL}ปรากฏตัวเงียบๆ แล้วเตือนอย่ายุ่งกับ{OBJ}", "{RIVAL} appears in the doorway without a sound, staring calmly, raises one wrinkled hand in warning and speaks", 1, { say: say("RIVAL", "อย่าไปยุ่งกับมัน ถ้ายังอยากออกไปจากที่นี่") }),
    m("lights", "ไฟดับ", "ไฟดับทั้งหมด เหลือแค่แสงไฟฉายของ{ALLY}", "the light flickers and dies; only {ALLY}'s phone flashlight beam sweeps across the room, catching dust in the air beside {LEAD}", 2, { say: say("LEAD", "อย่าเพิ่งขยับ") }),
    m("whisper", "เสียงกระซิบ", "มีเสียงกระซิบเรียกชื่อ{LEAD}จากความมืด", "{LEAD} stands still in the dark as a faint whisper seems to come from just behind her shoulder; she slowly looks back", 2, { say: say("LEAD", "ได้ยินไหม มันเรียกชื่อฉัน") }),
    m("footage", "กล้องจับภาพได้", "{ALLY}ดูวิดีโอในมือถือ เห็นเงาดำยืนข้าง{LEAD}", "{ALLY} replays a video on his phone; his face drains of colour; he slowly lowers the phone and looks at {LEAD}", 2, { say: say("ALLY", "เมื่อกี้มีคนยืนข้างเธอ") }),
    m("moved", "ย้ายที่เอง", "{OBJ}ไปอยู่ในที่ที่ไม่มีใครวางไว้", "{LEAD} and {ALLY} stop dead: {OBJ} sits in the middle of the floor where nobody put it, perfectly still", 2, { say: say("ALLY", "ใครเอามันมาวางตรงนี้") }),
    m("footprints", "รอยเท้าเปียก", "รอยเท้าเปียกเดินเข้ามาหาทั้งสอง", "wet bare footprints appear one by one on the floor, walking toward {LEAD} and {ALLY}, with nobody making them", 3, { say: say("ALLY", "มันเดินมาทางเรา") }),
    m("scratch", "รอยข่วน", "{ALLY}ถูกบางอย่างที่มองไม่เห็นข่วนแขน", "{ALLY} gasps and grabs his left forearm as three thin red scratch marks appear on it by themselves", 3, { say: say("ALLY", "โอ๊ย! มีอะไรข่วนผม"), condition: { who: "ALLY", en: "three thin red scratch marks on his left forearm", th: "แขนซ้ายมีรอยข่วนสามเส้น" } }),
    m("cold", "ลมหายใจเย็น", "{LEAD}เห็นไอเย็นออกจากปากตัวเอง ทั้งที่อากาศร้อน", "{LEAD}'s breath suddenly turns to white mist in the warm night air; she wraps her arms around herself and looks around", 2, { say: say("LEAD", "ทำไมมันหนาวขนาดนี้") }),
    m("lullaby", "เพลงกล่อมเด็ก", "เสียงเพลงกล่อมเด็กแผ่วๆ ดังมาจากที่ที่ไม่มีใคร", "{LEAD} and {ALLY} hold their breath as a faint Thai lullaby drifts from the empty dark at the end of the room", 1, { say: say("ALLY", "เพลงนี้... ยายผมเคยร้อง") }),
  ],
  cliffs: [
    m("c-hand", "มือบนไหล่", "มือซีดๆ วางบนไหล่{ALLY}จากด้านหลัง โดยที่เขายังไม่รู้ตัว", "a pale thin hand slowly comes to rest on {ALLY}'s shoulder from behind; he has not noticed yet; hold on his face", 2),
    m("c-door", "ประตูปิดเอง", "ประตูปิดเองดังปังและล็อก ขังทั้งสองไว้", "the door slams shut by itself and the lock clicks; {LEAD} spins around and pulls the handle, it will not open", 2, { say: say("LEAD", "เปิดไม่ออก!") }),
    m("c-behind", "ข้างหลัง", "{RIVAL}ยืนอยู่ชิดหลัง{LEAD} ทั้งที่เมื่อกี้ไม่มีใคร", "{LEAD} turns around and {RIVAL} is suddenly standing right behind her, very close, and speaks softly into her face", 1, { say: say("RIVAL", "หนูมาช้าไปคืนนึงนะ") }),
    m("c-laugh", "เสียงหัวเราะ", "เสียงหัวเราะเบาๆ ดังมาจากข้างบน", "{LEAD} and {ALLY} look up together as soft laughter echoes from above; dust drifts down from the ceiling", 1, { say: say("ALLY", "ข้างบน... มีคนอยู่") }),
    m("c-face", "ใบหน้าในความมืด", "แสงไฟฉายส่องเจอใบหน้าซีดในมุมห้อง แล้วไฟก็ดับ", "the flashlight beam lands on a still pale face in the dark corner for one second, then the light dies to black", 3),
  ],
  beats: {
    OPENING: { title: "คืนแรก", at: "A", shots: [
      m("o1", "มาถึง", "{LEAD}กับ{ALLY}มาถึงเป็นครั้งแรก มี{RIVAL}ยืนรออยู่", "{LEAD} and {ALLY} step inside for the first time carrying bags, looking around; {RIVAL} stands quietly in the shadows watching them; all three faces clearly visible", 1, { say: say("ALLY", "ที่นี่... เงียบกว่าที่คิดอีก") }),
      m("o2", "กฎข้อเดียว", "{RIVAL}ยื่นกุญแจให้และเตือนเรื่อง{OBJ}", "{RIVAL} places an old brass key in {LEAD}'s palm, glances at {OBJ} on the shelf and speaks gravely", 1, { say: say("RIVAL", "ทำอะไรก็ได้ แต่ห้ามแตะของชิ้นนั้น") }),
      m("o3", "ตีสาม", "ตีสาม {LEAD}ได้ยินเสียงเดินอยู่ใกล้ๆ", "late at night {LEAD} lies awake on a thin mattress, eyes wide, as slow footsteps creak across the floor near her", 2, { say: say("LEAD", "{ALLY}... ตื่นยัง") }),
    ], cliff: m("o-c", "มันขยับ", "{LEAD}ส่องไฟฉายไปที่{OBJ} และเห็นมันขยับเอง", "{LEAD} points a flashlight at {OBJ}; in the beam it slowly turns by itself to face her", 2) },
    INCITING: { title: "หลักฐานชิ้นแรก", at: "A", shots: [
      m("i1", "ตั้งกล้อง", "{ALLY}ตั้งกล้องมือถือถ่าย{OBJ}ไว้ทั้งคืน", "{ALLY} props his phone on a stack of books facing {OBJ} and taps record, the red dot glowing", 1, { say: say("ALLY", "คืนนี้ต้องได้หลักฐาน") }),
      m("i2", "ดูวิดีโอ", "เช้าวันต่อมา ทั้งสองนั่งดูวิดีโอด้วยกัน", "morning light; {LEAD} and {ALLY} huddle over the phone screen scrubbing through the night's video, faces lit by the screen", 1, { say: say("LEAD", "หยุดตรงนี้... ซูมเข้าไป") }),
      m("i3", "แอบมอง", "{RIVAL}แอบมองทั้งสองอยู่นอกหน้าต่าง", "through the window behind them {RIVAL} stands outside watching, then turns and walks away", 1),
    ], cliff: m("i-c", "นิ้วในวิดีโอ", "ในวิดีโอ ตีสามตรง มีมือซีดๆ เอื้อมมาจับ{OBJ}", "{ALLY} holds the phone up between them: on screen at 3:00 a.m. a pale hand reaches into frame and strokes {OBJ}; he gasps and drops the phone", 3, { say: say("ALLY", "มันอยู่กับเราทั้งคืน") }) },
    MIDPOINT: { title: "ความจริงครึ่งเดียว", at: "B", shots: [
      m("mp1", "เผชิญหน้า", "{LEAD}เอาสมุดบันทึกไปถาม{RIVAL}ที่ริมน้ำ", "{LEAD} confronts {RIVAL} by the water, holding up the old notebook; {ALLY} stands behind her", 2, { say: say("LEAD", "รู้มาตลอดใช่ไหม") }),
      m("mp2", "สารภาพ", "{RIVAL}ยอมเล่าความจริงครึ่งหนึ่ง", "{RIVAL} looks out at the dark for a long moment, the lantern swaying, then speaks without turning around", 1, { say: "REVEAL1" }),
      m("mp3", "เข้าใจผิด", "{ALLY}ถอยหลัง เพิ่งรู้ว่าที่ผ่านมาเข้าใจผิด", "{ALLY} steps back, shaken, rubbing his arm, trying to process what he just heard", 1, { say: say("ALLY", "แปลว่าที่ผ่านมา... เราเข้าใจผิดหมด") }),
    ], cliff: m("mp-c", "แสงบนน้ำ", "น้ำเริ่มหมุนวนเป็นวงกลม ตะเกียงแกว่งแรง", "behind them the dark water begins to ripple and turn in a slow glowing circle; the lantern swings wildly", 2) },
    CRISIS: { title: "คืนที่มันโกรธ", at: "A", shots: [
      m("cr1", "ลมหนาว", "ลมเย็นพัดทั่วห้อง ของบนผนังร่วงลงทั้งหมด", "a cold wind tears through the room, frames crash down from the wall one after another; {LEAD} shields {ALLY} with her arm", 3),
      m("cr2", "ถูกลาก", "{ALLY}ถูกแรงที่มองไม่เห็นลากถอยหลัง", "{ALLY} is pulled backward across the floor by an unseen force, clawing at the boards", 3, { say: say("ALLY", "ช่วยด้วย!") }),
      m("cr3", "จับมือ", "{LEAD}คว้ามือ{ALLY}ไว้สุดแรง", "{LEAD} throws herself down and grabs {ALLY}'s hand with both hands, straining with all her strength", 3, { say: say("LEAD", "จับมือฉันไว้!") }),
    ], cliff: m("cr-c", "หายไป", "{ALLY}ถูกลากหายเข้าไปในความมืด", "{ALLY}'s hand slips away; he vanishes into the darkness at the end of the room and a door slams; {LEAD} alone on the floor", 3, { say: say("LEAD", "{ALLY}!!") }) },
    CLIMAX: { title: "พิธีริมน้ำ", at: "B", shots: [
      m("cl1", "ถือของมา", "{LEAD}ถือ{OBJ}ฝ่าหมอกมาที่ริมน้ำ", "at night {LEAD} carries {OBJ} through thick mist to the water's edge; {RIVAL} walks beside her holding a candle", 2),
      m("cl2", "บอกความจริง", "{RIVAL}เล่าความจริงทั้งหมด ขณะ{LEAD}วาง{OBJ}ลง", "{RIVAL} speaks softly as {LEAD} kneels and sets {OBJ} down facing the water", 2, { say: "REVEAL2" }),
      m("cl3", "แสง", "แสงสีขาวนวลแผ่ไปทั่วผิวน้ำ", "a soft white light spreads from {OBJ} across the water and the mist begins to part", 2),
    ], cliff: m("cl-c", "ใบหน้าบนน้ำ", "บนผิวน้ำ หญิงสาวคนหนึ่งปรากฏและจ้องมาที่{LEAD}", "on the water's surface the reflection of a young woman in old-fashioned clothes appears, looks straight at {LEAD}, and lifts her hand", 2) },
    FINALE: { title: "เช้าที่สงบ", at: "B", shots: [
      m("f1", "กลับมา", "{ALLY}เดินโซเซกลับมา {LEAD}วิ่งเข้าไปกอด", "dawn; {ALLY} stumbles out of the mist, dazed but alive, and {LEAD} runs into his arms", 1, { say: say("ALLY", "ผม... กลับมาแล้วใช่ไหม") }),
      m("f2", "ปล่อยวาง", "{LEAD}ค่อยๆ ส่ง{OBJ}ลงน้ำ {RIVAL}ยิ้มบางๆ", "at sunrise {LEAD} gently lowers {OBJ} into the calm water while {RIVAL} watches with a faint smile", 1, { say: "FINAL" }),
      m("f3", "สงบแล้ว", "ทุกอย่างเงียบสงบ ทั้งสองนั่งรับแสงเช้า", "wide shot at sunrise: everything quiet and warm; {LEAD} and {ALLY} sit together on the steps sharing a drink as {RIVAL} walks away", 1, { at: "A", say: say("LEAD", "ที่นี่... เป็นบ้านของเราแล้วจริงๆ") }),
    ] },
  },
};

const ACTION: MixGenre = {
  style: "Photorealistic Thai action thriller, cinematic anamorphic look, neon night city, high contrast, handheld energy, dynamic but readable camera moves",
  sound: "city ambience, engines, footsteps, punchy impacts; no music score",
  hashtags: ["#ละครสั้น", "#แอ็กชัน", "#ละครไทย", "#ระทึก"],
  roles: {
    LEAD: { gender: "M", band: "YOUNG", outfits: ["a black leather jacket over a grey T-shirt, dark jeans and boots", "a navy work jacket with a reflective stripe, black cargo trousers and sneakers", "a dark olive hoodie, black jeans and fingerless gloves"] },
    ALLY: { gender: "F", band: "YOUNG", outfits: ["a cropped denim jacket over a black tank top and combat trousers", "a red windbreaker, black leggings and white sneakers", "a black turtleneck, a utility vest and dark jeans"] },
    RIVAL: { gender: "M", band: "MID", outfits: ["a charcoal suit with an open collar and no tie", "a white linen shirt, a gold chain and black trousers", "a long black coat over a dark shirt"] },
  },
  packs: [
    { places: [
      place("A", "ตลาดนัดกลางคืน", "a busy Bangkok night market lane with strings of bulbs, smoking grill stalls, plastic tables and wet asphalt reflections"),
      place("B", "โกดังริมน้ำ", "a dim riverside warehouse, stacked wooden crates, a forklift, hanging chains and moonlight through gaps in the tin walls"),
      place("C", "ดาดฟ้าตึกสูง", "the windy rooftop of a Bangkok tower at night, air-conditioning units, a helipad mark and the city lights below"),
      place("D", "ซอยหลังตึกแถว", "a narrow back lane behind old shophouses at night, dripping air-conditioners, drainpipes, metal doors and puddles"),
      place("E", "ห้องเช่าเล็กๆ", "a small rented room above a shophouse, a mattress on the floor, a map pinned to the wall, a desk lamp and blinds striping the light"),
    ] },
    { places: [
      place("A", "ท่ารถตู้", "a crowded van terminal under a flyover at night, rows of white vans, fluorescent lights and people with bags"),
      place("B", "อู่ซ่อมรถ", "a cluttered car garage under a flyover, hanging tools, a car on a lift and one flickering fluorescent tube"),
      place("C", "ลานจอดรถใต้ดิน", "an empty underground car park, concrete pillars, a few dusty cars, flickering ceiling lights and a ramp to the street"),
      place("D", "บันไดหนีไฟ", "the bare concrete fire stairwell of an office tower, a green exit sign, metal railings and echoing footsteps"),
      place("E", "ห้องควบคุมกล้อง", "a cramped security room full of CCTV monitors, a swivel chair, tangled cables and cold blue light"),
    ] },
    { places: [
      place("A", "สถานีรถไฟเก่า", "an old Bangkok railway station hall at night, wooden benches, a big clock, ceiling fans and a few sleeping travellers"),
      place("B", "ลานตู้คอนเทนเนอร์", "a container port yard at night, stacks of coloured containers, orange sodium lights and a crane overhead"),
      place("C", "สะพานลอยข้ามราง", "a steel footbridge over railway tracks at night, chain-link fencing, a train passing below and the city skyline"),
      place("D", "ตรอกชุมชนริมราง", "a narrow alley of a trackside community, laundry overhead, tin roofs, potted plants and a single bulb"),
      place("E", "ร้านก๋วยเตี๋ยวปิดแล้ว", "the inside of a closed noodle shop at night, a steel counter with soup pots, stacked plastic stools and a half-closed roller shutter"),
    ] },
  ],
  objects: [
    { name: "แฟลชไดรฟ์สีแดง", short: "ไดรฟ์แดง", look: "a small red metal flash drive on a black cord" },
    { name: "กระเป๋าเอกสารสีเงิน", short: "กระเป๋าเงิน", look: "a dented silver aluminium briefcase with a combination lock" },
    { name: "มือถือเครื่องเก่า", short: "มือถือปริศนา", look: "a scratched old black flip phone wrapped in tape" },
    { name: "กุญแจล็อกเกอร์หมายเลข 9", short: "กุญแจเบอร์ 9", look: "a brass locker key with a round tag stamped with the number 9" },
    { name: "นาฬิกาข้อมือของพ่อ", short: "นาฬิกาพ่อ", look: "a worn steel wristwatch with a cracked glass face" },
  ],
  plots: [
    { title: "ล่า{OBJT}", logline: "{LEAD}ได้{OBJ}มาโดยบังเอิญ แล้วทั้งเมืองก็เริ่มไล่ล่าเขา มีแค่{ALLY}ที่ยอมช่วย",
      truth: "ใน{OBJ}คือหลักฐานว่า{RIVAL}อยู่เบื้องหลังเหตุที่ทำให้พ่อของ{LEAD}ตาย", ending: "{LEAD}กับ{ALLY}ส่งหลักฐานถึงตำรวจทันเวลา {RIVAL}ถูกจับต่อหน้าทุกคน",
      reveal1: say("ALLY", "ไฟล์ในนี้... มีชื่อพ่อนายอยู่ด้วย"), reveal2: say("RIVAL", "พ่อแกก็เป็นแบบนี้ ไม่ยอมแพ้จนวันสุดท้าย"), finalLine: say("LEAD", "จบแล้วพ่อ... ผมทำได้แล้ว"),
      roles: { LEAD: { trait: "นิ่ง ใจถึง", want: "อยากใช้ชีวิตธรรมดา", secret: "พ่อตายในอุบัติเหตุที่ไม่ใช่อุบัติเหตุ" },
        ALLY: { trait: "ฉลาด ปากไว", want: "อยากล้างหนี้ให้ครอบครัว", secret: "เคยทำงานให้{RIVAL}" },
        RIVAL: { trait: "เยือกเย็น อันตราย", want: "อยากได้{OBJ}คืนก่อนเช้า", secret: "ฟอกเงินผ่านธุรกิจถูกกฎหมาย" } } },
    { title: "{OBJT} 24 ชั่วโมง", logline: "{RIVAL}จับคนที่{LEAD}รักไว้ และให้เวลาหนึ่งวันเอา{OBJ}มาแลก {LEAD}กับ{ALLY}ต้องเลือกระหว่างหนีกับสู้",
      truth: "{OBJ}คือรหัสเปิดบัญชีลับของ{RIVAL} คนที่ซ่อนมันไว้คือ{ALLY}เอง", ending: "{LEAD}ช่วยคนที่รักออกมาได้ {ALLY}ยอมมอบตัวเพื่อเปิดโปง{RIVAL} ทั้งสองแยกทางกันด้วยรอยยิ้ม",
      reveal1: say("ALLY", "ขอโทษนะ... คนที่ซ่อนมันไว้คือฉันเอง"), reveal2: say("RIVAL", "เธอทรยศฉันเพื่อแก คิดว่าคุ้มเหรอ"), finalLine: say("ALLY", "ไปเถอะ ครั้งนี้ฉันขอเป็นคนรับผิดเอง"),
      roles: { LEAD: { trait: "ใจร้อน รักครอบครัว", want: "อยากพาน้องสาวกลับบ้าน", secret: "เคยเป็นนักมวยใต้ดิน" },
        ALLY: { trait: "ลึกลับ เก่งทุกอย่าง", want: "อยากเริ่มชีวิตใหม่", secret: "เคยเป็นคนสนิทของ{RIVAL}" },
        RIVAL: { trait: "ยิ้มเก่ง ใจดำ", want: "อยากได้{OBJ}และตัว{ALLY}คืน", secret: "กลัวการถูกหักหลังมากที่สุด" } } },
    { title: "คืนส่งของ", logline: "{LEAD}รับงานส่ง{OBJ}แค่ครั้งเดียวเพื่อจ่ายหนี้ แต่ปลายทางคือกับดักของ{RIVAL}",
      truth: "{RIVAL}จ้าง{LEAD}เพราะต้องการแพะรับบาป และ{ALLY}คือตำรวจนอกเครื่องแบบที่ตามคดีนี้มาสองปี", ending: "{LEAD}กับ{ALLY}ร่วมมือกันวางกับดักกลับ {RIVAL}ถูกจับคาที่ {LEAD}ได้เริ่มต้นใหม่",
      reveal1: say("ALLY", "ฉันเป็นตำรวจ... ตามเขามาสองปีแล้ว"), reveal2: say("RIVAL", "แกเป็นแค่แพะ ตั้งแต่วันแรกแล้ว"), finalLine: say("LEAD", "ส่งของเสร็จแล้วครับ... ถึงมือตำรวจพอดี"),
      roles: { LEAD: { trait: "ซื่อ ดื้อ", want: "อยากปลดหนี้ให้แม่", secret: "ไม่เคยทำผิดกฎหมายมาก่อน" },
        ALLY: { trait: "เย็นชา เฉียบคม", want: "อยากปิดคดีนี้", secret: "เป็นตำรวจนอกเครื่องแบบ" },
        RIVAL: { trait: "สุภาพ เจ้าเล่ห์", want: "อยากให้{LEAD}รับผิดแทน", secret: "มีคนในตำรวจคอยช่วย" } } },
  ],
  hooks: [say("LEAD", "ไม่มีเวลาแล้ว ไปต่อ"), say("ALLY", "ทางนี้!"), say("LEAD", "ใครส่งพวกมันมา"), say("ALLY", "ฉันหาทางออกให้เอง"), say("LEAD", "จับไว้แน่นๆ")],
  moves: [
    m("run", "วิ่งหนี", "{LEAD}วิ่งหนีลูกน้อง{RIVAL}ฝ่าฝูงคน", "{LEAD} sprints through the crowd clutching {OBJ}, ducking under hanging lights as men in black jackets push through behind him", 2, { at: "A", say: say("LEAD", "หลบหน่อยครับ!") }),
    m("hack", "เจาะกล้อง", "{ALLY}เจาะระบบกล้องวงจรปิดหาทางหนี", "{ALLY} types fast on a laptop, CCTV feeds flickering across its screen, then looks up with a grin", 1, { at: "E", say: say("ALLY", "เจอแล้ว ทางออกฝั่งซ้าย") }),
    m("plan", "วางแผน", "ทั้งสองวางแผนบนแผนที่ที่ติดผนัง", "{LEAD} and {ALLY} stand at a map pinned to the wall, she draws a red line with a marker while he nods", 1, { at: "E", say: say("ALLY", "เราเข้าทางนี้ ออกทางนี้ ห้ามพลาด") }),
    m("decoy", "ของปลอม", "{LEAD}สลับ{OBJ}กับของปลอมหลอกศัตรู", "{LEAD} quietly swaps {OBJ} for an identical fake and slides the real one into his boot", 1, { say: say("LEAD", "เอาไปสิ ถ้าอยากได้") }),
    m("tracker", "ตัวติดตาม", "{ALLY}พบเครื่องติดตามซ่อนอยู่ในเสื้อ{LEAD}", "{ALLY} pulls a tiny blinking tracker out of the collar of {LEAD}'s jacket and holds it up between two fingers", 2, { say: say("ALLY", "มันตามเรามาตลอด") }),
    m("fight", "สู้มือเปล่า", "{LEAD}ถูกดักในซอย ต้องสู้มือเปล่า", "two men in black jackets block the way; {LEAD} drops into a stance and fights them off with fast bare-handed moves", 3, { at: "D" }),
    m("hurt", "บาดเจ็บ", "{LEAD}ไหล่บาดเจ็บระหว่างหนี", "{LEAD} slams into a metal shutter while escaping, clutches his right shoulder and grits his teeth", 3, { say: say("LEAD", "ไม่เป็นไร... ยังไหว"), condition: { who: "LEAD", en: "a torn right sleeve and a bandaged right shoulder", th: "ไหล่ขวาพันผ้าพันแผล" } }),
    m("call", "สายขู่", "{RIVAL}โทรมาขู่ด้วยน้ำเสียงเรียบ", "{LEAD} answers a ringing phone and listens as a calm deep voice speaks on the other end; his jaw tightens", 2, { say: say("RIVAL", "เอาของมาคืน แล้วแกจะได้ใช้ชีวิตต่อ") }),
    m("hide", "หลบซ่อน", "ทั้งสองหลบหลังเสาขณะศัตรูเดินผ่าน", "{LEAD} and {ALLY} press flat behind a pillar, holding their breath, as flashlight beams sweep past inches away", 2, { say: say("ALLY", "อย่าหายใจแรง") }),
    m("patch", "ทำแผล", "{ALLY}ทำแผลให้{LEAD} ทั้งสองเริ่มเปิดใจ", "{ALLY} cleans a cut on {LEAD}'s arm under a desk lamp; he winces, she almost smiles", 1, { at: "E", say: say("ALLY", "ทำไมนายถึงไม่หนีไปตั้งแต่แรก") }),
    m("drive", "ซิ่งหนี", "{LEAD}ซิ่งรถฝ่าการจราจร โดยมี{ALLY}นั่งข้างๆ", "{LEAD} grips the wheel and weaves through night traffic with {ALLY} beside him, headlights streaking past", 2, { say: say("ALLY", "เร็วกว่านี้อีก!") }),
  ],
  cliffs: [
    m("c-surround", "ถูกล้อม", "ไฟฉายหลายดวงสาดมาจากทุกทิศ ทั้งสองถูกล้อม", "flashlight beams snap on from every direction; {LEAD} and {ALLY} stand back to back, surrounded", 3, { say: say("LEAD", "อยู่ข้างหลังฉัน") }),
    m("c-grab", "ถูกจับตัว", "มือใหญ่ลาก{ALLY}หายเข้าไปในรถตู้", "a van door slides open and a big hand yanks {ALLY} inside; the door slams and the van speeds off as {LEAD} runs after it", 3, { say: say("LEAD", "ไม่!") }),
    m("c-step", "ก้าวออกจากเงา", "{RIVAL}ก้าวออกมาจากเงาอย่างช้าๆ", "{RIVAL} steps slowly out of the shadows, clapping his hands, and smiles", 2, { say: say("RIVAL", "เหนื่อยหรือยัง") }),
    m("c-open", "ของที่อยู่ข้างใน", "{OBJ}ตกพื้น เผยรูปถ่ายเก่าใบหนึ่ง", "{OBJ} hits the ground and an old photo falls out beside it; {LEAD} picks it up and stares", 2, { say: say("LEAD", "นี่มัน... รูปพ่อผม") }),
    m("c-edge", "ขอบตึก", "{LEAD}ห้อยตัวจากขอบ มือเริ่มลื่น", "{LEAD} hangs from a ledge by one hand, fingers slipping on wet concrete, a long drop below", 3),
  ],
  beats: {
    OPENING: { title: "คืนที่ทุกอย่างเปลี่ยน", at: "A", shots: [
      m("o1", "ได้ของมา", "ชายแปลกหน้ายัด{OBJ}ใส่มือ{LEAD} {ALLY}เห็นเหตุการณ์ {RIVAL}มองอยู่ไกลๆ", "a panicked stranger presses {OBJ} into {LEAD}'s hand and runs; {ALLY} at a nearby stall sees it; {RIVAL} watches from a parked black car; all three faces clearly visible", 1, { say: say("LEAD", "เฮ้ย! นี่มันอะไร") }),
      m("o2", "คนแปลกหน้า", "{ALLY}เดินมาเตือนว่า{LEAD}กำลังเดือดร้อน", "{ALLY} walks up to {LEAD}, glances at {OBJ}, then at the black car, and lowers her voice", 1, { say: say("ALLY", "ถ้าอยากรอด ตามฉันมาเดี๋ยวนี้") }),
      m("o3", "ถูกตาม", "รถสีดำเริ่มขับตามทั้งสอง", "{LEAD} and {ALLY} walk fast through the night; behind them a black car turns its headlights on and follows", 2),
    ], cliff: m("o-c", "ดักหน้า", "รถสีดำปาดหน้า ลูกน้อง{RIVAL}ลงมาล้อม", "the black car swerves in front of them and stops; doors open; men in black jackets step out", 3, { say: say("LEAD", "เอาจริงดิ") }) },
    INCITING: { title: "ที่ซ่อน", at: "E", shots: [
      m("i1", "หลบมาที่ห้อง", "{ALLY}พา{LEAD}มาหลบที่ห้องเช่า", "{ALLY} locks the door behind {LEAD}, peeks through the blinds at the street, then turns to him", 1, { say: say("ALLY", "ที่นี่ปลอดภัย อย่างน้อยก็คืนนี้") }),
      m("i2", "ตรวจของ", "ทั้งสองตรวจ{OBJ}ใต้แสงไฟ", "{LEAD} and {ALLY} lean over {OBJ} on the desk under the lamp, turning it over carefully", 1, { say: say("LEAD", "มันมีอะไรนักหนา ถึงต้องฆ่ากัน") }),
      m("i3", "ข่าว", "ทีวีรายงานข่าวว่า{LEAD}เป็นผู้ต้องสงสัย", "a small TV in the corner shows {LEAD}'s photo on the news; {LEAD} stares at it, frozen", 2, { say: say("LEAD", "ผมกลายเป็นคนร้ายแล้วเหรอ") }),
    ], cliff: m("i-c", "เคาะประตู", "มีเสียงเคาะประตูเบาๆ แล้วเงาคนก็ทาบที่ช่องประตู", "a slow knock at the door; under it, the shadow of two feet; {ALLY} silently draws {LEAD} back from the door", 3, { say: say("ALLY", "ไม่มีใครรู้ว่าเราอยู่ที่นี่...") }) },
    MIDPOINT: { title: "ความจริงที่ซ่อนไว้", at: "B", shots: [
      m("mp1", "เผชิญหน้า", "{LEAD}ไล่ถาม{ALLY}ว่าปิดบังอะไรอยู่", "{LEAD} grabs {ALLY}'s arm among the crates and turns her to face him", 2, { say: say("LEAD", "เธอรู้อะไรมากกว่าที่บอกใช่ไหม") }),
      m("mp2", "สารภาพ", "{ALLY}ยอมบอกความจริงครึ่งหนึ่ง", "{ALLY} pulls her arm free, looks away into the dark warehouse, then answers quietly", 1, { say: "REVEAL1" }),
      m("mp3", "ช็อก", "{LEAD}ถอยหลัง เพิ่งเข้าใจทุกอย่าง", "{LEAD} steps back against a crate, breathing hard, trying to take it in", 1, { say: say("LEAD", "งั้นทั้งหมดนี้... ไม่ใช่เรื่องบังเอิญ") }),
    ], cliff: m("mp-c", "เสียงปืนนัดแรก", "ไฟในโกดังดับพร้อมกัน แล้วมีเสียงประตูเหล็กเลื่อนปิด", "every light in the warehouse cuts out at once; in the dark a heavy steel door rolls shut with a boom", 2) },
    CRISIS: { title: "หมดทางหนี", at: "D", shots: [
      m("cr1", "ถูกไล่", "ลูกน้อง{RIVAL}ไล่ตามมาจากทั้งสองทาง", "men in black jackets close in from both ends of the lane; {LEAD} pulls {ALLY} behind him", 3),
      m("cr2", "แยกกัน", "{ALLY}ผลัก{LEAD}ให้หนีไปก่อน", "{ALLY} shoves {LEAD} through a side door and slams it, staying outside to face the men", 3, { say: say("ALLY", "ไปเลย! อย่าหันกลับมา!") }),
      m("cr3", "ทุบประตู", "{LEAD}ทุบประตูที่ล็อกไว้", "{LEAD} pounds on the locked door with both fists, shouting, as noises of a struggle come from the other side", 3, { say: say("LEAD", "เปิดประตู!") }),
    ], cliff: m("cr-c", "เงียบ", "เสียงข้างนอกเงียบลง {RIVAL}โทรเข้ามือถือ{LEAD}", "the noise outside stops; {LEAD}'s phone buzzes with an unknown number; he slowly lifts it to his ear", 3, { say: say("RIVAL", "เธออยู่กับฉัน เอาของมาแลก") }) },
    CLIMAX: { title: "แลกตัว", at: "C", shots: [
      m("cl1", "มาตามนัด", "{LEAD}มาตามนัดพร้อม{OBJ}", "{LEAD} walks alone across the windy rooftop holding {OBJ} up; {RIVAL} waits with {ALLY} held beside him", 2, { say: say("LEAD", "ของอยู่นี่ ปล่อยเธอซะ") }),
      m("cl2", "ความจริง", "{RIVAL}หัวเราะแล้วพูดความจริง", "{RIVAL} laughs softly and steps forward, the city lights behind him", 2, { say: "REVEAL2" }),
      m("cl3", "สู้", "{LEAD}พุ่งเข้าใส่ ขณะ{ALLY}สะบัดหลุด", "{LEAD} charges as {ALLY} twists free and elbows the man holding her; the rooftop erupts into a fight", 3),
    ], cliff: m("cl-c", "ไซเรน", "ไฟไซเรนสาดขึ้นมาจากข้างล่าง {RIVAL}หันไปมอง", "red and blue lights flood up from the street below; {RIVAL} turns, his smile fading for the first time", 2) },
    FINALE: { title: "เช้าวันใหม่", at: "C", shots: [
      m("f1", "จบ", "{RIVAL}ถูกจับใส่กุญแจมือ", "dawn on the rooftop; {RIVAL} is handcuffed and led away, glaring back at {LEAD}", 1, { say: say("RIVAL", "แกยังไม่ชนะหรอก") }),
      m("f2", "ขอบคุณ", "{LEAD}กับ{ALLY}ยืนมองเมืองยามเช้า", "{LEAD} and {ALLY} stand side by side at the rooftop edge watching the sunrise over the city, bruised and smiling", 1, { say: "FINAL" }),
      m("f3", "เริ่มใหม่", "ทั้งสองเดินลงบันไดไปพร้อมกัน", "wide shot: {LEAD} and {ALLY} walk away together toward the stairs as the morning light floods the rooftop", 1, { say: say("ALLY", "หิวข้าวไหม ฉันเลี้ยง") }),
    ] },
  },
};

const COMEDY: MixGenre = {
  style: "Bright photorealistic Thai comedy drama, warm saturated colours, soft daylight, lively handheld camera, expressive faces",
  sound: "busy street ambience, sizzling woks, chatter, comic pauses; no music score",
  hashtags: ["#ละครสั้น", "#ตลก", "#ฮาๆ", "#ละครไทย"],
  roles: {
    LEAD: { gender: "F", band: "YOUNG", outfits: ["a pink apron over a white T-shirt and denim shorts", "a yellow floral blouse, wide-leg trousers and sandals", "a striped shop uniform shirt with a name badge and black trousers"] },
    ALLY: { gender: "M", band: "YOUNG", outfits: ["a loud Hawaiian shirt, shorts and flip-flops", "a faded band T-shirt, a backwards cap and jeans", "a too-tight white shirt with a bow tie and black trousers"] },
    RIVAL: { gender: "ANY", band: "MID", outfits: ["a shiny purple blazer over a gold top and big sunglasses on the head", "a cream silk suit with a bright pocket square", "an expensive designer tracksuit and lots of gold jewellery"] },
  },
  packs: [
    { places: [
      place("A", "ร้านส้มตำห้องแถว", "a tiny Bangkok shophouse som tam stall, a wooden mortar on the counter, plastic stools, hanging chilli bunches and a hand-written menu board"),
      place("B", "ร้านแฟรนไชส์ตรงข้าม", "a flashy new franchise restaurant across the street, neon signs, gold chairs and a giant cartoon mascot statue"),
      place("C", "เวทีประกวดในตลาด", "a small market contest stage with a red banner, two cooking stations and rows of folding chairs"),
      place("D", "ทางเท้าหน้าร้าน", "the busy sidewalk in front of the shophouse stall, a striped awning, parked motorbikes and the franchise across the narrow street"),
      place("E", "ครัวหลังร้าน", "the cramped back kitchen of the stall, a big gas stove, dented pots, a deep sink and shelves of jars"),
    ] },
    { places: [
      place("A", "ร้านซักรีดหยอดเหรียญ", "a small coin laundromat, rows of washing machines spinning, bright tube lights, plastic chairs and a vending machine"),
      place("B", "ร้านซักรีดหรูข้างๆ", "a fancy new laundry lounge next door with white marble floors, a coffee bar and staff in matching uniforms"),
      place("C", "งานวัดหน้าซอย", "a lively Thai temple fair at night, coloured lights, a Ferris wheel, game stalls and crowds"),
      place("D", "หน้าร้าน", "the front of the laundromat on a narrow soi, a bench, a sleeping soi dog and a motorbike taxi stand"),
      place("E", "ห้องพักหลังร้าน", "a tiny back room with a folding bed, a fan, piles of folded laundry and a small TV"),
    ] },
    { places: [
      place("A", "ร้านตัดผมเล็กๆ", "a small old-school Thai barber shop, a red barber chair, a big mirror, faded hairstyle posters and a ceiling fan"),
      place("B", "ซาลอนหรูเปิดใหม่", "a glossy new salon across the street with LED mirrors, velvet chairs and loud pop music on screens"),
      place("C", "เวทีประกวดทรงผม", "a hair contest stage at a mall atrium, spotlights, a long judges' table and a cheering crowd"),
      place("D", "ซอยหน้าร้าน", "the narrow soi outside the barber shop, food carts, a motorbike and the salon's neon sign opposite"),
      place("E", "บ้านชั้นบนร้าน", "the cluttered living space above the shop, a sofa, family photos, a rice cooker and a balcony door"),
    ] },
  ],
  objects: [
    { name: "สูตรลับของยาย", short: "สูตรลับ", look: "a grease-stained old notebook with a red cover tied with a rubber band" },
    { name: "ถ้วยรางวัลพลาสติก", short: "ถ้วยรางวัล", look: "a big shiny gold plastic trophy with a wobbly top" },
    { name: "ป้ายร้านเก่า", short: "ป้ายร้าน", look: "an old hand-painted wooden shop sign with a cartoon face" },
    { name: "แมวประจำร้าน", short: "แมวกวัก", look: "a fat orange shop cat wearing a little red collar with a bell" },
    { name: "หม้อทองเหลือง", short: "หม้อวิเศษ", look: "a dented heavy brass pot polished to a shine" },
  ],
  plots: [
    { title: "ศึก{OBJT}", logline: "ร้านเล็กๆ ของ{LEAD}กำลังจะเจ๊งเพราะ{RIVAL}มาเปิดร้านหรูตรงข้าม ทางรอดเดียวคือชนะประกวดด้วย{OBJ}",
      truth: "{RIVAL}เคยเป็นลูกมือของยาย{LEAD} และเปิดร้านเพราะอยากให้ยายยอมรับ", ending: "{LEAD}ชนะใจทั้งตลาด แล้วชวน{RIVAL}มาร่วมทำร้านด้วยกัน",
      reveal1: say("RIVAL", "ยายเธอสอนฉันทุกอย่าง แต่ไม่เคยชมฉันสักครั้ง"), reveal2: say("RIVAL", "ฉันแค่อยากให้ใครสักคนบอกว่าฉันทำได้ดี"), finalLine: say("LEAD", "ทำได้ดีมาก... ยายต้องภูมิใจแน่"),
      roles: { LEAD: { trait: "ขยัน ปากไว", want: "อยากรักษาร้านของยาย", secret: "ทำอาหารไม่เก่งเท่าที่ทุกคนคิด" },
        ALLY: { trait: "ซื่อ ตลก", want: "อยากเป็นดาวติ๊กต็อก", secret: "แอบชอบ{LEAD}มาสิบปี" },
        RIVAL: { trait: "อวดรวย ปากแข็ง", want: "อยากเป็นที่หนึ่งในย่าน", secret: "เคยเป็นลูกมือของยาย{LEAD}" } } },
    { title: "{PLACE}ป่วนรัก", logline: "{LEAD}ต้องแกล้งเป็นแฟนกับ{ALLY}เพื่อหลอก{RIVAL}ที่มาขอซื้อร้าน แต่ยิ่งเล่น ทั้งคู่ยิ่งเริ่มคิดจริง",
      truth: "{RIVAL}ไม่ได้อยากได้ร้าน แต่อยากได้{OBJ}ที่เป็นของแม่ตัวเองที่หายไป", ending: "{LEAD}คืน{OBJ}ให้{RIVAL} ทุกคนหัวเราะทั้งน้ำตา และ{LEAD}กับ{ALLY}ก็คบกันจริง",
      reveal1: say("RIVAL", "ฉันไม่ได้อยากได้ร้านหรอก ฉันอยากได้ของชิ้นนั้น"), reveal2: say("RIVAL", "มันเป็นของแม่ฉัน... ชิ้นเดียวที่เหลือ"), finalLine: say("ALLY", "งั้นเลิกแกล้งเป็นแฟนกันนะ... มาเป็นจริงเลย"),
      roles: { LEAD: { trait: "เก่ง แต่ขี้อาย", want: "อยากเก็บร้านไว้", secret: "แอบชอบ{ALLY}" },
        ALLY: { trait: "เล่นใหญ่ ใจดี", want: "อยากช่วย{LEAD}", secret: "ไม่เคยมีแฟน" },
        RIVAL: { trait: "รวย เว่อร์", want: "อยากได้ร้านให้ได้", secret: "ตามหาของของแม่มาหลายปี" } } },
    { title: "{OBJT}หาย ป่วนทั้งซอย", logline: "{OBJ}ของ{LEAD}หายไปก่อนวันสำคัญ ทั้งซอยต้องช่วยกันตามหา โดยมี{RIVAL}เป็นผู้ต้องสงสัยอันดับหนึ่ง",
      truth: "{RIVAL}ไม่ได้ขโมย แต่{ALLY}เผลอเอาไปใช้ถ่ายคลิปแล้วลืม", ending: "{ALLY}สารภาพต่อหน้าทุกคน {LEAD}ให้อภัย และ{RIVAL}กลายเป็นเพื่อนใหม่ของทั้งซอย",
      reveal1: say("RIVAL", "ฉันไม่ได้เอาไป แต่ฉันเห็นว่าใครเอาไป"), reveal2: say("RIVAL", "ถามเพื่อนเธอสิ ว่าเมื่อวานถ่ายคลิปอะไร"), finalLine: say("LEAD", "หายแล้วได้คืน ได้เพื่อนเพิ่มอีกคน คุ้มนะ"),
      roles: { LEAD: { trait: "ตื่นตูม รักเพื่อน", want: "อยากให้วันสำคัญผ่านไปด้วยดี", secret: "เป็นคนลืมง่ายที่สุดในซอย" },
        ALLY: { trait: "ขี้ลืม เล่นใหญ่", want: "อยากดังในโซเชียล", secret: "เอา{OBJ}ไปถ่ายคลิปแล้วลืม" },
        RIVAL: { trait: "หน้าดุ ใจดี", want: "อยากเข้ากับคนในซอย", secret: "เหงามาก" } } },
  ],
  hooks: [say("LEAD", "เดี๋ยวนะ... เมื่อกี้เกิดอะไรขึ้น"), say("ALLY", "ใจเย็นๆ ผมจัดการเอง"), say("LEAD", "ไม่ยอม! วันนี้ต้องชนะ"),
    say("ALLY", "แผนนี้ไม่พลาดแน่นอน... มั้ง"), say("LEAD", "ทำไมเรื่องมันเยอะขนาดนี้")],
  moves: [
    m("spy", "แอบส่อง", "{LEAD}กับ{ALLY}แอบส่องร้านคู่แข่ง", "{LEAD} and {ALLY} crouch behind a parked motorbike peeking at the rival shop, both wearing ridiculous sunglasses", 1, { at: "D", say: say("ALLY", "คนแน่นมาก... เขาแจกอะไรฟรีเหรอ") }),
    m("fail", "แผนพัง", "แผนของ{ALLY}พังไม่เป็นท่า", "{ALLY} proudly starts a demonstration and it goes wrong at once: something spills everywhere; {LEAD} slowly covers her face", 2, { say: say("LEAD", "ฉันบอกแล้วไง!") }),
    m("taunt", "เยาะเย้ย", "{RIVAL}เดินมาเยาะเย้ยถึงหน้าร้าน", "{RIVAL} strolls up with exaggerated swagger, looks around and lowers big sunglasses with one finger", 1, { at: "D", say: say("RIVAL", "ร้านเล็กดีนะ ปิดเมื่อไหร่บอกด้วย") }),
    m("practice", "ซ้อม", "{LEAD}ซ้อมหนักทั้งคืน", "{LEAD} practises again and again under a bare bulb, sweating, while {ALLY} falls asleep sitting up on a stool", 1, { at: "E", say: say("LEAD", "อีกรอบ... อีกรอบเดียว") }),
    m("viral", "คลิปดัง", "คลิปของ{ALLY}ดังข้ามคืน", "{ALLY} shows {LEAD} his phone, the view counter climbing fast; both stare, then scream with joy", 2, { say: say("ALLY", "ล้านวิว! เราดังแล้ว!") }),
    m("disguise", "ปลอมตัว", "{ALLY}ปลอมตัวไปสืบที่ร้านคู่แข่ง", "{ALLY} walks into the rival shop in an obvious fake moustache and wig, trying to act casual", 2, { at: "B", say: say("ALLY", "สวัสดีครับ... ผมเป็นลูกค้าธรรมดา") }),
    m("crowd", "ลูกค้าแน่น", "ลูกค้าแห่มาที่ร้าน{LEAD}จนวุ่น", "a sudden rush of customers crowds the little shop; {LEAD} and {ALLY} rush around bumping into each other", 2, { at: "A", say: say("LEAD", "รอสักครู่นะคะ! ทุกคนได้แน่นอน!") }),
    m("argue", "ทะเลาะ", "{LEAD}กับ{ALLY}ทะเลาะกันเรื่องเล็กๆ", "{LEAD} and {ALLY} argue nose to nose over something tiny, then both stop and burst out laughing", 1, { say: say("ALLY", "เราทะเลาะเรื่องอะไรกันนะ") }),
    m("sabotage", "โดนแกล้ง", "ของในร้าน{LEAD}ถูกแกล้งจนพัง", "{LEAD} opens a container and gasps: everything inside has been swapped; she spins toward the rival shop across the street", 3, { say: say("LEAD", "ใครทำ!") }),
    m("secret", "แอบเห็น", "{LEAD}แอบเห็น{RIVAL}ทำบางอย่างที่ไม่คาดคิด", "{LEAD} peeks around a corner and sees {RIVAL} quietly feeding a stray cat and smiling softly", 1, { say: say("LEAD", "เขา... ยิ้มเป็นด้วยเหรอ") }),
  ],
  cliffs: [
    m("c-gone", "หายไป", "{OBJ}หายไปจากที่เดิม", "{LEAD} turns to the shelf and freezes: the place where {OBJ} always sits is empty", 2, { say: say("LEAD", "ไม่จริงน่า!") }),
    m("c-face", "หน้าต่อหน้า", "{RIVAL}โผล่มายืนหน้าร้านพร้อมคนถือกล้อง", "{RIVAL} suddenly appears at the shop front with a camera crew behind, smiling widely", 2, { say: say("RIVAL", "พรุ่งนี้เจอกันบนเวที") }),
    m("c-fall", "ล้มทั้งยืน", "{ALLY}ลื่นล้มกลางร้าน ของกระจายเต็มพื้น", "{ALLY} slips and crashes to the floor in slow motion, everything flying; freeze on {LEAD}'s horrified face", 2),
    m("c-letter", "จดหมาย", "{LEAD}ได้รับจดหมายแจ้งให้ย้ายออก", "{LEAD} opens an official letter, reads it, and her jaw drops; {ALLY} leans over to read", 2, { say: say("ALLY", "ย้ายออกภายในเจ็ดวัน?!") }),
    m("c-kiss", "เกือบจูบ", "{LEAD}กับ{ALLY}หน้าใกล้กันโดยบังเอิญ แล้วมีคนเปิดประตูเข้ามา", "{LEAD} and {ALLY} bump together and end up face to face, very close; both freeze as the door swings open", 1) ,
  ],
  beats: {
    OPENING: { title: "ร้านเล็กหัวใจใหญ่", at: "A", shots: [
      m("o1", "เช้าวุ่น", "{LEAD}กับ{ALLY}เปิดร้านแบบวุ่นๆ {RIVAL}ยืนมองจากฝั่งตรงข้าม", "{LEAD} opens the little shop in a rush while {ALLY} drops things; across the street {RIVAL} stands watching with arms crossed; all three faces clearly visible", 1, { say: say("LEAD", "เร็วๆ ลูกค้ามาแล้ว!") }),
      m("o2", "ท้าทาย", "{RIVAL}เดินมาท้าทาย", "{RIVAL} walks over, taps the counter with a jewelled finger and smiles", 1, { say: say("RIVAL", "เดือนหน้า ร้านนี้จะเป็นของฉัน") }),
      m("o3", "ไม่ยอม", "{LEAD}ประกาศไม่ยอมแพ้", "{LEAD} slams her palm on the counter, chin up, while {ALLY} nods hard behind her", 1, { say: say("LEAD", "ฝันไปเถอะ!") }),
    ], cliff: m("o-c", "ป้ายใหม่", "ป้ายยักษ์ของร้าน{RIVAL}ถูกยกขึ้นบังร้าน{LEAD}มิด", "a giant new sign is lifted into place across the street and its shadow swallows {LEAD}'s whole shop; she stares up in disbelief", 2) },
    INCITING: { title: "ทางรอดเดียว", at: "A", shots: [
      m("i1", "ประกาศ", "{ALLY}วิ่งมาพร้อมใบประกาศงานประกวด", "{ALLY} bursts in waving a flyer, out of breath", 1, { say: say("ALLY", "ประกวด! ชนะได้เงินแสน!") }),
      m("i2", "ลังเล", "{LEAD}มอง{OBJ}แล้วลังเล", "{LEAD} picks up {OBJ} and looks at it for a long moment, unsure", 1, { say: say("LEAD", "ถ้าแพ้... เราไม่เหลืออะไรเลยนะ") }),
      m("i3", "ตกลง", "ทั้งสองจับมือตกลงสู้", "{LEAD} and {ALLY} do a silly secret handshake, then a serious fist bump", 1, { say: say("ALLY", "ไม่แพ้หรอก เรามีกันสองคน") }),
    ], cliff: m("i-c", "คู่แข่ง", "รายชื่อผู้แข่งขันขึ้นจอ ชื่อแรกคือ{RIVAL}", "{LEAD} reads the contest list on {ALLY}'s phone; the first name is {RIVAL}; she slowly looks up", 2, { say: say("LEAD", "อีกแล้วเหรอ!") }) },
    MIDPOINT: { title: "อีกด้านของคู่แข่ง", at: "B", shots: [
      m("mp1", "บุกร้าน", "{LEAD}บุกไปถาม{RIVAL}ถึงร้าน", "{LEAD} marches into the flashy rival shop and plants herself in front of {RIVAL}", 2, { say: say("LEAD", "ทำไมต้องเป็นร้านฉัน!") }),
      m("mp2", "เผยใจ", "{RIVAL}เผลอเล่าความจริงครึ่งหนึ่ง", "{RIVAL} takes off the sunglasses, the swagger gone, and looks away", 1, { say: "REVEAL1" }),
      m("mp3", "งง", "{ALLY}กับ{LEAD}มองหน้ากันงงๆ", "{ALLY} and {LEAD} exchange a stunned look, mouths open", 1, { say: say("ALLY", "เรื่องมันไม่ใช่อย่างที่คิดแล้วนะ") }),
    ], cliff: m("mp-c", "ถ่ายไว้", "มีคนแอบถ่ายคลิปทั้งหมดไว้", "behind a pillar someone films the whole scene on a phone; the screen shows it uploading", 2) },
    CRISIS: { title: "วันที่แย่ที่สุด", at: "A", shots: [
      m("cr1", "ร้านเงียบ", "ร้าน{LEAD}เงียบไม่มีลูกค้าเลย", "the little shop sits empty; {LEAD} wipes the same clean table over and over", 2),
      m("cr2", "ทะเลาะจริง", "{LEAD}กับ{ALLY}ทะเลาะกันจริงจังครั้งแรก", "{LEAD} and {ALLY} argue for real this time, voices raised, both hurt", 3, { say: say("ALLY", "ถ้าไม่เชื่อใจกัน ก็ทำคนเดียวเลย!") }),
      m("cr3", "เดินออกไป", "{ALLY}เดินออกจากร้าน", "{ALLY} pulls off his apron, drops it on the counter and walks out without looking back", 3),
    ], cliff: m("cr-c", "นั่งคนเดียว", "{LEAD}นั่งคนเดียวกับ{OBJ} น้ำตาไหล", "{LEAD} sits alone holding {OBJ} under the bare bulb, a tear running down; slow push-in", 2, { say: say("LEAD", "ขอโทษนะ...") }) },
    CLIMAX: { title: "วันประกวด", at: "C", shots: [
      m("cl1", "บนเวที", "{LEAD}ขึ้นเวทีคนเดียว", "{LEAD} steps onto the contest stage alone and nervous; {RIVAL} at the other station smirks", 2),
      m("cl2", "กลับมา", "{ALLY}วิ่งฝ่าคนดูขึ้นเวทีมาช่วย", "{ALLY} pushes through the crowd and jumps onto the stage beside {LEAD}, grinning", 2, { say: say("ALLY", "ขอโทษที่มาสาย!") }),
      m("cl3", "เปิดใจ", "{RIVAL}พูดความจริงทั้งหมดบนเวที", "{RIVAL} stops working, takes the microphone and speaks to the whole crowd", 2, { say: "REVEAL2" }),
    ], cliff: m("cl-c", "ผลตัดสิน", "กรรมการกำลังจะประกาศผล", "the judges stand up holding a gold envelope; {LEAD}, {ALLY} and {RIVAL} hold their breath", 2) },
    FINALE: { title: "ร้านของทุกคน", at: "A", shots: [
      m("f1", "ชนะ", "{LEAD}กับ{ALLY}กอดกันดีใจ", "{LEAD} and {ALLY} jump and hug as gold confetti rains down", 1, { say: say("ALLY", "เราทำได้!") }),
      m("f2", "ชวน", "{LEAD}เดินไปยื่นมือให้{RIVAL}", "{LEAD} walks over and holds out her hand to {RIVAL}, who hesitates, then shakes it", 1, { say: "FINAL" }),
      m("f3", "ร้านเต็ม", "ร้านเล็กๆ คนแน่นอีกครั้ง ทั้งสามช่วยกันขาย", "wide shot: the little shop packed with laughing customers; {LEAD}, {ALLY} and {RIVAL} work side by side behind the counter", 1, { say: say("LEAD", "ยินดีต้อนรับค่ะ!") }),
    ] },
  },
};

const ROMANCE: MixGenre = {
  style: "Photorealistic Thai romantic drama, soft cinematic look, warm golden light, shallow depth of field, gentle camera moves, clean modern colour grade",
  sound: "soft room tone, city murmur, light rain or breeze, gentle footsteps; no music score",
  hashtags: ["#ละครสั้น", "#โรแมนติก", "#ละครรัก", "#ละครไทย"],
  roles: {
    LEAD: { gender: "F", band: "YOUNG", outfits: ["a bright red tailored blazer over a black camisole and a black pencil skirt", "a cream silk blouse tucked into high-waisted navy trousers", "a soft pink knit sweater, a white midi skirt and a small gold necklace"] },
    ALLY: { gender: "M", band: "YOUNG", outfits: ["a navy suit over a white open-collar shirt", "a light blue oxford shirt with rolled sleeves and grey trousers", "a black turtleneck under a camel coat"] },
    RIVAL: { gender: "F", band: "YOUNG", outfits: ["a white fitted designer dress and pearl earrings", "a black satin blouse, a slim grey skirt and red-soled heels", "an emerald green wrap dress and a gold watch"] },
  },
  packs: [
    { places: [
      place("A", "ออฟฟิศชั้นสูง", "a bright modern office on a high floor of a Bangkok tower, floor-to-ceiling windows over the city skyline, white desks, black leather chairs and a glass meeting room"),
      place("B", "มุมกาแฟในออฟฟิศ", "the office coffee corner with a chrome espresso machine, wooden cabinets, potted plants and big windows over the city"),
      place("C", "ดาดฟ้าตึก", "the rooftop garden of the office tower at sunset, wooden benches, string lights and the city glowing below"),
      place("D", "ลิฟต์และโถงทางเดิน", "the polished marble lift lobby of the office tower, brushed steel lift doors, a long corridor and soft ceiling lights"),
      place("E", "ห้องผู้บริหาร", "a private executive office with a big walnut desk, a leather sofa, bookshelves and a wall of glass over the city"),
    ] },
    { places: [
      place("A", "คาเฟ่ริมน้ำ", "a cosy riverside cafe in Bangkok with wooden tables, warm pendant lamps, shelves of books and big windows over the Chao Phraya"),
      place("B", "ทางเดินริมแม่น้ำ", "a riverside promenade at golden hour, a railing, benches, boats passing and a lit bridge in the distance"),
      place("C", "ร้านดอกไม้", "a small flower shop full of buckets of roses and jasmine, hanging plants and a wooden work table"),
      place("D", "ซอยหน้าคอนโด", "the quiet soi in front of an apartment block at night, a 7-Eleven glow, parked motorbikes and a tree with fairy lights"),
      place("E", "ห้องคอนโด", "a small tidy condo room with a sofa, a balcony door, warm lamp light and the city lights outside"),
    ] },
    { places: [
      place("A", "โรงแรมริมทะเล", "the open-air lobby of a seaside hotel in Hua Hin, white columns, ceiling fans, rattan chairs and the sea beyond"),
      place("B", "ชายหาดยามเย็น", "a wide sandy beach at sunset, gentle waves, wooden fishing boats and a pink-orange sky"),
      place("C", "ท่าเรือไม้", "a long wooden pier stretching into the sea at dusk, lanterns on posts and fishing nets drying"),
      place("D", "ทางเดินในโรงแรม", "a hotel corridor with teak floors, louvred doors, potted palms and sea breeze moving the curtains"),
      place("E", "ห้องพักวิวทะเล", "a hotel room with white linen bed, a balcony door open to the sea and soft evening light"),
    ] },
  ],
  objects: [
    { name: "แหวนเงินวงเล็ก", short: "แหวน", look: "a small thin silver ring with a tiny engraved star" },
    { name: "จดหมายที่ไม่ได้ส่ง", short: "จดหมาย", look: "a pale blue envelope, sealed, with handwriting on the front" },
    { name: "แก้วกาแฟเขียนชื่อ", short: "แก้วกาแฟ", look: "a white paper coffee cup with a name and a small heart written in black marker" },
    { name: "สร้อยคอรูปหัวใจ", short: "สร้อยหัวใจ", look: "a delicate gold necklace with a small heart locket" },
    { name: "ร่มสีเหลือง", short: "ร่มเหลือง", look: "a bright yellow folding umbrella with a wooden handle" },
  ],
  plots: [
    { title: "หัวใจไม่ตรงตำแหน่ง", logline: "{LEAD}พนักงานไฟแรงต้องทำงานใกล้ชิดกับ{ALLY}ผู้บริหารคนใหม่ที่เคยเป็นรักแรก ขณะที่{RIVAL}คู่หมั้นของเขาจับตาทุกการเคลื่อนไหว",
      truth: "การหมั้นของ{ALLY}กับ{RIVAL}เป็นแค่สัญญาธุรกิจ และ{ALLY}เก็บ{OBJ}ของ{LEAD}ไว้ตลอดสิบปี", ending: "{RIVAL}ยอมถอนหมั้นอย่างสง่างาม {ALLY}คืน{OBJ}และสารภาพรักกับ{LEAD}บนดาดฟ้า",
      reveal1: say("RIVAL", "เราหมั้นกันเพราะธุรกิจ ไม่ได้รักกันหรอก"), reveal2: say("RIVAL", "เขาเก็บของของเธอไว้ในกระเป๋าตลอดสิบปี"), finalLine: say("ALLY", "สิบปีแล้ว... ผมยังรอคำตอบอยู่นะ"),
      roles: { LEAD: { trait: "เก่ง ปากแข็ง", want: "อยากได้เลื่อนตำแหน่ง", secret: "ยังไม่ลืม{ALLY}" },
        ALLY: { trait: "นิ่ง อบอุ่น", want: "อยากแก้ไขเรื่องเมื่อสิบปีก่อน", secret: "ทิ้ง{LEAD}ไปเพราะครอบครัวบังคับ" },
        RIVAL: { trait: "สวย มั่นใจ", want: "อยากรักษาหน้าของครอบครัว", secret: "มีคนที่รักอยู่แล้ว" } } },
    { title: "{OBJT}ของคนแปลกหน้า", logline: "{LEAD}เก็บ{OBJ}ของ{ALLY}ได้ แล้วชีวิตทั้งสองก็พันกันวุ่น ขณะที่{RIVAL}พยายามดึงเขากลับไป",
      truth: "{RIVAL}คือคนที่ทำให้{ALLY}กับ{LEAD}พลาดกันครั้งแรกเมื่อหลายปีก่อน", ending: "{RIVAL}ยอมรับผิดและขอโทษ {LEAD}กับ{ALLY}เริ่มต้นใหม่ด้วยกัน",
      reveal1: say("RIVAL", "วันนั้นเขามาหาเธอ แต่ฉันบอกว่าเธอไปแล้ว"), reveal2: say("RIVAL", "ฉันโกหกเพราะกลัวเสียเขาไป"), finalLine: say("LEAD", "ครั้งนี้... ไม่มีใครพรากเราได้แล้วนะ"),
      roles: { LEAD: { trait: "ใจดี ขี้เกรงใจ", want: "อยากรู้ว่าเจ้าของ{OBJ}เป็นใคร", secret: "เคยรอใครบางคนที่ไม่มา" },
        ALLY: { trait: "เงียบ ขี้อาย", want: "อยากได้{OBJ}คืน", secret: "คือคนที่{LEAD}เคยรอ" },
        RIVAL: { trait: "เพอร์เฟกต์ ขี้หึง", want: "อยากได้{ALLY}กลับมา", secret: "เคยโกหกครั้งใหญ่" } } },
    { title: "สัญญารักหนึ่งเดือน", logline: "{LEAD}ตกลงเป็นแฟนปลอมของ{ALLY}หนึ่งเดือนเพื่อให้{RIVAL}เลิกตาม แต่{OBJ}ที่เขาให้มาทำให้ทุกอย่างเริ่มจริง",
      truth: "{ALLY}รู้จัก{LEAD}มาก่อน และขอให้เป็นแฟนปลอมเพราะอยากใกล้ชิดเธอจริงๆ", ending: "เมื่อครบเดือน {ALLY}ฉีกสัญญาทิ้งและขอ{LEAD}เป็นแฟนจริง {RIVAL}ยิ้มให้อย่างยอมรับ",
      reveal1: say("RIVAL", "เขาไม่เคยมองฉันแบบที่มองเธอเลย"), reveal2: say("RIVAL", "เธอคิดว่าเขาเลือกเธอโดยบังเอิญเหรอ"), finalLine: say("ALLY", "สัญญาจบแล้ว แต่ผมไม่อยากให้เราจบ"),
      roles: { LEAD: { trait: "ตรงไปตรงมา", want: "อยากได้เงินช่วยครอบครัว", secret: "เริ่มหวั่นไหวตั้งแต่วันแรก" },
        ALLY: { trait: "เจ้าเล่ห์ อ่อนโยน", want: "อยากให้{LEAD}รักจริง", secret: "แอบชอบ{LEAD}มานาน" },
        RIVAL: { trait: "หยิ่ง จริงใจ", want: "อยากให้{ALLY}หันมามอง", secret: "รู้ความจริงตั้งแต่แรก" } } },
  ],
  hooks: [say("LEAD", "เมื่อกี้... คุณหมายความว่ายังไง"), say("ALLY", "อย่าเพิ่งไปนะ ฟังผมก่อน"), say("LEAD", "ฉันไม่ได้คิดอะไรหรอก"),
    say("ALLY", "ผมพูดจริงทุกคำ"), say("LEAD", "เราต้องคุยกันให้รู้เรื่อง")],
  moves: [
    m("coffee", "กาแฟแก้วเดียว", "{LEAD}กับ{ALLY}เอื้อมมือจับกาแฟแก้วเดียวกัน", "{LEAD} and {ALLY} reach for the same cup of coffee at the same moment; their fingers touch and both pull back, embarrassed", 1, { at: "B", say: say("ALLY", "ของคุณครับ... เชิญก่อน") }),
    m("glance", "แอบมอง", "{ALLY}แอบมอง{LEAD}ระหว่างประชุม", "across the meeting table {ALLY} keeps glancing at {LEAD}; she catches him and he quickly looks at his papers", 1, { at: "A", say: say("LEAD", "มีอะไรติดหน้าฉันเหรอคะ") }),
    m("jealous", "หึง", "{RIVAL}เดินมาควงแขน{ALLY}ต่อหน้า{LEAD}", "{RIVAL} walks up and slides an arm through {ALLY}'s, smiling sweetly at {LEAD}", 2, { say: say("RIVAL", "ขอยืมตัวแฟนคืนนะคะ") }),
    m("rain", "ฝนตก", "ฝนตกหนัก {ALLY}กางร่มให้{LEAD}", "heavy rain begins; {ALLY} opens an umbrella and holds it over {LEAD}, his own shoulder getting soaked", 2, { say: say("ALLY", "ผมไม่เป็นไร คุณอย่าเปียกก็พอ") }),
    m("memory", "ความทรงจำ", "{LEAD}เห็น{OBJ}แล้วนึกถึงอดีต", "{LEAD} finds {OBJ}, holds it gently and her eyes fill with memories; a soft smile, then sadness", 1, { say: say("LEAD", "ยังเก็บไว้อีกเหรอ...") }),
    m("work-late", "ทำงานดึก", "ทั้งสองทำงานดึกด้วยกันจนเผลอหลับ", "late at night {LEAD} has dozed off on her desk; {ALLY} quietly drapes his jacket over her shoulders", 1, { at: "A", say: say("ALLY", "ขยันเกินไปแล้วนะ") }),
    m("argue", "ปะทะคารม", "{LEAD}กับ{ALLY}เถียงกันเรื่องงาน", "{LEAD} and {ALLY} argue face to face over a document, both stubborn, standing too close", 2, { say: say("LEAD", "คุณไม่เคยฟังใครเลยใช่ไหม") }),
    m("warn", "คำเตือน", "{RIVAL}เตือน{LEAD}ให้อยู่ห่าง{ALLY}", "{RIVAL} corners {LEAD} with a calm cold smile and speaks quietly", 2, { say: say("RIVAL", "อย่าคิดเกินหน้าที่นะคะ") }),
    m("save", "ช่วยไว้", "{LEAD}สะดุด {ALLY}คว้าตัวไว้ทัน", "{LEAD} trips on the stairs and {ALLY} catches her by the waist; they freeze, faces close", 2, { say: say("ALLY", "ระวังหน่อยสิ") }),
    m("walk", "เดินกลับด้วยกัน", "ทั้งสองเดินกลับด้วยกันเงียบๆ", "{LEAD} and {ALLY} walk side by side under the evening lights, neither speaking, their hands almost touching", 1, { say: say("LEAD", "ขอบคุณสำหรับวันนี้นะ") }),
    m("tears", "น้ำตา", "{LEAD}ร้องไห้คนเดียว {ALLY}มาเห็นพอดี", "{LEAD} wipes tears alone by the window; {ALLY} stops in the doorway, then quietly sits beside her", 2, { say: say("ALLY", "ร้องได้นะ ผมอยู่ตรงนี้") }),
  ],
  cliffs: [
    m("c-ring", "แหวนหมั้น", "{RIVAL}ยกมือโชว์แหวนหมั้นต่อหน้าทุกคน", "{RIVAL} raises her hand to show a sparkling engagement ring; {LEAD} freezes, the coffee cup in her hand trembling", 2, { say: say("RIVAL", "เราจะแต่งงานกันเดือนหน้าค่ะ") }),
    m("c-almost", "เกือบจูบ", "{ALLY}เอนหน้าเข้าหา{LEAD} แล้วมือถือก็ดัง", "{ALLY} slowly leans toward {LEAD}; she closes her eyes; then his phone rings loudly between them", 1),
    m("c-saw", "เห็นภาพบาดใจ", "{LEAD}เห็น{ALLY}กอด{RIVAL}", "{LEAD} turns the corner and stops dead: {ALLY} and {RIVAL} are in an embrace; slow push-in on {LEAD}'s face", 2),
    m("c-confess", "คำสารภาพค้าง", "{ALLY}กำลังจะสารภาพ แต่{LEAD}เดินจากไปก่อน", "{ALLY} opens his mouth to say something important as {LEAD} turns and walks away; he stands alone", 2, { say: say("ALLY", "เดี๋ยวก่อน ผม...") }),
    m("c-photo", "รูปหลุด", "รูปของ{LEAD}กับ{ALLY}ถูกส่งต่อทั่วออฟฟิศ", "{LEAD}'s phone lights up again and again; on the screen a photo of her and {ALLY} close together; she looks up, pale", 2, { say: say("LEAD", "ใครถ่ายรูปนี้") }),
  ],
  beats: {
    OPENING: { title: "เจอกันอีกครั้ง", at: "A", shots: [
      m("o1", "เจอกัน", "{ALLY}เดินเข้ามาแนะนำตัว {LEAD}ตกใจ {RIVAL}ยืนข้างเขา", "{ALLY} walks into the room and the whole room turns; {LEAD} looks up and freezes; {RIVAL} stands at his side smiling; all three faces clearly visible", 1, { say: say("ALLY", "สวัสดีครับ ยินดีที่ได้ร่วมงานกันอีกครั้ง") }),
      m("o2", "จำได้", "{LEAD}พยายามทำเป็นจำไม่ได้", "{LEAD} grips her pen and forces a polite smile as {ALLY} stops in front of her desk", 1, { say: say("LEAD", "เราเคยเจอกันด้วยเหรอคะ") }),
      m("o3", "จับตา", "{RIVAL}มอง{LEAD}อย่างจับผิด", "{RIVAL} looks {LEAD} up and down slowly, then turns to {ALLY} with a sweet smile", 1, { say: say("RIVAL", "ที่รัก คนนี้ใครเหรอคะ") }),
    ], cliff: m("o-c", "ของที่ทำหล่น", "{ALLY}ทำ{OBJ}หล่นตรงหน้า{LEAD}", "as {ALLY} walks away, {OBJ} slips from his pocket and lands at {LEAD}'s feet; she stares at it, stunned", 2) },
    INCITING: { title: "ร่วมงานกัน", at: "A", shots: [
      m("i1", "มอบหมายงาน", "{LEAD}ถูกจับคู่ทำโปรเจกต์กับ{ALLY}", "{LEAD} reads a new assignment on her screen and slowly turns to look at {ALLY}'s glass office", 1, { say: say("LEAD", "ทำไมต้องเป็นฉันด้วย") }),
      m("i2", "คุยงาน", "ทั้งสองคุยงานกันอย่างตึงเครียด", "{LEAD} and {ALLY} sit across a desk going over papers, polite and stiff, avoiding each other's eyes", 1, { say: say("ALLY", "คุณยังดื่มกาแฟไม่ใส่น้ำตาลเหมือนเดิมไหม") }),
      m("i3", "จำได้", "{LEAD}ชะงักที่{ALLY}ยังจำได้", "{LEAD} stops writing and looks up at {ALLY}, caught off guard", 1, { say: say("LEAD", "คุณยังจำได้อีกเหรอ") }),
    ], cliff: m("i-c", "มองผ่านกระจก", "{RIVAL}ยืนมองทั้งสองผ่านกระจก", "through the glass wall {RIVAL} stands watching them, her smile gone, then she takes out her phone", 2) },
    MIDPOINT: { title: "ความจริงที่เพิ่งรู้", at: "C", shots: [
      m("mp1", "นัดคุย", "{RIVAL}นัด{LEAD}ขึ้นมาคุยบนดาดฟ้า", "{RIVAL} waits on the rooftop as {LEAD} arrives, the sunset behind them", 2, { say: say("LEAD", "มีอะไรจะคุยกับฉันคะ") }),
      m("mp2", "เปิดใจ", "{RIVAL}เล่าความจริงครึ่งหนึ่ง", "{RIVAL} looks out over the city, then turns back to {LEAD}, her voice soft", 1, { say: "REVEAL1" }),
      m("mp3", "สับสน", "{LEAD}ยืนนิ่ง สับสนกับสิ่งที่ได้ยิน", "{LEAD} stands still, the wind in her hair, trying to understand", 1, { say: say("LEAD", "แล้วทำไมถึงบอกฉัน") }),
    ], cliff: m("mp-c", "เขามาพอดี", "{ALLY}เปิดประตูดาดฟ้าออกมาพอดี", "the rooftop door swings open and {ALLY} steps out, stopping when he sees them together", 2, { say: say("ALLY", "คุยอะไรกันอยู่") }) },
    CRISIS: { title: "ใจที่แตกสลาย", at: "D", shots: [
      m("cr1", "ข่าวลือ", "ทุกคนในตึกซุบซิบเรื่อง{LEAD}", "{LEAD} walks down the corridor as people whisper and stare; she keeps her chin up, eyes wet", 2),
      m("cr2", "ทะเลาะ", "{LEAD}กับ{ALLY}ทะเลาะกันหน้าลิฟต์", "{LEAD} and {ALLY} face each other at the lift doors, both hurt", 3, { say: say("LEAD", "พอเถอะ อย่าทำให้ฉันหวังอีกเลย") }),
      m("cr3", "ลาออก", "{LEAD}ยื่นใบลาออก", "{LEAD} places an envelope on the desk in front of {ALLY} and turns away", 3, { say: say("LEAD", "ขอบคุณที่ผ่านมานะคะ") }),
    ], cliff: m("cr-c", "ประตูลิฟต์ปิด", "ประตูลิฟต์ปิดลงระหว่างทั้งสอง", "{LEAD} steps into the lift; {ALLY} runs toward it but the doors slide shut between their faces", 3, { say: say("ALLY", "อย่าไป!") }) },
    CLIMAX: { title: "คำตอบ", at: "C", shots: [
      m("cl1", "ตามหา", "{ALLY}ตามหา{LEAD}จนเจอบนดาดฟ้า", "{ALLY} bursts out onto the rooftop, breathless, and finds {LEAD} by the railing at sunset", 2, { say: say("ALLY", "ผมมีเรื่องที่ต้องบอกคุณ") }),
      m("cl2", "ความจริง", "{RIVAL}ตามมาและบอกความจริงทั้งหมด", "{RIVAL} steps out behind them, takes off her engagement ring and speaks", 2, { say: "REVEAL2" }),
      m("cl3", "น้ำตา", "{LEAD}หันมามอง{ALLY}ทั้งน้ำตา", "{LEAD} turns slowly to {ALLY}, tears on her cheeks, waiting", 2, { say: say("LEAD", "จริงเหรอ...") }),
    ], cliff: m("cl-c", "ยื่นของ", "{ALLY}ยื่น{OBJ}ให้{LEAD}", "{ALLY} holds out {OBJ} in his open palm between them; slow push-in on {LEAD}'s face", 2) },
    FINALE: { title: "เริ่มต้นใหม่", at: "C", shots: [
      m("f1", "สารภาพ", "{ALLY}สารภาพรัก", "under the string lights {ALLY} takes {LEAD}'s hands in his", 1, { say: "FINAL" }),
      m("f2", "ตอบรับ", "{LEAD}ยิ้มทั้งน้ำตาและพยักหน้า", "{LEAD} laughs through her tears, nods, and steps into {ALLY}'s arms", 1, { say: say("LEAD", "ฉันก็รอมาตลอดเหมือนกัน") }),
      m("f3", "อวยพร", "{RIVAL}ยิ้มและเดินจากไปอย่างสง่างาม", "wide shot at dusk: {LEAD} and {ALLY} embrace by the railing as {RIVAL} watches with a small smile and walks away", 1, { say: say("RIVAL", "ดูแลกันดีๆ นะ") }),
    ] },
  },
};

const MYSTERY: MixGenre = {
  style: "Photorealistic Thai mystery thriller, moody cinematic look, cool blue night tones with amber practical lights, rain-wet surfaces, controlled slow camera",
  sound: "rain, distant traffic, ticking clock, low hum; no music score",
  hashtags: ["#ละครสั้น", "#สืบสวน", "#ปริศนา", "#ละครไทย"],
  roles: {
    LEAD: { gender: "F", band: "YOUNG", outfits: ["a beige trench coat over a black turtleneck and dark trousers", "a grey blazer over a white T-shirt, jeans and ankle boots", "a navy raincoat over a striped shirt and black jeans"] },
    ALLY: { gender: "M", band: "YOUNG", outfits: ["a police-issue light brown uniform shirt and dark trousers", "a black hoodie under a denim jacket and a camera on a strap", "a white shirt with loosened tie and a lanyard ID card"] },
    RIVAL: { gender: "M", band: "MID", outfits: ["an immaculate dark grey three-piece suit", "a white doctor's coat over a blue shirt", "a beige safari suit with a gold pen in the pocket"] },
  },
  packs: [
    { places: [
      place("A", "ล็อบบี้โรงแรมเก่า", "the faded grand lobby of an old Bangkok hotel at night, a marble floor, brass lamps, a wooden reception desk and a slow ceiling fan"),
      place("B", "ลานจอดรถหลังโรงแรม", "the rain-soaked car park behind the hotel at night, a flickering lamp, puddles, a dumpster and a locked service door"),
      place("C", "ห้องเก็บเอกสาร", "a cramped records room in the hotel basement, metal shelves of dusty files, a single green desk lamp"),
      place("D", "ทางเดินชั้นเจ็ด", "a long hotel corridor with patterned carpet, numbered doors, wall sconces and one light flickering"),
      place("E", "ห้องพักหมายเลข 7", "a hotel room taped off with police tape, an unmade bed, an open suitcase, a broken lamp and rain on the window"),
    ] },
    { places: [
      place("A", "สถานีตำรวจเก่า", "a small old police station office at night, wooden desks, stacks of case files, a whiteboard with photos and string, a buzzing tube light"),
      place("B", "ท่าเรือข้ามฟาก", "an old ferry pier at night, a tin roof with bare bulbs, worn steps down to dark water and rain falling"),
      place("C", "บ้านไม้ของผู้ตาย", "the dusty wooden house of the victim, covered furniture, family photos, a ticking wall clock and moonlight through shutters"),
      place("D", "ซอยแคบริมคลอง", "a narrow wet alley beside a canal at night, hanging wires, closed shutters and a single street lamp"),
      place("E", "ห้องสอบสวน", "a bare interrogation room with a metal table, two chairs, a one-way mirror and harsh overhead light"),
    ] },
    { places: [
      place("A", "ห้องโถงคฤหาสน์", "the grand hall of an old Thai-colonial mansion, a sweeping staircase, oil portraits, a chandelier and polished teak floors"),
      place("B", "สวนหลังคฤหาสน์", "the overgrown garden behind the mansion at night, a stone fountain, frangipani trees and wet paths under moonlight"),
      place("C", "ห้องลับใต้บันได", "a hidden room under the staircase, old trunks, a desk with letters, cobwebs and one candle"),
      place("D", "ระเบียงชั้นสอง", "the long upstairs gallery of the mansion, tall shuttered windows, portraits and moonlight striping the floor"),
      place("E", "ห้องทำงานเจ้าของบ้าน", "the mansion owner's study, a big desk, bookshelves, a safe behind a painting and a green banker's lamp"),
    ] },
  ],
  objects: [
    { name: "นาฬิกาพกที่หยุดเดิน", short: "นาฬิกาหยุดเดิน", look: "an old silver pocket watch stopped at 3:07" },
    { name: "กุญแจห้องที่ไม่มีอยู่จริง", short: "กุญแจปริศนา", look: "an old iron key with a paper tag reading a room number" },
    { name: "เทปบันทึกเสียง", short: "เทปลับ", look: "a small black cassette tape labelled in red ink" },
    { name: "จดหมายไม่ลงชื่อ", short: "จดหมายนิรนาม", look: "a folded yellowed letter with no name, typed on an old typewriter" },
    { name: "สมุดบัญชีปกดำ", short: "สมุดปกดำ", look: "a thick black leather ledger with a broken clasp" },
  ],
  plots: [
    { title: "ปริศนา{OBJT}", logline: "{LEAD}นักข่าวสาวสืบคดีคนหายที่ทุกคนบอกว่าเป็นอุบัติเหตุ เบาะแสเดียวคือ{OBJ} และทุกทางชี้ไปที่{RIVAL}",
      truth: "{RIVAL}ไม่ใช่คนร้าย แต่ปกป้องคนร้ายตัวจริงซึ่งเป็นลูกชายของตัวเอง", ending: "{LEAD}เปิดโปงความจริงได้ คนหายถูกพบว่ายังมีชีวิต และ{RIVAL}ยอมมอบตัว",
      reveal1: say("RIVAL", "ผมไม่ได้ทำ... แต่ผมรู้ว่าใครทำ"), reveal2: say("RIVAL", "คนที่ผมปกป้องมาตลอดคือลูกของผมเอง"), finalLine: say("LEAD", "ความจริงอาจเจ็บ แต่มันจะไม่ถูกฝังอีกแล้ว"),
      roles: { LEAD: { trait: "ดื้อ ช่างสังเกต", want: "อยากรู้ความจริง", secret: "พี่ชายเคยหายไปแบบเดียวกัน" },
        ALLY: { trait: "ระวังตัว ซื่อสัตย์", want: "อยากปกป้อง{LEAD}", secret: "หัวหน้าสั่งให้ปิดคดี" },
        RIVAL: { trait: "สุภาพ เยือกเย็น", want: "อยากให้คดีปิดไปเงียบๆ", secret: "ปกป้องลูกชาย" } } },
    { title: "ห้องที่ไม่มีใครออกมา", logline: "แขกคนหนึ่งหายไปจากห้องที่ล็อกจากข้างใน {LEAD}กับ{ALLY}มีเวลาหนึ่งคืนก่อนคดีถูกปิด และ{RIVAL}รู้มากกว่าที่พูด",
      truth: "ไม่มีใครหายไป ผู้หายสลับตัวกับ{RIVAL}เพื่อหนีหนี้และหลอกเอาประกัน", ending: "{LEAD}จับได้ว่า{RIVAL}คือผู้หายที่ปลอมตัว ทุกอย่างคลี่คลายต่อหน้าทุกคน",
      reveal1: say("RIVAL", "ห้องนั้นไม่เคยมีใครออกไปจริงๆ หรอก"), reveal2: say("RIVAL", "เขาไม่ได้หาย... เขายืนอยู่ตรงหน้าคุณ"), finalLine: say("LEAD", "ปริศนาไม่ได้อยู่ในห้อง แต่อยู่ในตัวคุณ"),
      roles: { LEAD: { trait: "ฉลาด ใจเย็น", want: "อยากปิดคดีแรกให้ได้", secret: "เคยพลาดคดีจนมีคนตาย" },
        ALLY: { trait: "ตลก ใจกล้า", want: "อยากเป็นนักสืบเก่งๆ", secret: "กลัวความมืด" },
        RIVAL: { trait: "นิ่ง ลึกลับ", want: "อยากให้ทุกคนเชื่อว่าเป็นอุบัติเหตุ", secret: "ไม่ใช่คนที่บอกว่าเป็น" } } },
    { title: "บันทึกคืนวันที่ 7", logline: "{OBJ}ถูกส่งมาให้{LEAD}พร้อมข้อความว่าจะมีคนตายในคืนวันที่ 7 เธอกับ{ALLY}ต้องหาคนส่งก่อนที่จะสายเกินไป",
      truth: "คนส่ง{OBJ}คือเหยื่อเองที่รู้ว่า{RIVAL}จะลงมือ และหวังให้{LEAD}ช่วย", ending: "{LEAD}ไปถึงทันเวลา ช่วยเหยื่อไว้ได้ และ{RIVAL}ถูกจับคาที่",
      reveal1: say("RIVAL", "คนที่ส่งของนั่นมา... ตายไปแล้วไม่ใช่เหรอ"), reveal2: say("RIVAL", "เขาส่งมาเพราะรู้ว่าฉันจะไปหาเขาคืนนี้"), finalLine: say("LEAD", "คุณส่งมาถูกคนแล้ว... เราทันเวลา"),
      roles: { LEAD: { trait: "กล้า ไม่เชื่อใคร", want: "อยากช่วยคนที่ส่งข้อความ", secret: "เคยได้รับจดหมายแบบนี้ตอนเด็ก" },
        ALLY: { trait: "สุขุม รอบคอบ", want: "อยากให้{LEAD}ปลอดภัย", secret: "รู้จัก{RIVAL}มาก่อน" },
        RIVAL: { trait: "ใจดีต่อหน้า", want: "อยากเก็บความลับให้ตายไปกับเหยื่อ", secret: "ฆ่าคนมาแล้วครั้งหนึ่ง" } } },
  ],
  hooks: [say("LEAD", "มีบางอย่างไม่ตรงกัน"), say("ALLY", "เราต้องรีบแล้ว"), say("LEAD", "ทุกคนโกหกเรา"), say("ALLY", "ผมว่าเรามาถูกทางแล้ว"), say("LEAD", "เดี๋ยวนะ... ดูนี่สิ")],
  moves: [
    m("clue", "เบาะแส", "{LEAD}พบเบาะแสเล็กๆ ที่ทุกคนมองข้าม", "{LEAD} crouches and picks up something tiny from the floor with a tissue, holding it to the light", 1, { say: say("LEAD", "ตำรวจมองข้ามอันนี้ไป"), clue: "มีของชิ้นเล็กที่ไม่ควรอยู่ในที่เกิดเหตุ" }),
    m("board", "กระดานคดี", "{LEAD}กับ{ALLY}ต่อเส้นเบาะแสบนกระดาน", "{LEAD} pins a new photo to a board of photos and red string while {ALLY} reads notes beside her", 1, { say: say("ALLY", "ถ้าเส้นนี้ถูก... คนร้ายอยู่ใกล้เรามาก") }),
    m("question", "สอบปากคำ", "{LEAD}สอบปากคำ{RIVAL}", "{LEAD} sits opposite {RIVAL} and slides a photo across the table; {RIVAL} glances at it and smiles politely", 2, { say: say("RIVAL", "ผมไม่เคยเห็นคนนี้มาก่อน") }),
    m("follow", "สะกดรอย", "ทั้งสองสะกดรอยตาม{RIVAL}", "{LEAD} and {ALLY} follow at a distance through the rain, ducking into a doorway when {RIVAL} looks back", 2, { at: "D", say: say("ALLY", "เขาไม่ได้กลับบ้าน") }),
    m("tape", "ฟังเสียง", "{LEAD}ฟังบันทึกเสียงปริศนา", "{LEAD} presses play and listens with eyes closed to a crackling recording, then her eyes snap open", 2, { say: say("LEAD", "เสียงนี้... ฉันเคยได้ยิน") }),
    m("search", "ค้นห้อง", "{LEAD}แอบค้นห้องของ{RIVAL}", "{LEAD} searches drawers by phone torchlight, fast and careful, putting everything back exactly", 2, { at: "E", say: say("LEAD", "ต้องมีอะไรสักอย่างสิ") }),
    m("threat", "ข้อความขู่", "{LEAD}ได้รับข้อความขู่", "{LEAD}'s phone buzzes; a message from an unknown number; she reads it and slowly looks around", 2, { say: say("LEAD", "มันรู้ว่าเราอยู่ที่นี่") }),
    m("doubt", "สงสัย", "{ALLY}เริ่มสงสัยว่ามีคนในรู้เห็น", "{ALLY} leans close to {LEAD} and lowers his voice, glancing at the door", 1, { say: say("ALLY", "มีคนในช่วยเขาอยู่แน่ๆ") }),
    m("match", "ตรงกัน", "{LEAD}พบว่าลายมือตรงกัน", "{LEAD} holds two pieces of paper side by side under a lamp; the handwriting matches; she inhales sharply", 3, { say: say("LEAD", "คนเดียวกัน...") }),
    m("chase", "ไล่ตาม", "{LEAD}ไล่ตามเงาปริศนา", "a dark figure bolts from the shadows; {LEAD} runs after it through the rain, splashing through puddles", 3, { say: say("LEAD", "หยุดนะ!") }),
  ],
  cliffs: [
    m("c-body", "ร่างที่สอง", "ไฟฉายส่องเจอรองเท้าคู่หนึ่งยื่นออกมาจากหลังประตู", "the torch beam finds a pair of shoes sticking out from behind a door; {LEAD} slowly steps closer", 3),
    m("c-watch", "ถูกจับตา", "มีคนยืนมองทั้งสองจากหน้าต่างตรงข้าม", "{LEAD} glances out the window: across the street a figure stands perfectly still watching her, then the light behind it goes out", 2),
    m("c-name", "ชื่อในสมุด", "{LEAD}เห็นชื่อตัวเองในสมุดของคนร้าย", "{LEAD} flips a page and freezes: her own name is written there in red ink", 3, { say: say("LEAD", "ทำไม... มีชื่อฉัน") }),
    m("c-ally", "เพื่อนหาย", "{ALLY}ไม่รับสาย มือถือดังอยู่ในความมืด", "{LEAD} calls {ALLY}; somewhere in the dark nearby his phone starts ringing, but he does not answer", 3, { say: say("LEAD", "อยู่ไหน...") }),
    m("c-smile", "รอยยิ้ม", "{RIVAL}ยิ้มให้{LEAD}ผ่านกระจก", "through the glass {RIVAL} meets {LEAD}'s eyes and smiles slowly; slow push-in", 2),
  ],
  beats: {
    OPENING: { title: "คดีที่ถูกปิด", at: "A", shots: [
      m("o1", "มาถึง", "{LEAD}มาถึงที่เกิดเหตุ {ALLY}พยายามห้าม {RIVAL}ยืนมองอยู่", "{LEAD} ducks under police tape; {ALLY} hurries to stop her; {RIVAL} stands nearby watching calmly; all three faces clearly visible", 1, { say: say("ALLY", "คุณเข้ามาไม่ได้นะครับ") }),
      m("o2", "ปิดคดี", "{RIVAL}บอกว่าเป็นแค่อุบัติเหตุ", "{RIVAL} steps forward with a polite smile and speaks smoothly", 1, { say: say("RIVAL", "อุบัติเหตุธรรมดาครับ ไม่มีอะไรให้สืบ") }),
      m("o3", "ไม่เชื่อ", "{LEAD}จ้องตา{RIVAL}อย่างไม่เชื่อ", "{LEAD} holds {RIVAL}'s gaze without blinking", 1, { say: say("LEAD", "งั้นทำไมคุณถึงมาอยู่ที่นี่ตอนตีสาม") }),
    ], cliff: m("o-c", "เบาะแสแรก", "{LEAD}พบ{OBJ}ซ่อนอยู่", "{LEAD} slides her hand under a cushion and pulls out {OBJ}; she quickly hides it in her coat", 2) },
    INCITING: { title: "เบาะแสชิ้นแรก", at: "A", shots: [
      m("i1", "ตรวจของ", "{LEAD}กับ{ALLY}ตรวจ{OBJ}", "{LEAD} sets {OBJ} on the table under a lamp; {ALLY} leans in beside her", 1, { say: say("ALLY", "ถ้าหัวหน้ารู้ ผมโดนย้ายแน่") }),
      m("i2", "ร่วมมือ", "{ALLY}ตัดสินใจช่วย", "{ALLY} hesitates, then pulls up a chair and sits beside {LEAD}", 1, { say: say("ALLY", "ก็ได้ แต่คืนเดียวนะ") }),
      m("i3", "เจอสิ่งแปลก", "ทั้งสองพบสิ่งผิดปกติใน{OBJ}", "{LEAD} turns {OBJ} over and finds something scratched into it; both lean closer", 2, { say: say("LEAD", "มีคนตั้งใจทิ้งไว้ให้เราเจอ") }),
    ], cliff: m("i-c", "ไฟดับ", "ไฟดับทันที มีเสียงฝีเท้าวิ่งผ่าน", "the lights cut out; footsteps run past in the dark; when the torch comes on the table is empty", 3, { say: say("ALLY", "ของหายไปแล้ว!") }) },
    MIDPOINT: { title: "ความจริงครึ่งเดียว", at: "B", shots: [
      m("mp1", "เผชิญหน้า", "{LEAD}ดัก{RIVAL}กลางสายฝน", "{LEAD} steps out in front of {RIVAL} in the rain; {ALLY} stands behind her", 2, { say: say("LEAD", "หนีไม่พ้นแล้ว พูดมาเถอะ") }),
      m("mp2", "สารภาพ", "{RIVAL}ยอมเล่าความจริงครึ่งหนึ่ง", "{RIVAL} wipes rain from his face, looks away, and answers quietly", 1, { say: "REVEAL1" }),
      m("mp3", "พลิก", "{ALLY}กับ{LEAD}มองหน้ากัน เพิ่งรู้ว่าคิดผิด", "{ALLY} and {LEAD} exchange a stunned look in the rain", 1, { say: say("ALLY", "งั้นคนร้ายตัวจริง...") }),
    ], cliff: m("mp-c", "ไฟหน้ารถ", "ไฟหน้ารถสาดเข้ามาแล้วเร่งเครื่องพุ่งมาหาทั้งสาม", "headlights flare on at the end of the lot and a car roars straight toward the three of them", 3) },
    CRISIS: { title: "กับดัก", at: "C", shots: [
      m("cr1", "ติดกับ", "ทั้งสองถูกขังในห้อง", "the heavy door slams and locks behind {LEAD} and {ALLY}; {ALLY} throws his shoulder against it", 3, { say: say("ALLY", "เราโดนหลอกมา!") }),
      m("cr2", "ควัน", "ควันเริ่มลอยเข้ามาใต้ประตู", "grey smoke begins to curl in under the door; {LEAD} pulls her coat over her mouth", 3),
      m("cr3", "หาทาง", "{LEAD}ค้นหาทางออกท่ามกลางควัน", "{LEAD} sweeps her torch across the walls through the smoke, coughing, searching", 3, { say: say("LEAD", "ต้องมีทางออกสิ") }),
    ], cliff: m("cr-c", "หมดสติ", "{ALLY}ล้มลง {LEAD}คุกเข่าลงข้างเขา", "{ALLY} collapses; {LEAD} drops to her knees beside him in the smoke, shaking him", 3, { say: say("LEAD", "อย่าหลับนะ!") }) },
    CLIMAX: { title: "ความจริงทั้งหมด", at: "E", shots: [
      m("cl1", "บุกเข้าไป", "{LEAD}บุกเข้าไปหา{RIVAL}", "{LEAD} pushes open the door; {RIVAL} turns from the window", 2, { say: say("LEAD", "จบแล้ว") }),
      m("cl2", "ยอมรับ", "{RIVAL}ยอมบอกความจริงทั้งหมด", "{RIVAL} sits down heavily and speaks without looking at her", 2, { say: "REVEAL2" }),
      m("cl3", "มาถึงทันเวลา", "{ALLY}มาถึงพร้อมตำรวจ", "{ALLY} appears in the doorway, bruised but standing, with police behind him", 2, { say: say("ALLY", "ทุกคำที่พูด เราบันทึกไว้หมดแล้ว") }),
    ], cliff: m("cl-c", "สุดท้าย", "{RIVAL}ลุกขึ้นช้าๆ มองทุกคน", "{RIVAL} slowly stands, looks at each of them, and lifts his hands", 2) },
    FINALE: { title: "คดีปิด", at: "A", shots: [
      m("f1", "พาตัวไป", "{RIVAL}ถูกพาตัวไป", "morning light; {RIVAL} is led away past {LEAD}, pausing for one look", 1, { say: say("RIVAL", "คุณเก่งกว่าที่ผมคิด") }),
      m("f2", "ปิดคดี", "{LEAD}ปิดสมุดจดลงอย่างโล่งใจ", "{LEAD} closes her notebook and breathes out for the first time in days", 1, { say: "FINAL" }),
      m("f3", "กาแฟ", "{ALLY}ยื่นกาแฟให้{LEAD}", "wide shot: {ALLY} hands {LEAD} a coffee; they stand together in the quiet morning", 1, { say: say("ALLY", "คดีหน้า... เรียกผมด้วยนะ") }),
    ] },
  },
};

const FANTASY: MixGenre = {
  style: "Photorealistic Thai fantasy drama, rich cinematic colour, golden lantern light and moonlit blues, gentle magical glow, misty air, graceful camera moves",
  sound: "wind chimes, night insects, soft water, gentle magical shimmer; no music score",
  hashtags: ["#ละครสั้น", "#แฟนตาซี", "#ตำนาน", "#ละครไทย"],
  roles: {
    LEAD: { gender: "F", band: "YOUNG", outfits: ["a simple white Thai cotton blouse and an indigo wrap skirt", "a faded red sabai sash over a cream blouse and a dark sarong", "a light green linen dress and a woven shoulder bag"] },
    ALLY: { gender: "M", band: "YOUNG", outfits: ["a loose white linen shirt, dark fisherman trousers and a cloth bag", "a dark blue traditional Thai shirt and a sash at the waist", "a worn leather vest over a cream shirt and loose trousers"] },
    RIVAL: { gender: "ANY", band: "OLD", outfits: ["a long dark robe embroidered with gold", "a white traditional outfit with a silver sash", "a black traditional Thai outfit with an old amulet necklace"] },
  },
  packs: [
    { places: [
      place("A", "หมู่บ้านริมป่า", "a small Thai village at the edge of a deep forest at dusk, wooden houses on stilts, lanterns, chickens and mist rolling in"),
      place("B", "ลำธารในป่าลึก", "a clear stream deep in the forest, mossy rocks, giant tree roots, fireflies and moonlight through the canopy"),
      place("C", "วัดร้างกลางป่า", "an ancient ruined temple swallowed by the jungle, crumbling brick stupas, tree roots wrapping a stone Buddha, glowing moss"),
      place("D", "ทางเดินในป่า", "a narrow forest path between huge trees, hanging vines, ferns and drifting glowing spores"),
      place("E", "บ้านไม้ของยาย", "the inside of an old wooden village house, herbs drying from the beams, a small shrine, a clay stove and oil lamp light"),
    ] },
    { places: [
      place("A", "ตลาดน้ำโบราณ", "an old floating market at twilight, wooden boats with lanterns, stilt houses along the canal and incense smoke"),
      place("B", "บึงบัวยามค่ำ", "a vast lotus pond at night, giant pink lotuses glowing softly, a wooden walkway and a full moon"),
      place("C", "ถ้ำใต้น้ำตก", "a cave behind a waterfall, walls glittering with crystals, a pool of glowing blue water"),
      place("D", "สะพานไม้ข้ามคลอง", "an old arched wooden bridge over a misty canal, lanterns hanging from its rails"),
      place("E", "ศาลเจ้าเก่า", "a small old shrine room, gold leaf on statues, candles, garlands of jasmine and a carved wooden chest"),
    ] },
    { places: [
      place("A", "ลานหน้าวังเก่า", "the moonlit courtyard of an old Thai palace, white walls, golden roof tips, stone lions and lanterns"),
      place("B", "สวนดอกไม้ลับ", "a secret walled garden full of glowing night flowers, a stone pool and butterflies of light"),
      place("C", "หอคอยดวงดาว", "the top of an old stone tower open to the starry sky, bronze instruments, a big brass bell"),
      place("D", "ระเบียงวัง", "a long palace gallery with red lacquered pillars, gold patterns and moonlight on the floor"),
      place("E", "ห้องบรรทมเก่า", "an old royal bedroom, a carved bed with silk curtains, a vanity with a bronze mirror and moonlight"),
    ] },
  ],
  objects: [
    { name: "ดอกบัวแก้ว", short: "บัวแก้ว", look: "a small lotus flower made of clear glass that glows faintly from within" },
    { name: "ปิ่นปักผมทองคำ", short: "ปิ่นทอง", look: "an ornate gold hairpin shaped like a phoenix feather" },
    { name: "ขลุ่ยไม้ไผ่โบราณ", short: "ขลุ่ยวิเศษ", look: "an old bamboo flute carved with tiny stars" },
    { name: "เกล็ดพญานาคสีเขียว", short: "เกล็ดนาค", look: "a large shimmering emerald-green scale on a red cord" },
    { name: "ตะเกียงแสงจันทร์", short: "ตะเกียงจันทร์", look: "an old brass lantern with a pale silver flame that never flickers" },
  ],
  plots: [
    { title: "ตำนาน{OBJT}", logline: "{LEAD}สาวชาวบ้านพบ{OBJ}ที่หายไปร้อยปี แล้ว{ALLY}ชายลึกลับก็ปรากฏตัวมาปกป้อง ขณะที่{RIVAL}ต้องการมันคืน",
      truth: "{ALLY}คือผู้พิทักษ์ที่ถูกสาปให้รอเจ้าของ{OBJ}คนใหม่ และ{LEAD}คือคนนั้น", ending: "{LEAD}ใช้{OBJ}ถอนคำสาป {ALLY}กลับเป็นมนุษย์ และ{RIVAL}ได้ไปสงบ",
      reveal1: say("RIVAL", "เขาไม่ใช่คน เขาเป็นผู้พิทักษ์ที่รอเธอมาร้อยปี"), reveal2: say("RIVAL", "มีแค่หัวใจของเธอที่ถอนคำสาปได้"), finalLine: say("ALLY", "ร้อยปีที่รอ... คุ้มทุกวันเลย"),
      roles: { LEAD: { trait: "ใจดี กล้า", want: "อยากช่วยหมู่บ้าน", secret: "ฝันถึงชายคนหนึ่งมาตั้งแต่เด็ก" },
        ALLY: { trait: "เงียบ ลึกลับ", want: "อยากเป็นอิสระ", secret: "เป็นผู้พิทักษ์ต้องสาป" },
        RIVAL: { trait: "ทรงพลัง โศกเศร้า", want: "อยากได้{OBJ}คืน", secret: "เป็นคนสาป{ALLY}เอง" } } },
    { title: "คืนพระจันทร์สีเงิน", logline: "ทุกร้อยปีในคืนพระจันทร์สีเงิน{OBJ}จะเลือกเจ้าของใหม่ ปีนี้มันเลือก{LEAD} และ{RIVAL}จะไม่ยอม",
      truth: "{RIVAL}เคยเป็นเจ้าของ{OBJ}คนก่อน และเสียคนรักไปเพราะใช้มันผิดทาง", ending: "{LEAD}ใช้{OBJ}คืนชีวิตให้ป่า แทนที่จะใช้เพื่อตัวเอง {RIVAL}ร้องไห้และยอมรับ",
      reveal1: say("RIVAL", "ฉันเคยถือมันเหมือนเธอ แล้วฉันก็เสียทุกอย่าง"), reveal2: say("RIVAL", "ใช้มันเพื่อคนอื่น อย่าทำผิดแบบฉัน"), finalLine: say("LEAD", "พลังนี้ไม่ใช่ของฉัน มันเป็นของทุกคน"),
      roles: { LEAD: { trait: "ซื่อ มีหัวใจ", want: "อยากรักษาแม่ที่ป่วย", secret: "อยากใช้พลังรักษาแม่" },
        ALLY: { trait: "ร่าเริง ภักดี", want: "อยากปกป้อง{LEAD}", secret: "เป็นวิญญาณของป่า" },
        RIVAL: { trait: "ดุ เศร้า", want: "อยากหยุด{LEAD}ไม่ให้ทำผิดซ้ำ", secret: "เคยเป็นเจ้าของคนก่อน" } } },
    { title: "{PLACE}ต้องมนตร์", logline: "{LEAD}หลงเข้ามาใน{PLACE}ที่เวลาไม่เดิน และพบ{ALLY}ที่ติดอยู่มานาน ทางออกเดียวคือ{OBJ}ที่{RIVAL}เฝ้าอยู่",
      truth: "{RIVAL}ไม่ได้ขังใคร แต่สร้างที่นี่ไว้ปกป้อง{ALLY}จากความตาย", ending: "{ALLY}เลือกออกไปใช้ชีวิตที่เหลือกับ{LEAD} {RIVAL}ปล่อยเขาไปด้วยรอยยิ้ม",
      reveal1: say("RIVAL", "ฉันไม่ได้ขังเขา ฉันซ่อนเขาจากความตาย"), reveal2: say("RIVAL", "ถ้าออกไป เวลาของเขาจะเริ่มเดินอีกครั้ง"), finalLine: say("ALLY", "ชีวิตสั้นแค่ไหนก็ได้ ขอแค่มีเธอ"),
      roles: { LEAD: { trait: "ขี้สงสัย กล้าหาญ", want: "อยากกลับบ้าน", secret: "หลงทางเพราะตามเสียงขลุ่ย" },
        ALLY: { trait: "อ่อนโยน เหงา", want: "อยากเห็นโลกข้างนอก", secret: "ติดอยู่ที่นี่มาห้าสิบปี" },
        RIVAL: { trait: "เข้มงวด รักลึก", want: "อยากให้{ALLY}ปลอดภัย", secret: "เป็นแม่ของ{ALLY}" } } },
  ],
  hooks: [say("LEAD", "มันเรียกฉันอีกแล้ว"), say("ALLY", "อยู่ใกล้ผมไว้"), say("LEAD", "นี่ไม่ใช่ความฝันใช่ไหม"), say("ALLY", "เวลาเราเหลือไม่มาก"), say("LEAD", "ฉันจะไม่ถอยแล้ว")],
  moves: [
    m("glow", "แสงเรียก", "{OBJ}เรืองแสงเมื่อ{LEAD}อยู่ใกล้", "{OBJ} begins to glow softly as {LEAD} reaches toward it; the light pulses like a heartbeat on her face", 1, { say: say("LEAD", "มัน... ตอบรับฉัน") }),
    m("teach", "สอนพลัง", "{ALLY}สอน{LEAD}ใช้พลังครั้งแรก", "{ALLY} stands behind {LEAD} guiding her hands as tiny lights rise from the ground around them", 1, { say: say("ALLY", "อย่าบังคับมัน ฟังมันก่อน") }),
    m("spirits", "วิญญาณป่า", "วิญญาณดวงไฟเล็กๆ ล่องลอยรอบตัวทั้งสอง", "dozens of small glowing spirits drift out of the trees and circle {LEAD} and {ALLY} curiously", 1, { say: say("LEAD", "สวยจัง...") }),
    m("warning", "คำเตือน", "{RIVAL}ปรากฏตัวในหมอกและเตือน", "{RIVAL} appears out of the mist without a sound and raises a hand", 2, { say: say("RIVAL", "คืนมันมา ก่อนที่ทุกอย่างจะสายเกินไป") }),
    m("past", "ภาพอดีต", "{LEAD}เห็นภาพอดีตเมื่อแตะ{OBJ}", "{LEAD} touches {OBJ} and gasps, eyes going wide and distant as golden light washes over her face", 2, { say: say("LEAD", "ฉันเคยอยู่ที่นี่มาก่อน") }),
    m("fade", "ร่างจาง", "ร่างของ{ALLY}เริ่มจางลง", "{ALLY} looks down at his hand; it flickers and turns faintly transparent; he hides it behind his back", 3, { say: say("ALLY", "ไม่มีอะไรหรอก... ไม่ต้องห่วง") }),
    m("storm", "พายุมนตร์", "ลมพายุพัดแรงเมื่อ{RIVAL}โกรธ", "a sudden fierce wind whips leaves and lanterns around; {LEAD} shields her eyes and grabs {ALLY}'s arm", 3),
    m("dance", "เต้นใต้แสงจันทร์", "ทั้งสองเต้นรำช้าๆ ใต้แสงจันทร์", "{LEAD} and {ALLY} sway slowly together under the moon as glowing petals fall around them", 1, { say: say("ALLY", "ผมรอวันนี้มานานมาก") }),
    m("map", "แผนที่โบราณ", "{LEAD}พบแผนที่เก่าที่ชี้ทาง", "{LEAD} unrolls an old cloth map; faint golden lines light up on it, showing a path", 2, { say: say("LEAD", "มันบอกทางให้เรา"), clue: "แผนที่โบราณชี้ไปยังวัดร้าง" }),
    m("heal", "รักษาแผล", "{LEAD}ใช้พลังรักษาแผลให้{ALLY}", "{LEAD} presses her glowing palms to {ALLY}'s wounded arm; the light seals the cut", 2, { say: say("ALLY", "เธอทำได้แล้ว") }),
  ],
  cliffs: [
    m("c-eyes", "ดวงตาในป่า", "ดวงตาเรืองแสงนับสิบลืมขึ้นในความมืด", "in the dark forest dozens of glowing eyes open at once, all fixed on {LEAD}", 3),
    m("c-crack", "รอยร้าว", "{OBJ}เกิดรอยร้าวเส้นแรก", "a thin crack runs across {OBJ} with a high ringing sound; its light flickers; {LEAD} stares in horror", 2, { say: say("LEAD", "ไม่นะ...") }),
    m("c-taken", "ถูกพาตัวไป", "เถาวัลย์รัดตัว{ALLY}ลากหายไปในป่า", "glowing vines whip around {ALLY} and drag him back into the dark trees; {LEAD} reaches for him too late", 3, { say: say("LEAD", "ไม่!") }),
    m("c-mirror", "หน้าตาเหมือนกัน", "{LEAD}เห็นรูปวาดโบราณที่หน้าตาเหมือนตัวเอง", "{LEAD} lifts a lantern to an old mural; the painted woman has her exact face", 2, { say: say("LEAD", "นี่มัน... ฉัน") }),
    m("c-moon", "พระจันทร์เปลี่ยนสี", "พระจันทร์ค่อยๆ เปลี่ยนเป็นสีเงิน", "everyone looks up as the full moon slowly turns bright silver and the whole place falls silent", 2),
  ],
  beats: {
    OPENING: { title: "ของที่ถูกลืม", at: "A", shots: [
      m("o1", "พบกัน", "{LEAD}เดินกลับหมู่บ้าน พบ{ALLY}ยืนอยู่ใต้ต้นไม้ {RIVAL}มองจากไกลๆ", "{LEAD} walks home at dusk carrying a basket; a stranger, {ALLY}, stands under a big tree watching her; far behind, {RIVAL} stands in the mist; all three faces clearly visible", 1, { say: say("ALLY", "ในที่สุด... คุณก็มา") }),
      m("o2", "งง", "{LEAD}ถามว่าเขาเป็นใคร", "{LEAD} stops and studies {ALLY} warily, holding her basket close", 1, { say: say("LEAD", "เรารู้จักกันเหรอคะ") }),
      m("o3", "หายไป", "{ALLY}หายไปในพริบตา", "a gust of wind blows leaves between them; when they clear, {ALLY} is gone", 2, { say: say("LEAD", "เดี๋ยวสิ!") }),
    ], cliff: m("o-c", "ในตะกร้า", "{LEAD}พบ{OBJ}เรืองแสงอยู่ในตะกร้า", "{LEAD} looks down: inside her basket {OBJ} is glowing softly where nothing was before", 2) },
    INCITING: { title: "พลังตื่น", at: "E", shots: [
      m("i1", "ซ่อนไว้", "{LEAD}ซ่อน{OBJ}ไว้ในบ้าน", "{LEAD} hides {OBJ} in a wooden chest and closes the lid; light leaks through the cracks", 1, { say: say("LEAD", "อย่าให้ใครเห็นนะ") }),
      m("i2", "เขากลับมา", "{ALLY}ปรากฏตัวที่หน้าต่าง", "{ALLY} appears at the window in the moonlight and gently knocks", 1, { say: say("ALLY", "มันเลือกคุณแล้ว คุณซ่อนไม่ได้หรอก") }),
      m("i3", "เล่า", "{ALLY}เล่าตำนานให้ฟัง", "{ALLY} sits across from {LEAD} by the oil lamp, speaking low", 1, { say: say("ALLY", "ร้อยปีก่อน มันเคยปกป้องที่นี่") }),
    ], cliff: m("i-c", "เงาที่ประตู", "เงาของ{RIVAL}ทาบประตู", "a tall shadow falls across the door from outside; the lamp flame bends toward it", 2, { say: say("ALLY", "มาแล้ว...") }) },
    MIDPOINT: { title: "ความลับของผู้พิทักษ์", at: "B", shots: [
      m("mp1", "เผชิญหน้า", "{LEAD}เผชิญหน้า{RIVAL}ริมลำธาร", "{LEAD} stands at the stream holding {OBJ}; {RIVAL} faces her across the water; {ALLY} behind her", 2, { say: say("LEAD", "ทำไมต้องการมันนัก") }),
      m("mp2", "เปิดเผย", "{RIVAL}เปิดเผยความจริงครึ่งหนึ่ง", "{RIVAL} lowers a hand and the wind dies; the voice is quiet and sad", 1, { say: "REVEAL1" }),
      m("mp3", "หันมอง", "{LEAD}หันไปมอง{ALLY}", "{LEAD} turns slowly to {ALLY}, who cannot meet her eyes", 1, { say: say("LEAD", "จริงเหรอ...") }),
    ], cliff: m("mp-c", "น้ำเรืองแสง", "น้ำในลำธารเรืองแสงและไหลย้อนกลับ", "the stream begins to glow and slowly flows backward; {LEAD} stares at it", 2) },
    CRISIS: { title: "พลังที่ควบคุมไม่ได้", at: "A", shots: [
      m("cr1", "พลังระเบิด", "พลังของ{OBJ}ระเบิดออกโดยไม่ตั้งใจ", "a blast of light bursts from {OBJ} in {LEAD}'s hands, knocking lanterns flying", 3),
      m("cr2", "ชาวบ้านกลัว", "ชาวบ้านมอง{LEAD}ด้วยความกลัว", "{LEAD} stands alone in the light as frightened faces watch from doorways", 3, { say: say("LEAD", "ฉันไม่ได้ตั้งใจ...") }),
      m("cr3", "เขาจาง", "{ALLY}ทรุดลง ร่างจางลงเรื่อยๆ", "{ALLY} sinks to his knees, his body flickering and fading", 3, { say: say("ALLY", "ผมเหลือเวลาไม่มากแล้ว") }),
    ], cliff: m("cr-c", "เหลือแค่แสง", "{ALLY}จางหายเหลือแค่ประกายแสง", "{LEAD} reaches for {ALLY} as he fades into drifting sparks of light; her hands close on nothing", 3, { say: say("LEAD", "อย่าทิ้งฉันไป!") }) },
    CLIMAX: { title: "พิธีใต้แสงจันทร์", at: "C", shots: [
      m("cl1", "มาถึง", "{LEAD}ถือ{OBJ}มาถึงวัดร้าง", "{LEAD} climbs the ruined temple steps under the full moon holding {OBJ}; {RIVAL} waits at the top", 2),
      m("cl2", "ความจริง", "{RIVAL}เล่าความจริงทั้งหมด", "{RIVAL} steps aside to let her pass and speaks gently", 2, { say: "REVEAL2" }),
      m("cl3", "ปล่อยพลัง", "{LEAD}วาง{OBJ}บนแท่นหินและหลับตา", "{LEAD} places {OBJ} on the stone altar and closes her eyes; light rises around her like water", 2),
    ], cliff: m("cl-c", "ร่างปรากฏ", "ประกายแสงรวมตัวเป็นร่างของ{ALLY}", "sparks of light gather in front of {LEAD} and slowly form {ALLY}'s shape", 2) },
    FINALE: { title: "รุ่งเช้า", at: "A", shots: [
      m("f1", "กลับมา", "{ALLY}กลับมาเป็นมนุษย์", "dawn; {ALLY} opens his eyes, solid and real, and touches {LEAD}'s face", 1, { say: "FINAL" }),
      m("f2", "ขอบคุณ", "{RIVAL}โค้งให้ทั้งสองแล้วจางหาย", "{RIVAL} bows to them with a peaceful smile and fades into the morning mist", 1, { say: say("RIVAL", "ขอบใจนะ ฉันไปได้แล้ว") }),
      m("f3", "บ้าน", "ทั้งสองเดินกลับหมู่บ้านด้วยกัน", "wide shot at sunrise: {LEAD} and {ALLY} walk hand in hand back into the waking village", 1, { say: say("LEAD", "กลับบ้านกันเถอะ") }),
    ] },
  },
};

const MIX: Record<DramaGenre, MixGenre> = { HORROR, ACTION, COMEDY, ROMANCE, MYSTERY, FANTASY };

// ---------------------------------------------------------------- Writing a story

function random(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(list: T[], rand: () => number) => list[Math.floor(rand() * list.length)];
function take<T>(list: T[], used: Set<T>, rand: () => number) {
  const free = list.filter(item => !used.has(item));
  const chosen = pick(free.length ? free : list, rand);
  used.add(chosen);
  return chosen;
}

function castMember(role: Role, spec: RoleSpec, plot: Plot, rand: () => number, used: { names: Set<string>; hair: Set<string>; face: Set<string>; voice: Set<string> }): CastMember {
  const gender: Gender = spec.gender === "ANY" ? (rand() < .5 ? "F" : "M") : spec.gender;
  const pool = NAMES[gender][spec.band], free = pool.filter(([th]) => !used.names.has(th));
  const [name, nameEn] = pick(free.length ? free : pool, rand);
  used.names.add(name);
  const hair = take(HAIR[gender][spec.band], used.hair, rand);
  const [low, high] = AGE[spec.band];
  const years = low + Math.floor(rand() * (high - low + 1));
  const look = [spec.band === "OLD" ? (gender === "F" ? "small and frail" : "thin and slightly stooped") : pick(BUILD[gender], rand), hair, take(FACE[gender][spec.band], used.face, rand)].join(", ");
  const r = plot.roles[role];
  return { role, name, nameEn, age: `${years}-year-old Thai ${gender === "F" ? "woman" : "man"}`, look, outfit: pick(spec.outfits, rand),
    voice: take(VOICE[gender][spec.band], used.voice, rand), trait: r.trait, want: r.want, secret: r.secret };
}

/**
 * A new story for the genre. `n` counts this owner's mixed stories of the genre (1, 2, 3...): the plot, places and
 * object step through every combination before any repeats, and the cast is always new.
 */
export function mixStory(genre: DramaGenre, n: number): GenreKit {
  const g = MIX[genre], key = mixKey(genre, n), rand = random(key);
  const i = Math.max(0, n - 1);
  const plot = g.plots[i % g.plots.length];
  const pack = g.packs[(Math.floor(i / g.plots.length) + i) % g.packs.length];
  const object = g.objects[(i * 2 + Math.floor(i / (g.plots.length * g.packs.length))) % g.objects.length];
  const used = { names: new Set<string>(), hair: new Set<string>(), face: new Set<string>(), voice: new Set<string>() };
  const cast = (["LEAD", "ALLY", "RIVAL"] as Role[]).map(role => castMember(role, g.roles[role], plot, rand, used));
  const names: Record<string, string> = { LEAD: cast[0].name, ALLY: cast[1].name, RIVAL: cast[2].name, OBJ: object.name, OBJT: object.short, PLACE: pack.places[0].name };
  const th = (text: string) => text.replace(/\{(LEAD|ALLY|RIVAL|OBJ|OBJT|PLACE)\}/g, (_, k: string) => names[k]);
  const roles = (r: Plot["roles"][Role]) => ({ trait: th(r.trait), want: th(r.want), secret: th(r.secret) });
  cast.forEach(c => Object.assign(c, roles(plot.roles[c.role])));
  // Lines keep {LEAD}/{ALLY}/{RIVAL} for the showrunner to fill; only the season title, logline, truth and ending are written out here.
  return {
    genre, style: g.style, sound: g.sound, hashtags: g.hashtags,
    premise: { key, title: th(plot.title), logline: th(plot.logline), cast, places: pack.places, object: { name: object.name, look: object.look },
      truth: th(plot.truth), ending: th(plot.ending), reveal1: plot.reveal1, reveal2: plot.reveal2, finalLine: plot.finalLine },
    moves: g.moves, cliffs: g.cliffs, hooks: g.hooks, beats: g.beats,
  };
}
