import { FANTASY_NAGA_PEARL_SEASON } from "./seasons/fantasy-naga-pearl";
import { MYSTERY_ROOM_709_SEASON } from "./seasons/mystery-room-709";
import { ROMANCE_BALCONY_NOTES_SEASON } from "./seasons/romance-balcony-notes";
import { COMEDY_CHICKEN_RICE_SEASON } from "./seasons/comedy-chicken-rice";
import type { CastMember, DramaGenre, Line, Place, PlaceKey, Role } from "./contracts";
import { MORE_STORIES } from "./more-stories";
import { ACTION_LAST_PARCEL_SEASON } from "./seasons/action-last-parcel";
import { HORROR_MIRROR_HOUSE_SEASON } from "./seasons/horror-mirror-house";

/**
 * The built-in showrunner's writers' room: one premise per genre plus the story moves, cliffhangers and fixed beats
 * a season is built from. `{LEAD}`, `{ALLY}`, `{RIVAL}` and `{OBJ}` become the character names / key object
 * (English in prompts, Thai in subtitles). Lines are short on purpose: one sentence fits a 10-second shot (Omni 1.2 Flash, 360p).
 */
export type Say = Line | "REVEAL1" | "REVEAL2" | "FINAL";
export interface Move {
  id: string; t: string; th: string; en: string; say?: Say; level: 1 | 2 | 3; at?: PlaceKey;
  condition?: { who: Role; en: string; th: string }; clue?: string;
}
export interface Beat { title: string; at: PlaceKey; shots: Move[]; cliff?: Move }
export type FixedPhase = "OPENING" | "INCITING" | "MIDPOINT" | "CRISIS" | "CLIMAX" | "FINALE";
export interface Premise {
  key: string; title: string; logline: string; cast: CastMember[]; places: Place[]; object: { name: string; look: string };
  truth: string; ending: string; reveal1: Line; reveal2: Line; finalLine: Line;
}
/**
 * One written episode of a season: its title, its place and every shot in order (the first picks up the last
 * episode's cliffhanger, the last is this episode's cliffhanger). Null keeps the built-in beat or the random moves.
 */
export interface EpisodeScript { title: string; at: PlaceKey; shots: Move[] }
export interface GenreKit {
  genre: DramaGenre; style: string; sound: string; hashtags: string[]; premise: Premise;
  moves: Move[]; cliffs: Move[]; hooks: Line[]; beats: Record<FixedPhase, Beat>;
  /** A whole season written episode by episode, used when the series has exactly this many episodes. */
  season?: Array<EpisodeScript | null>;
}

const m = (id: string, t: string, th: string, en: string, level: 1 | 2 | 3, extra: Partial<Move> = {}): Move => ({ id, t, th, en, level, ...extra });
const say = (who: Role, line: string): Line => ({ who, line });

const HORROR: GenreKit = {
  genre: "HORROR",
  style: "Photorealistic Thai horror drama, cinematic 35mm look, low-key lighting, cold teal shadows with warm tungsten practicals, subtle film grain, slow deliberate camera",
  sound: "quiet room tone, creaking wood, distant insects, low drone; no music score",
  hashtags: ["#ละครสั้น", "#ละครผี", "#สยองขวัญ", "#เรื่องหลอน"],
  premise: {
    key: "horror-mirror-house", title: "บ้านกระจกผ้าแดง",
    logline: "มินกับต้นได้บ้านไม้เก่าเป็นมรดก แต่ทุกคืนตีสาม กระจกที่ห่อผ้าแดงในห้องใต้หลังคาจะสะท้อนคนที่ไม่ได้ยืนอยู่ตรงนั้น",
    cast: [
      { role: "LEAD", name: "มิน", nameEn: "Min", age: "24-year-old Thai woman", look: "slim, shoulder-length straight black hair with blunt bangs, a small mole under her left eye",
        outfit: "an oversized mustard-yellow cardigan over a white T-shirt and dark jeans", voice: "soft, slightly husky young female voice",
        trait: "กล้าหาญแต่ดื้อ", want: "อยากรู้ว่าทำไมยายทิ้งบ้านนี้ไว้ให้เธอ", secret: "ฝันเห็นบ้านหลังนี้มาตั้งแต่เด็ก" },
      { role: "ALLY", name: "ต้น", nameEn: "Ton", age: "26-year-old Thai man", look: "lanky, messy short black hair, round wire-rimmed glasses",
        outfit: "a faded navy hoodie, grey cargo pants and a camera strap across his chest", voice: "nervous, quick, mid-pitched male voice",
        trait: "ขี้กลัวแต่ไม่ทิ้งเพื่อน", want: "อยากถ่ายหลักฐานผีให้ได้สักครั้ง", secret: "เคยเห็นผีตอนเด็กแต่ไม่มีใครเชื่อ" },
      { role: "RIVAL", name: "ป้าแจ่ม", nameEn: "Aunt Jaem", age: "elderly Thai woman in her sixties", look: "silver hair in a tight bun, a calm unreadable face, deep-set eyes",
        outfit: "a faded purple sarong and a white lace blouse", voice: "slow, low, whispering elderly female voice",
        trait: "นิ่ง ลึกลับ", want: "อยากให้ผ้าแดงอยู่ที่เดิมตลอดไป", secret: "เป็นคนผนึกวิญญาณไว้ในกระจกเอง" },
    ],
    places: [
      { key: "A", name: "ห้องโถงบ้านไม้", look: "the dim living room of an old two-storey Thai teak house, creaking floorboards, a dusty glass cabinet, a wall of old family photos, one warm tungsten lamp" },
      { key: "B", name: "ศาลาท่าน้ำหลังบ้าน", look: "a weathered wooden pier pavilion behind the house over a dark canal at dusk, a hanging oil lantern, mist on the water" },
      { key: "C", name: "ห้องใต้หลังคา", look: "a cramped attic under a sloped wooden roof, a single bare bulb, old rattan trunks, dust in the air" },
      { key: "D", name: "ทางเดินชั้นบน", look: "the narrow upstairs hallway of the old teak house, creaking floorboards, a wall of faded family photos, one dim wall lamp and a pull-down ladder to the attic hatch in the ceiling" },
      { key: "E", name: "ห้องนอนเก่าชั้นบน", look: "an old upstairs bedroom closed for decades, a carved teak bed under a dusty mosquito net, a vanity mirror, a dresser crowded with small framed photos and an old wall clock" },
      { key: "F", name: "ครัวหลังบ้าน", look: "the old wooden kitchen at the back of the teak house, a charcoal stove, hanging pots, a worn wooden table and a back door to the canal" },
      { key: "I", name: "ทางเดินไม้ริมคลองหลังบ้าน", look: "a narrow wooden boardwalk along the dark canal from the back door to the pier, lamps hanging from posts, a small spirit post, old stone steps down into the water and mist" },
    ],
    object: { name: "กระจกห่อผ้าแดง", look: "an antique oval standing mirror wrapped in faded red cloth" },
    truth: "ป้าแจ่มไม่ใช่ผู้ร้าย เธอผนึกวิญญาณหญิงสาวเจ้าของบ้านเดิมไว้ในกระจกเพื่อปกป้องหมู่บ้าน และหญิงคนนั้นคือยายทวดของมิน",
    ending: "มินนำกระจกไปคืนที่ท่าน้ำ ปลดปล่อยวิญญาณอย่างสงบ ต้นรอดกลับมา ป้าแจ่มยิ้มเป็นครั้งแรก",
    reveal1: say("RIVAL", "คนในกระจกไม่ได้อยากทำร้ายใคร เธอแค่รอคนในสายเลือด"),
    reveal2: say("RIVAL", "เธอคือยายทวดของหนู ปล่อยเธอไปเถอะ"),
    finalLine: say("RIVAL", "ไปสงบเถอะนะ หลานเธอมารับแล้ว"),
  },
  season: HORROR_MIRROR_HOUSE_SEASON,
  hooks: [say("LEAD", "ไม่เป็นไร... ใจเย็นไว้ก่อน"), say("ALLY", "เมื่อกี้เห็นเหมือนกันใช่ไหม"), say("LEAD", "เราต้องรู้ให้ได้ว่ามันคืออะไร"),
    say("ALLY", "ผมว่าเราออกไปจากบ้านนี้เถอะ"), say("LEAD", "ไม่ คืนนี้ฉันจะไม่หนี")],
  moves: [
    m("knock", "เสียงเคาะ", "{LEAD}ได้ยินเสียงเคาะเป็นจังหวะดังมาจาก{OBJ}", "{LEAD} freezes as slow rhythmic knocking comes from somewhere close; she turns her head toward the sound very slowly", 1, { say: say("LEAD", "ใคร... อยู่ตรงนั้น") }),
    m("photo", "รูปที่มีคนเกิน", "{ALLY}พบคนแปลกหน้ายืนอยู่ข้างหลังในรูปครอบครัวทุกรูป", "{ALLY} lifts an old framed family photo close to his glasses; a blurred extra figure stands behind the family; his hands start to shake", 1, { at: "A", say: say("ALLY", "ทุกรูป... มีคนนี้ยืนอยู่ข้างหลัง"), clue: "มีหญิงสาวแปลกหน้าอยู่ในรูปครอบครัวทุกรูป" }),
    m("diary", "สมุดบันทึกเก่า", "{LEAD}พบสมุดบันทึกเก่าที่เขียนถึง{OBJ}", "{LEAD} opens a dusty leather diary under the lamp, her fingers tracing faded Thai handwriting and a pencil sketch of {OBJ}", 1, { say: say("LEAD", "คนเขียนรู้เรื่อง{OBJ}"), clue: "สมุดบันทึกพูดถึงพิธีผนึกที่ท่าน้ำ" }),
    m("warning", "คำเตือน", "{RIVAL}ปรากฏตัวเงียบๆ และเตือนอย่าแตะผ้าแดง", "{RIVAL} appears in the doorway without a sound, staring calmly, raises one wrinkled hand in warning and speaks", 1, { say: say("RIVAL", "อย่าแกะผ้าแดง ถ้ายังอยากออกจากบ้านนี้") }),
    m("lights", "ไฟดับ", "ไฟดับทั้งบ้าน เหลือแค่แสงไฟฉายของ{ALLY}", "the lamp flickers and dies; only {ALLY}'s phone flashlight beam sweeps across the room, catching dust in the air beside {LEAD}", 2, { say: say("LEAD", "อย่าเพิ่งขยับ") }),
    m("whisper", "เสียงกระซิบ", "มีเสียงกระซิบเรียกชื่อ{LEAD}จากความมืด", "{LEAD} stands still in the dark as a faint whisper seems to come from just behind her shoulder; she slowly looks back", 2, { say: say("LEAD", "ได้ยินไหม มันเรียกชื่อฉัน") }),
    m("footage", "กล้องจับภาพได้", "{ALLY}ดูวิดีโอในกล้อง เห็นเงาดำยืนข้าง{LEAD}", "{ALLY} replays footage on his camera's small screen; his face drains of colour; he slowly lowers the camera and looks at {LEAD}", 2, { say: say("ALLY", "{LEAD} เมื่อกี้มีคนยืนข้างเธอ") }),
    m("reflection", "เงาที่ยิ้ม", "{LEAD}เห็นเงาตัวเองในตู้กระจกยิ้ม ทั้งที่ตัวจริงไม่ได้ยิ้ม", "{LEAD} catches her reflection in the glass cabinet; the reflection smiles slowly while her own face stays frozen", 3, { at: "A", say: say("LEAD", "นั่น... ไม่ใช่ฉัน") }),
    m("footprints", "รอยเท้าเปียก", "รอยเท้าเปียกเดินจากท่าน้ำเข้ามาหาทั้งสอง", "wet bare footprints appear one by one on the wooden floor, walking toward {LEAD} and {ALLY}, with nobody making them", 3, { say: say("ALLY", "มันเดินมาทางเรา") }),
    m("scratch", "รอยข่วน", "{ALLY}ถูกบางอย่างที่มองไม่เห็นข่วนแขน", "{ALLY} gasps and grabs his left forearm as three thin red scratch marks appear on it by themselves", 3, { say: say("ALLY", "โอ๊ย! มีอะไรข่วนผม"), condition: { who: "ALLY", en: "three thin red scratch marks on his left forearm", th: "แขนซ้ายมีรอยข่วนสามเส้น" } }),
  ],
  cliffs: [
    m("c-fall", "ผ้าแดงหลุด", "{OBJ}ล้มลงพื้น ผ้าแดงเลื่อนออกครึ่งหนึ่ง", "with a heavy thud {OBJ} tips over and the red cloth slides half off; slow push-in on the exposed dark glass", 2, { say: say("LEAD", "ไม่นะ...") }),
    m("c-hand", "มือบนไหล่", "มือซีดๆ วางบนไหล่{ALLY}จากด้านหลัง โดยที่เขายังไม่รู้ตัว", "a pale thin hand slowly comes to rest on {ALLY}'s shoulder from behind; he has not noticed yet; hold on his face", 2),
    m("c-door", "ประตูปิดเอง", "ประตูปิดเองดังปังและล็อก ขังทั้งสองไว้", "the door slams shut by itself and the lock clicks; {LEAD} spins around and pulls the handle, it will not open", 2, { say: say("LEAD", "เปิดไม่ออก!") }),
    m("c-behind", "ข้างหลัง", "{RIVAL}ยืนอยู่ชิดหลัง{LEAD} ทั้งที่เมื่อกี้ไม่มีใคร", "{LEAD} turns around and {RIVAL} is suddenly standing right behind her, very close, and speaks softly into her face", 1, { say: say("RIVAL", "หนูมาช้าไปคืนนึงนะ") }),
    m("c-laugh", "เสียงหัวเราะข้างบน", "เสียงหัวเราะเบาๆ ดังมาจากห้องใต้หลังคา", "{LEAD} and {ALLY} look up together as soft laughter echoes from above; dust drifts down from the ceiling boards", 1, { say: say("ALLY", "ข้างบน... มีคนอยู่") }),
    m("c-face", "ใบหน้าในความมืด", "แสงไฟฉายส่องเจอใบหน้าซีดในมุมห้อง แล้วไฟก็ดับ", "the flashlight beam lands on a still pale face in the dark corner for one second, then the light dies to black", 3),
  ],
  beats: {
    OPENING: { title: "บ้านมรดก", at: "A", shots: [
      m("o1", "มาถึง", "{LEAD}กับ{ALLY}มาถึงบ้านมรดกครั้งแรก มี{RIVAL}ยืนรออยู่", "{LEAD} and {ALLY} step into the house for the first time carrying travel bags, looking around; {RIVAL} stands quietly by the stairs watching them; all three faces clearly visible, medium-wide shot", 1, { say: say("ALLY", "บ้านนี้... ได้มาฟรีจริงเหรอ") }),
      m("o2", "กุญแจ", "{RIVAL}ส่งกุญแจให้และเตือนเรื่องห้องใต้หลังคา", "{RIVAL} places an old brass key in {LEAD}'s palm and points up toward the ceiling, speaking gravely", 1, { say: say("RIVAL", "ทำอะไรก็ได้ แต่อย่าขึ้นไปข้างบนหลังตีสาม") }),
      m("o3", "ตีสาม", "ตีสาม {LEAD}ได้ยินเสียงเดินบนเพดาน", "late at night {LEAD} lies awake on a mattress on the floor, eyes wide, as a slow creak moves across the boards above her", 2, { say: say("LEAD", "{ALLY}... ตื่นยัง") }),
    ], cliff: m("o-c", "สิ่งที่หายใจ", "{LEAD}แอบขึ้นห้องใต้หลังคา เห็นผ้าแดงขยับเหมือนมีอะไรหายใจอยู่ข้างใต้", "{LEAD} pushes open the attic hatch with a flashlight; in the beam stands {OBJ}, and the red cloth rises and falls as if something breathes beneath it", 2, { at: "C" }) },
    INCITING: { title: "หลักฐานชิ้นแรก", at: "C", shots: [
      m("i1", "ตั้งกล้อง", "{ALLY}ตั้งกล้องถ่าย{OBJ}ไว้ทั้งคืน", "{ALLY} sets up his camera on a small tripod facing {OBJ} and checks the blinking red recording light", 1, { say: say("ALLY", "คืนนี้ต้องได้หลักฐาน") }),
      m("i2", "ดูวิดีโอ", "เช้าวันต่อมา ทั้งสองนั่งดูวิดีโอด้วยกัน", "morning light; {LEAD} and {ALLY} huddle over the camera screen scrubbing through footage, faces lit by the screen", 1, { at: "A", say: say("LEAD", "หยุดตรงนี้... ซูมเข้าไป") }),
      m("i3", "แอบมอง", "{RIVAL}แอบมองทั้งสองอยู่นอกหน้าต่าง", "through the window behind them {RIVAL} stands outside in the garden watching, then turns and walks away", 1, { at: "A" }),
    ], cliff: m("i-c", "นิ้วในวิดีโอ", "ในวิดีโอ ตีสามตรง มีนิ้วซีดๆ เปิดผ้าแดงจากข้างใน", "{ALLY} holds the camera up between them, his face lit by its small screen: at 3:00 a.m. pale fingers lift the red cloth from inside the mirror; he gasps and drops the camera", 3, { at: "A", say: say("ALLY", "มันออกมาจากในนั้น") }) },
    MIDPOINT: { title: "ความจริงครึ่งเดียว", at: "B", shots: [
      m("mp1", "เผชิญหน้า", "{LEAD}เอาสมุดบันทึกไปถาม{RIVAL}ที่ศาลาท่าน้ำ", "{LEAD} confronts {RIVAL} at the pier pavilion, holding up the old leather diary; {ALLY} stands behind her", 2, { say: say("LEAD", "ป้ารู้มาตลอดใช่ไหม") }),
      m("mp2", "สารภาพ", "{RIVAL}ยอมเล่าความจริงครึ่งหนึ่ง", "{RIVAL} looks out at the dark water for a long moment, the lantern swaying, then speaks without turning around", 1, { say: "REVEAL1" }),
      m("mp3", "เข้าใจผิด", "{ALLY}ถอยหลัง เพิ่งรู้ว่าที่ผ่านมาเข้าใจผิด", "{ALLY} steps back, shaken, rubbing his arm, trying to process what he just heard", 1, { say: say("ALLY", "แปลว่าที่ผ่านมา... เราเข้าใจผิดหมด") }),
    ], cliff: m("mp-c", "น้ำหมุนวน", "น้ำในคลองเริ่มหมุนวนเป็นวงกลม ตะเกียงแกว่งแรง", "behind them the canal water begins to ripple and turn in a slow glowing circle; the lantern swings wildly", 2) },
    CRISIS: { title: "คืนที่ผ้าแดงหลุด", at: "A", shots: [
      m("cr1", "ลมหนาว", "ลมเย็นพัดทั่วบ้าน รูปบนผนังร่วงลงทั้งหมด", "a cold wind tears through the room, photo frames crash down from the wall one after another; {LEAD} shields {ALLY} with her arm", 3),
      m("cr2", "ถูกลาก", "{ALLY}ถูกแรงที่มองไม่เห็นลากถอยหลัง", "{ALLY} is pulled backward across the floorboards by an unseen force, clawing at the boards", 3, { say: say("ALLY", "ช่วยด้วย!") }),
      m("cr3", "จับมือ", "{LEAD}คว้ามือ{ALLY}ไว้สุดแรง", "{LEAD} throws herself down and grabs {ALLY}'s hand with both hands, straining with all her strength", 3, { say: say("LEAD", "จับมือฉันไว้!") }),
    ], cliff: m("cr-c", "หายไป", "{ALLY}ถูกลากหายเข้าความมืดในห้องใต้หลังคา ฝาปิดดังปัง", "{ALLY}'s hand slips away; he vanishes up into the dark attic hatch and it slams shut; {LEAD} alone on the floor", 3, { say: say("LEAD", "{ALLY}!!") }) },
    CLIMAX: { title: "พิธีที่ท่าน้ำ", at: "B", shots: [
      m("cl1", "แบกกระจก", "{LEAD}แบก{OBJ}ฝ่าหมอกไปที่ท่าน้ำ", "at night {LEAD} carries {OBJ} through thick mist onto the pier; {RIVAL} walks beside her holding a candle", 2),
      m("cl2", "แกะผ้า", "{RIVAL}สวดเบาๆ ขณะ{LEAD}ค่อยๆ แกะผ้าแดง", "{RIVAL} speaks softly as {LEAD} slowly unwraps the red cloth, facing the mirror toward the water", 2, { say: "REVEAL2" }),
      m("cl3", "แสง", "แสงสีขาวนวลแผ่จากกระจกไปทั่วผิวน้ำ", "a soft white light spreads from the glass across the canal and the mist begins to part", 2),
    ], cliff: m("cl-c", "ใบหน้าในกระจก", "ในกระจก หญิงสาวคนหนึ่งปรากฏและจ้องมาที่{LEAD}", "in the glass the face of a young woman in old-fashioned clothes appears, looks straight at {LEAD}, and lifts her hand to the glass", 2) },
    FINALE: { title: "กลับบ้าน", at: "B", shots: [
      m("f1", "ต้นกลับมา", "{ALLY}เดินโซเซกลับมา{LEAD}วิ่งเข้าไปกอด", "dawn; {ALLY} stumbles out of the mist onto the pier, dazed but alive, and {LEAD} runs into his arms", 1, { say: say("ALLY", "ผม... กลับมาแล้วใช่ไหม") }),
      m("f2", "ปล่อยวาง", "{LEAD}ค่อยๆ ลอยกระจกลงน้ำ {RIVAL}ยิ้มบางๆ", "at sunrise {LEAD} gently lowers {OBJ} into the calm canal while {RIVAL} watches with a faint smile", 1, { say: "FINAL" }),
      m("f3", "บ้านสงบ", "บ้านไม้เงียบสงบ ทั้งสองนั่งจิบกาแฟหน้าบ้าน", "wide shot at sunrise: the old teak house quiet and warm; {LEAD} and {ALLY} sit on the front steps sharing coffee as {RIVAL} walks away down the lane", 1, { at: "A", say: say("LEAD", "บ้านหลังนี้... เป็นของเราแล้วจริงๆ") }),
    ] },
  },
};

const ACTION: GenreKit = {
  genre: "ACTION",
  style: "Photorealistic Thai action thriller, cinematic anamorphic look, neon night city, high contrast, handheld energy, dynamic but readable camera moves",
  sound: "city ambience, motorbike engines, footsteps, punchy impacts; no music score",
  hashtags: ["#ละครสั้น", "#แอ็กชัน", "#ไรเดอร์", "#ละครไทย"],
  premise: {
    key: "action-last-parcel", title: "พัสดุชิ้นสุดท้าย",
    logline: "ไรเดอร์ส่งของธรรมดารับพัสดุกล่องดำกลางดึก แล้วทั้งเมืองก็เริ่มไล่ล่าเขา",
    cast: [
      { role: "LEAD", name: "เจ", nameEn: "Jay", age: "28-year-old Thai man", look: "lean and athletic, short black undercut, a thin scar through his right eyebrow",
        outfit: "a black-and-orange delivery rider jacket, black jeans and scuffed white sneakers", voice: "calm, low, clipped male voice",
        trait: "นิ่ง ใจถึง", want: "อยากส่งของให้ถึงมือผู้รับ", secret: "พี่ชายหายตัวไปเมื่อสามปีก่อน" },
      { role: "ALLY", name: "ฟ้า", nameEn: "Fah", age: "25-year-old Thai woman", look: "sharp-eyed, a high black ponytail dyed teal at the tips",
        outfit: "an olive bomber jacket over a black tank top and fingerless gloves", voice: "fast, confident, teasing female voice",
        trait: "ฉลาด ปากไว", want: "อยากเปิดโปงคนที่ทำให้อู่ของพ่อเจ๊ง", secret: "เคยทำงานแฮกให้แก๊งเสือ" },
      { role: "RIVAL", name: "เสือ", nameEn: "Suea", age: "40-year-old Thai man", look: "broad-shouldered, shaved head, a heavy silver tiger ring",
        outfit: "a charcoal suit with an open collar and no tie", voice: "deep, slow, gravelly male voice",
        trait: "เยือกเย็น อันตราย", want: "อยากได้กล่องคืนก่อนเช้า", secret: "ฟอกเงินผ่านมูลนิธิเด็ก" },
    ],
    places: [
      { key: "A", name: "ซอยตลาดกลางคืน", look: "a narrow neon-lit Bangkok night-market alley with red lanterns, steam from food stalls and wet asphalt reflections" },
      { key: "B", name: "อู่ซ่อมรถของฟ้า", look: "a cluttered motorcycle garage under a concrete flyover, hanging tools, a half-built motorbike, one flickering fluorescent tube" },
      { key: "C", name: "ดาดฟ้าตึกร้าง", look: "the windy rooftop of an unfinished concrete tower above the Bangkok skyline at night, exposed rebar and a blinking crane light" },
      { key: "D", name: "ตรอกหลังตึกแถว", look: "a narrow back lane behind old Bangkok shophouses at night, dripping air-conditioner units, drainpipes, metal back doors, blue water drums and puddles" },
      { key: "E", name: "ร้านก๋วยเตี๋ยวที่ปิดแล้ว", look: "the inside of a closed Thai shophouse noodle shop at night, a steel noodle counter with big soup pots, stacked folding tables and plastic stools, one bare hanging bulb, a half-closed roller shutter" },
      { key: "F", name: "ถนนใต้ทางด่วน", look: "an empty wet road under a Bangkok elevated expressway at night, huge concrete pillars, orange sodium street lights and long shadows" },
      { key: "G", name: "ท่าเรือไม้ริมแม่น้ำ", look: "an old covered wooden pier on the Chao Phraya river at night, moored longtail boats, pier lamps and city lights shimmering on the water" },
      { key: "H", name: "ลานจอดรถใต้ดินร้าง", look: "an abandoned underground car park, bare concrete pillars, dusty abandoned cars, flickering ceiling lights and a ramp up to the street" },
      { key: "I", name: "บันไดตึกร้าง", look: "the bare concrete stairwell of an unfinished tower, construction lamps swinging on cables, cement bags on the landings, open window gaps" },
      { key: "J", name: "นั่งร้านข้างตึก", look: "steel scaffolding bolted to the outside of an unfinished tower high above Bangkok at night, plank walkways, safety netting flapping in the wind, a red crane light above" },
    ],
    object: { name: "กล่องพัสดุสีดำ", look: "a small black parcel box bound with a red strap" },
    truth: "ในกล่องคือหลักฐานว่าเสือฟอกเงินผ่านมูลนิธิเด็ก และคนที่ส่งกล่องนี้คือพี่ชายของเจที่ยังมีชีวิตอยู่",
    ending: "เจกับฟ้าส่งหลักฐานถึงนักข่าวทันเวลา เสือถูกจับ และเจได้เจอพี่ชายอีกครั้ง",
    reveal1: say("ALLY", "ไฟล์ในกล่องนี้... มีชื่อพี่ชายนายอยู่ด้วย"),
    reveal2: say("RIVAL", "พี่ชายแกส่งมันมาเอง เพราะรู้ว่าแกไม่ยอมแพ้"),
    finalLine: say("LEAD", "พัสดุชิ้นสุดท้าย... ส่งถึงมือแล้วครับ"),
  },
  season: ACTION_LAST_PARCEL_SEASON,
  hooks: [say("LEAD", "ไม่มีเวลาแล้ว ไปต่อ"), say("ALLY", "เจ! ทางนี้!"), say("LEAD", "ใครส่งพวกมันมา"), say("ALLY", "ฉันหาทางออกให้เอง"), say("LEAD", "จับไว้แน่นๆ")],
  moves: [
    m("chase", "วิ่งหนี", "{LEAD}วิ่งหนีลูกน้อง{RIVAL}ฝ่าแผงลอยในตลาด", "{LEAD} sprints through the crowded night market clutching {OBJ}, ducking under hanging lanterns as men in black jackets push through behind him", 2, { at: "A", say: say("LEAD", "หลบหน่อยครับ!") }),
    m("hack", "เจาะกล้อง", "{ALLY}เจาะระบบกล้องวงจรปิดหาทางหนี", "{ALLY} taps fast on her wrist tablet, CCTV feeds flickering across its screen, then grins", 1, { at: "B", say: say("ALLY", "เจอแล้ว ทางหนีไฟฝั่งซ้าย") }),
    m("repair", "ซ่อมรถ", "ทั้งสองรีบซ่อมมอเตอร์ไซค์ก่อนศัตรูมาถึง", "{LEAD} and {ALLY} work fast on the half-built motorbike, sparks flying, tools clattering", 1, { at: "B", say: say("ALLY", "อีกสองนาที ถ้าไม่ระเบิดก่อนนะ") }),
    m("decoy", "กล่องปลอม", "{LEAD}สลับกล่องปลอมหลอกลูกน้อง{RIVAL}", "{LEAD} quietly swaps {OBJ} for an identical empty box and slides the real one under a food stall cart", 1, { at: "A", say: say("LEAD", "เอาไปสิ ถ้าอยากได้") }),
    m("tracker", "ตัวติดตาม", "{ALLY}พบเครื่องติดตามซ่อนอยู่ในเสื้อ{LEAD}", "{ALLY} pulls a tiny blinking tracker out of the collar of {LEAD}'s jacket and holds it up between two fingers", 2, { say: say("ALLY", "มันตามเรามาตลอด") }),
    m("ambush", "ซุ่มโจมตี", "{LEAD}ถูกซุ่มดักในซอย ต้องสู้มือเปล่า", "two men in black jackets block the alley; {LEAD} drops into a stance and fights them off with fast bare-handed moves", 3, { at: "A" }),
    m("shoulder", "บาดเจ็บ", "{LEAD}ไหล่บาดเจ็บระหว่างหนี", "{LEAD} slams into a metal shutter while escaping, clutches his right shoulder and grits his teeth", 3, { say: say("LEAD", "ไม่เป็นไร... ยังไหว"), condition: { who: "LEAD", en: "a torn right sleeve and a bandaged right shoulder", th: "ไหล่ขวาพันผ้า แขนเสื้อขาด" } }),
    m("call", "สายจากเสือ", "{RIVAL}โทรมาขู่ด้วยน้ำเสียงเรียบ", "{LEAD} answers a ringing phone and listens as a calm deep voice speaks on the other end; his jaw tightens", 2, { say: say("RIVAL", "ส่งกล่องมา แล้วแกจะได้ใช้ชีวิตต่อ") }),
    m("rooftop", "บนดาดฟ้า", "ทั้งสองหนีขึ้นดาดฟ้าตึกร้าง", "{LEAD} and {ALLY} burst out onto the windy rooftop, breathing hard, the city lights spread below them", 2, { at: "C", say: say("ALLY", "ทางตันแล้ว!") }),
    m("ride", "ซิ่งหนี", "{LEAD}ซิ่งมอเตอร์ไซค์ฝ่าการจราจร โดยมี{ALLY}ซ้อนท้าย", "{LEAD} weaves the motorbike through night traffic with {ALLY} riding behind him, neon streaking past", 2, { say: say("ALLY", "เร็วกว่านี้อีก!") }),
  ],
  cliffs: [
    m("c-surround", "ถูกล้อม", "ไฟฉายหลายดวงสาดมาจากทุกทิศ ทั้งสองถูกล้อม", "flashlight beams snap on from every direction; {LEAD} and {ALLY} stand back to back, surrounded", 3, { say: say("LEAD", "อยู่ข้างหลังฉัน") }),
    m("c-grab", "ฟ้าถูกจับ", "มือใหญ่ลากตัว{ALLY}หายเข้าไปในรถตู้", "a van door slides open and a big hand yanks {ALLY} inside; the door slams and the van speeds off as {LEAD} runs after it", 3, { say: say("LEAD", "ฟ้า!") }),
    m("c-ring", "แหวนเสือ", "{RIVAL}ก้าวออกมาจากเงา แหวนเสือเงินวาวในแสงไฟ", "{RIVAL} steps out of the shadows slowly, his silver tiger ring catching the light, and smiles", 2, { say: say("RIVAL", "เหนื่อยหรือยัง") }),
    m("c-box", "กล่องเปิด", "กล่องพัสดุตกพื้นเปิดออก เห็นแฟลชไดรฟ์กับรูปถ่ายใบหนึ่ง", "{OBJ} hits the ground and pops open, revealing a flash drive and an old photo of two brothers; {LEAD} stares at it", 2, { say: say("LEAD", "นี่มัน... รูปพี่ผม") }),
    m("c-edge", "ขอบตึก", "{LEAD}ห้อยตัวจากขอบตึก มือเริ่มลื่น", "{LEAD} hangs from the rooftop edge by one hand, fingers slipping on wet concrete, the city far below", 3),
    m("c-sirens", "ไซเรน", "ไฟไซเรนสีแดงน้ำเงินสาดเข้ามา แต่คนที่ลงจากรถคือคนของ{RIVAL}", "red and blue lights flood the street; a car stops, but the man who steps out wears {RIVAL}'s silver tiger ring", 2),
  ],
  beats: {
    OPENING: { title: "งานส่งตอนตีหนึ่ง", at: "A", shots: [
      m("o1", "รับงาน", "{LEAD}รับพัสดุจากชายปริศนา {ALLY}ทักจากร้านข้างๆ {RIVAL}มองอยู่ในรถ", "{LEAD} on his motorbike takes {OBJ} from a hooded stranger in the neon alley; {ALLY} waves at him from a nearby stall; {RIVAL} watches from a parked black car; all three faces clearly visible, medium-wide shot", 1, { say: say("ALLY", "ตีหนึ่งยังรับงานอีกเหรอ") }),
      m("o2", "ที่อยู่แปลก", "ที่อยู่ปลายทางคือดาดฟ้าตึกร้าง", "{LEAD} reads the delivery label on {OBJ}; the address is only GPS coordinates; he frowns", 1, { say: say("LEAD", "ส่งที่ดาดฟ้า... ตอนตีสอง?") }),
      m("o3", "ถูกตาม", "รถสีดำเริ่มขับตาม{LEAD}", "{LEAD} rides through the night streets; in his mirror a black car turns its headlights on and follows", 2),
    ], cliff: m("o-c", "ดักหน้า", "รถสีดำปาดหน้า ลูกน้องเสือลงมาล้อม", "the black car swerves in front of {LEAD}'s bike and stops; doors open; men in black jackets step out", 3, { say: say("LEAD", "เอาจริงดิ") }) },
    INCITING: { title: "อู่ของฟ้า", at: "B", shots: [
      m("i1", "หนีเข้าอู่", "{LEAD}หนีมาซ่อนที่อู่ของ{ALLY}", "{LEAD} rolls his bike into the garage under the flyover; {ALLY} pulls the shutter down behind him", 2, { say: say("ALLY", "นายไปก่อเรื่องอะไรมา") }),
      m("i2", "สแกนกล่อง", "{ALLY}สแกนกล่องพบว่ามีข้อมูลเข้ารหัส", "{ALLY} runs a scanner over {OBJ}; lines of encrypted code scroll on her tablet", 1, { say: say("ALLY", "ของนี่ไม่ใช่ของธรรมดา") }),
      m("i3", "ตัดสินใจ", "{LEAD}ตัดสินใจจะส่งของให้ถึงที่หมาย", "{LEAD} picks up {OBJ}, tightens his gloves and looks at {ALLY} with quiet resolve", 1, { say: say("LEAD", "ผมรับงานแล้ว ผมต้องส่ง") }),
    ], cliff: m("i-c", "ประตูเหล็ก", "ประตูเหล็กของอู่ถูกกระแทกอย่างแรงจากด้านนอก", "BANG — the metal shutter dents inward from a heavy blow outside; {LEAD} and {ALLY} spin toward it", 3) },
    MIDPOINT: { title: "ชื่อในไฟล์", at: "B", shots: [
      m("mp1", "ถอดรหัส", "{ALLY}ถอดรหัสไฟล์ได้สำเร็จ", "{ALLY} hits enter; the tablet screen fills with documents and photos; her face changes", 2),
      m("mp2", "ชื่อพี่ชาย", "{ALLY}บอกความจริงที่เจอในไฟล์", "{ALLY} turns the tablet toward {LEAD}, speaking carefully", 1, { say: "REVEAL1" }),
      m("mp3", "ช็อก", "{LEAD}นิ่งไป มือสั่น", "{LEAD} stares at the screen, his hands trembling, then clenches his fists", 1, { say: say("LEAD", "เขายังมีชีวิตอยู่...") }),
    ], cliff: m("mp-c", "ฟ้าคือคนใน", "ข้อความเด้งขึ้น เปิดโปงว่า{ALLY}เคยทำงานให้{RIVAL}", "a message pops up on the tablet showing {ALLY}'s photo with {RIVAL}'s gang; {LEAD} slowly looks up at her", 2, { say: say("LEAD", "เธอเคยอยู่กับมัน?") }) },
    CRISIS: { title: "เสียทุกอย่าง", at: "A", shots: [
      m("cr1", "ไฟไหม้อู่", "อู่ของ{ALLY}ถูกเผา ทั้งสองหนีออกมาได้หวุดหวิด", "orange flames light up the alley as {LEAD} and {ALLY} stumble out of the burning garage, coughing", 3),
      m("cr2", "ทะเลาะ", "{LEAD}กับ{ALLY}ปะทะคารมเรื่องความลับ", "in the rain {LEAD} and {ALLY} face each other, angry and hurt", 2, { say: say("ALLY", "ฉันออกมาแล้ว! ถึงช่วยนายอยู่นี่ไง") }),
      m("cr3", "เดินแยก", "{LEAD}เดินจากไปคนเดียว", "{LEAD} turns his back and walks away alone into the rain with {OBJ} under his jacket", 2),
    ], cliff: m("cr-c", "เสือได้กล่อง", "{RIVAL}ดักรอ{LEAD}อยู่ปลายซอย และยื่นมือมา", "at the end of the alley {RIVAL} waits under a single street lamp, men behind him, holding out his hand", 3, { say: say("RIVAL", "จบแล้วไอ้หนู") }) },
    CLIMAX: { title: "ดาดฟ้าตีสอง", at: "C", shots: [
      m("cl1", "เผชิญหน้า", "{LEAD}พบ{RIVAL}บนดาดฟ้า", "on the windy rooftop {LEAD} faces {RIVAL}, holding {OBJ} out over the edge", 3, { say: say("LEAD", "ถอยไป ไม่งั้นมันตกลงไป") }),
      m("cl2", "ความจริง", "{RIVAL}เผยความจริงเรื่องพี่ชาย", "{RIVAL} laughs quietly and steps closer, the crane light blinking red behind him", 2, { say: "REVEAL2" }),
      m("cl3", "ฟ้ากลับมา", "{ALLY}โผล่มาจากบันไดหนีไฟพร้อมสัญญาณถ่ายทอดสด", "{ALLY} bursts up from the fire stairs holding her tablet high, a live-stream recording light glowing", 3, { say: say("ALLY", "ทั้งเมืองกำลังดูแกอยู่ เสือ") }),
    ], cliff: m("cl-c", "ล้มลง", "{RIVAL}พุ่งเข้าหา{LEAD} ทั้งคู่ล้มไปที่ขอบตึก", "{RIVAL} lunges at {LEAD}; they both crash toward the rooftop edge", 3) },
    FINALE: { title: "ส่งถึงมือ", at: "C", shots: [
      m("f1", "เสือถูกจับ", "ตำรวจตัวจริงมาถึง ใส่กุญแจมือ{RIVAL}", "dawn on the rooftop; real police officers handcuff {RIVAL} as he glares at {LEAD}", 1),
      m("f2", "พบพี่", "ชายคนหนึ่งเดินขึ้นมา—พี่ชายของ{LEAD}", "{LEAD} turns as a man in a hooded jacket climbs onto the roof and lowers his hood; {LEAD}'s eyes fill with tears", 1, { say: "FINAL" }),
      m("f3", "ออกเดินทาง", "{LEAD}กับ{ALLY}ขี่มอเตอร์ไซค์ออกไปกลางแสงเช้า", "sunrise over Bangkok; {LEAD} rides his motorbike down an empty street with {ALLY} behind him, both smiling", 1, { at: "A", say: say("ALLY", "งานต่อไปส่งที่ไหนดี") }),
    ] },
  },
};

const COMEDY: GenreKit = {
  genre: "COMEDY",
  style: "Photorealistic Thai sitcom-style comedy, bright warm daylight, saturated colours, clean framing, snappy camera, expressive faces",
  sound: "busy street ambience, sizzling pots, comedic timing pauses; no music score",
  hashtags: ["#ละครสั้น", "#ตลก", "#ข้าวมันไก่", "#ละครไทย"],
  premise: {
    key: "comedy-chicken-rice", title: "หม้อซุปสูตรลับ",
    logline: "เจ้าของร้านข้าวมันไก่ห้องแถวต้องสู้กับแฟรนไชส์หรูตรงข้ามร้าน ที่อยากได้หม้อซุปสูตรลับของยายเพลิน",
    cast: [
      { role: "LEAD", name: "โบ้", nameEn: "Bo", age: "30-year-old Thai man", look: "chubby and cheerful, round face, buzz cut, thick eyebrows",
        outfit: "a white chef jacket with sleeves rolled up and a red bandana on his head", voice: "loud, bright, excitable male voice",
        trait: "ใจดี ซื่อ ตื่นตูม", want: "อยากให้ร้านของยายอยู่รอด", secret: "ทำข้าวมันไก่ไม่อร่อยเท่ายาย" },
      { role: "ALLY", name: "ยายเพลิน", nameEn: "Grandma Ploen", age: "tiny 72-year-old Thai grandmother", look: "curly white hair, big round glasses, energetic posture",
        outfit: "a floral blouse, a striped apron and pink rubber slippers", voice: "sharp, crackly, bossy old female voice",
        trait: "ดุ ปากร้าย ใจดี", want: "อยากให้โบ้เป็นพ่อครัวตัวจริง", secret: "สูตรลับไม่ได้อยู่ในหม้อ" },
      { role: "RIVAL", name: "ริชชี่", nameEn: "Richie", age: "32-year-old Thai man", look: "slick gelled hair, thin moustache, a too-white smile",
        outfit: "a shiny lilac suit and gold sunglasses pushed up on his head", voice: "smooth, nasal, smug male voice",
        trait: "ขี้อวด ขี้โกง", want: "อยากได้สูตรลับไปทำแฟรนไชส์", secret: "เป็นหลานที่ยายเพลินตัดขาดไป" },
    ],
    places: [
      { key: "A", name: "ร้านข้าวมันไก่ห้องแถว", look: "a tiny Bangkok shophouse chicken-rice stall with a steel counter, boiled chickens hanging behind glass, red plastic stools and rising steam" },
      { key: "B", name: "ร้านแฟรนไชส์ตรงข้าม", look: "a flashy new franchise restaurant across the street with purple neon signage, gold chairs and a giant chicken mascot statue" },
      { key: "C", name: "เวทีประกวดอาหาร", look: "a small market cooking-competition stage with a red banner, two cooking stations and rows of folding chairs" },
      { key: "D", name: "ทางเท้าหน้าร้าน", look: "the busy Bangkok sidewalk in front of the little chicken-rice shophouse, a striped awning, parked motorbikes, and the purple-neon franchise right across the narrow street" },
      { key: "E", name: "ครัวหลังร้าน", look: "the cramped back kitchen of the shophouse stall, a big gas stove with dented pots, a deep steel sink, a rice cooker on a shelf of jars, a serving hatch to the front and a back door to a little yard" },
      { key: "F", name: "ลานหลังร้าน", look: "a tiny walled yard behind the shophouse, potted pandan and herb plants, a washing line, a drain in the wet concrete and an upturned bucket" },
      { key: "G", name: "ตลาดสด", look: "a bustling Bangkok wet market, aisles of vegetable stalls piled with ginger, garlic and herbs, hanging lamps and a wet concrete floor" },
      { key: "H", name: "หลังเวทีประกวด", look: "the cramped backstage area behind the market cooking stage, stacked gas canisters, crates of vegetables, folding tables and a red curtain" },
    ],
    object: { name: "หม้อซุปสูตรลับ", look: "a battered old aluminium soup pot with a dented lid tied shut with string" },
    truth: "หม้อซุปเป็นหม้อเปล่า สูตรลับคือยายแอบใส่ใบเตยทุกเช้า และริชชี่คือหลานแท้ๆ ที่ยายไม่ได้คุยด้วยมาสิบปี",
    ending: "โบ้ชนะการประกวดด้วยฝีมือตัวเอง ริชชี่คืนดีกับยาย สองร้านรวมเป็นร้านเดียว",
    reveal1: say("ALLY", "หม้อนั่นน่ะ หม้อเปล่า! สูตรอยู่ในหัวยายคนเดียว"),
    reveal2: say("RIVAL", "ยายครับ ผมก็แค่อยากให้ยายภูมิใจ"),
    finalLine: say("ALLY", "จานนี้ ยายให้เต็มสิบ"),
  },
  season: COMEDY_CHICKEN_RICE_SEASON,
  hooks: [say("LEAD", "เดี๋ยวๆๆ ใจเย็นก่อน"), say("ALLY", "โบ้! ยืนเซ่ออยู่ทำไม"), say("LEAD", "แผนนี้ต้องรอด รอดแน่นอน"), say("ALLY", "ยายบอกแล้วไม่เชื่อ"), say("LEAD", "โอเค... แผนสอง")],
  moves: [
    m("spy", "สายลับข้าวมันไก่", "{LEAD}ปลอมตัวไปสอดแนมร้านของ{RIVAL}", "{LEAD} sneaks into the franchise restaurant wearing a fake moustache and sunglasses, hiding badly behind a menu", 1, { at: "B", say: say("LEAD", "ไม่มีใครจำผมได้แน่นอน") }),
    m("grandma-slap", "ยายตีหัว", "ยายเพลินเอาทัพพีเคาะหัว{LEAD}", "{ALLY} smacks {LEAD} on the head with a wooden ladle; he yelps and rubs his head", 1, { at: "A", say: say("ALLY", "ไก่ต้มยังไม่สุก จะไปไหน!") }),
    m("mascot", "มาสคอตไก่", "{RIVAL}จ้างมาสคอตไก่ยักษ์มาเต้นยั่วหน้าร้าน", "a giant chicken mascot dances aggressively right outside the little stall while {RIVAL} waves from across the street", 1, { at: "A", say: say("RIVAL", "ลูกค้ามาทางนี้ครับ ทางนี้!") }),
    m("taste", "ชิมแล้วหน้าเหยเก", "{LEAD}ชิมน้ำซุปที่ตัวเองทำแล้วหน้าเหยเก", "{LEAD} proudly sips his own soup, then his face scrunches up and he forces a big fake smile", 1, { at: "A", say: say("LEAD", "อร่อย... อร่อยมากเลยครับ") }),
    m("steal", "ขโมยหม้อ", "ลูกน้อง{RIVAL}แอบมาขโมยหม้อ แต่หยิบหม้อผิดใบ", "a clumsy man in a lilac uniform tiptoes into the stall and grabs the wrong pot, a pot full of dirty dishwater", 2, { at: "A" }),
    m("slip", "ลื่นล้ม", "{LEAD}ลื่นน้ำมันหกล้มกลางร้าน ข้าวกระจาย", "{LEAD} slips on spilled oil, flails his arms and lands on his back as rice flies everywhere", 2, { at: "A", say: say("LEAD", "ไม่เป็นไรครับ! ตั้งใจล้ม!") }),
    m("review", "รีวิวเวอร์", "นักรีวิวชื่อดังมาที่ร้าน ทุกคนแตกตื่น", "{LEAD} and {ALLY} freeze as a famous food reviewer with a ring light walks into the stall", 2, { at: "A", say: say("ALLY", "ยิ้ม! ยิ้มไว้!") }),
    m("burn", "ข้าวไหม้", "{LEAD}ลืมหม้อข้าวจนไหม้ ควันโขมง", "black smoke pours from the rice cooker as {LEAD} waves a towel frantically and {ALLY} glares", 2, { at: "A", say: say("ALLY", "ไหม้ทั้งหม้อเลยเหรอโบ้!"), condition: { who: "LEAD", en: "soot smudges on his cheeks and chef jacket", th: "หน้าเปื้อนเขม่า" } }),
    m("bribe", "ติดสินบน", "{RIVAL}ยื่นซองเงินให้ยายเพลินซื้อสูตร", "{RIVAL} slides a thick envelope across the counter with a smug smile; {ALLY} stares at it, unimpressed", 1, { at: "A", say: say("RIVAL", "ยายครับ เงินก้อนนี้ซื้อสูตรได้ไหม") }),
    m("practice", "ซ้อมทำอาหาร", "{LEAD}ซ้อมสับไก่จนมือเป็นระวิง", "{LEAD} practises chopping chicken at lightning speed with intense focus while {ALLY} times him with a stopwatch", 1, { at: "A", say: say("ALLY", "ช้าไป! อีกรอบ!") }),
  ],
  cliffs: [
    m("c-pot-gone", "หม้อหาย", "หม้อซุปหายไปจากเตา เหลือแต่เชือก", "{LEAD} turns around and the stove is empty; only a piece of string remains where {OBJ} was; his jaw drops", 2, { say: say("LEAD", "หม้อ... หม้อยายหายยยย!") }),
    m("c-faint", "ยายเป็นลม", "ยายเพลินทำท่าเป็นลมกลางร้าน", "{ALLY} clutches her chest dramatically and collapses onto a plastic stool; {LEAD} panics", 2, { say: say("LEAD", "ยาย! ยายอย่าเพิ่งไป!") }),
    m("c-poster", "โปสเตอร์ประกวด", "{RIVAL}ติดโปสเตอร์ท้าประกวดหน้าร้าน", "{RIVAL} slaps a big poster on the stall's glass: a cooking-battle challenge with his face on it, and winks", 1, { say: say("RIVAL", "แพ้... ต้องปิดร้านนะครับ") }),
    m("c-rain", "ฝนตก", "ฝนเทลงมาเหมือนฟ้ารั่ว พอดีกับลูกค้ากลุ่มใหญ่มาถึง", "a huge downpour hits just as a whole tour bus of customers arrives at the tiny stall; {LEAD} stares at the crowd", 1, { say: say("LEAD", "ห้าสิบคน... มีไก่สามตัว") }),
    m("c-video", "คลิปไวรัล", "คลิป{LEAD}ล้มกลายเป็นไวรัล คนแห่มาดู", "{LEAD} looks at his phone in horror: a viral clip of himself falling, the view count racing up", 1, { say: say("LEAD", "ล้านวิว!? ทำไมต้องเป็นคลิปนี้") }),
    m("c-photo", "รูปเก่า", "{LEAD}เจอรูปเก่าที่ยายกอดเด็กผู้ชายหน้าเหมือน{RIVAL}", "{LEAD} finds an old photo behind the counter: young {ALLY} hugging a little boy with the same smug smile as {RIVAL}", 1, { say: say("LEAD", "เดี๋ยวนะ... นี่มันริชชี่ตอนเด็ก?") }),
  ],
  beats: {
    OPENING: { title: "ศึกฝั่งถนน", at: "A", shots: [
      m("o1", "เปิดร้าน", "เช้าวันแรกที่ร้านแฟรนไชส์ตรงข้ามเปิด", "morning at the little stall: {LEAD} and {ALLY} stand behind the counter staring across the street, where {RIVAL} cuts a ribbon in front of his flashy franchise and waves at them; all three faces clearly visible, medium-wide shot", 1, { say: say("ALLY", "ไอ้เด็กเสื้อม่วงนั่นใครวะ") }),
      m("o2", "ลูกค้าหาย", "ลูกค้าประจำเดินผ่านร้านไปอีกฝั่ง", "the regular customers walk right past the stall toward the neon franchise; {LEAD} waves a menu desperately", 1, { say: say("LEAD", "ป้าครับ! ข้าวมันไก่ครับ!") }),
      m("o3", "ข้อเสนอ", "{RIVAL}มาที่ร้านเสนอซื้อหม้อซุป", "{RIVAL} strolls into the stall, lifts his sunglasses and points at {OBJ} on the stove", 1, { say: say("RIVAL", "ผมขอซื้อหม้อใบนี้ หนึ่งล้าน") }),
    ], cliff: m("o-c", "ยายตอบ", "ยายเพลินเงียบไปนานก่อนจะตอบ", "{ALLY} slowly puts down her ladle and stares at {RIVAL} for a long, tense moment; {LEAD} gulps", 1, { say: say("ALLY", "สองล้าน") }) },
    INCITING: { title: "ยายไม่ขาย", at: "A", shots: [
      m("i1", "ล้อเล่น", "ยายบอกว่าล้อเล่น และไล่{RIVAL}ออกไป", "{ALLY} bursts out laughing and shoos {RIVAL} out of the stall with a broom", 1, { say: say("ALLY", "ล้อเล่น! ไม่ขาย! ไปๆๆ") }),
      m("i2", "คำสั่งยาย", "ยายสั่งให้{LEAD}ห้ามห่างหม้อแม้แต่วินาทีเดียว", "{ALLY} grabs {LEAD} by the ear and points at {OBJ}", 1, { say: say("ALLY", "ตั้งแต่วันนี้ แกนอนกับหม้อใบนี้") }),
      m("i3", "นอนกับหม้อ", "{LEAD}นอนกอดหม้อซุปในร้านทั้งคืน", "night: {LEAD} sleeps on two plastic stools hugging {OBJ} like a teddy bear, snoring", 1, { say: say("LEAD", "หม้อจ๋า... อย่าไปไหนนะ") }),
    ], cliff: m("i-c", "เงาตะคุ่ม", "มีเงาตะคุ่มค่อยๆ เลื่อนประตูเหล็กของร้านขึ้น", "the metal shutter slowly rises a few inches and a pair of shiny lilac shoes steps inside; {LEAD} keeps snoring", 2) },
    MIDPOINT: { title: "หม้อเปล่า", at: "A", shots: [
      m("mp1", "เปิดหม้อ", "{LEAD}แอบแกะเชือกเปิดหม้อดูเป็นครั้งแรก", "{LEAD} nervously unties the string and lifts the lid of {OBJ}; he peers inside and blinks", 1),
      m("mp2", "ยายสารภาพ", "ยายเพลินเฉลยว่าหม้อเปล่า", "{ALLY} walks in, sees him, sighs, and folds her arms", 1, { say: "REVEAL1" }),
      m("mp3", "งง", "{LEAD}งงจนพูดไม่ออก", "{LEAD} stares into the empty pot, then at {ALLY}, then into the pot again, utterly confused", 1, { say: say("LEAD", "แล้วที่ผมนอนกอดมาสามคืน...") }),
    ], cliff: m("mp-c", "แอบฟัง", "{RIVAL}แอบฟังอยู่หลังหน้าต่างและได้ยินทั้งหมด", "outside the window {RIVAL} lowers his sunglasses, having heard everything, and smirks", 1, { say: say("RIVAL", "งั้นต้องได้ตัวยาย") }) },
    CRISIS: { title: "วันที่ยายไม่อยู่", at: "A", shots: [
      m("cr1", "ยายหาย", "ยายเพลินถูก{RIVAL}พาไปเที่ยวทะเลสามวัน", "{LEAD} reads a note taped to the counter, his face falling: Grandma has gone on a seaside trip, paid by Richie", 2, { say: say("LEAD", "สามวัน! ก่อนประกวดพอดี!") }),
      m("cr2", "ทำเอง", "{LEAD}ต้องต้มซุปเองครั้งแรก", "{LEAD} stands alone in the steamy stall, sleeves rolled, staring at a pile of ingredients with terror", 2),
      m("cr3", "ล้มเหลว", "ซุปที่ทำออกมาจืดสนิท", "{LEAD} tastes the soup, sighs, and sits on the floor with his head in his hands", 2, { say: say("LEAD", "ผมทำไม่ได้หรอก") }),
    ], cliff: m("cr-c", "ใบเตย", "ลมพัดใบเตยหอมจากกระถางหลังร้านมาตกในหม้อพอดี", "a gust of wind blows a pandan leaf from a pot plant into the soup; {LEAD} sniffs the air and slowly looks up", 1, { say: say("LEAD", "กลิ่นนี้... กลิ่นซุปยาย!") }) },
    CLIMAX: { title: "ศึกชิงเตา", at: "C", shots: [
      m("cl1", "เริ่มประกวด", "การประกวดเริ่ม {LEAD}กับ{RIVAL}ทำอาหารแข่งกัน", "on the market stage {LEAD} and {RIVAL} cook side by side at two stations as the crowd cheers", 2, { say: say("RIVAL", "ยอมแพ้ตอนนี้ยังทันนะ") }),
      m("cl2", "ยายมา", "ยายเพลินกลับมาทันเวลา ยืนดูจากแถวหน้า", "{ALLY} pushes through the crowd in a sun hat and sits in the front row, arms crossed, watching {LEAD}", 1),
      m("cl3", "สารภาพ", "{RIVAL}เห็นยายแล้วหยุดทำอาหาร", "{RIVAL} sees {ALLY}, puts down his knife and steps forward, suddenly emotional", 2, { say: "REVEAL2" }),
    ], cliff: m("cl-c", "ประกาศผล", "กรรมการกำลังจะประกาศผล", "the judge raises the microphone; {LEAD} squeezes his eyes shut; {RIVAL} holds {ALLY}'s hand", 1) },
    FINALE: { title: "ร้านเดียวกัน", at: "A", shots: [
      m("f1", "ชนะ", "{LEAD}ชนะ ยายกอดหลานทั้งสองคน", "confetti falls; {ALLY} pulls both {LEAD} and {RIVAL} into a tight hug as the crowd claps", 1, { at: "C", say: "FINAL" }),
      m("f2", "รวมร้าน", "ป้ายใหม่ขึ้น: สองร้านรวมเป็นร้านเดียว", "a new sign is hung over the stall combining both names; {LEAD} and {RIVAL} hold the ladder together", 1, { say: say("RIVAL", "เอียงซ้ายนิดนึงครับพี่") }),
      m("f3", "คิวยาว", "คิวลูกค้ายาวเหยียดหน้าร้าน", "wide shot: a long happy queue outside the little stall; {LEAD} serves plates, {ALLY} counts money, {RIVAL} takes orders", 1, { say: say("LEAD", "ข้าวมันไก่ได้แล้วคร้าบบบ") }),
    ] },
  },
};

const ROMANCE: GenreKit = {
  genre: "ROMANCE",
  style: "Photorealistic Thai romantic drama, soft golden-hour light, shallow depth of field, warm pastel colour grade, gentle handheld camera",
  sound: "soft city evening ambience, rain on windows, cafe clatter; no music score",
  hashtags: ["#ละครสั้น", "#โรแมนติก", "#ละครรัก", "#ละครไทย"],
  premise: {
    key: "romance-balcony-notes", title: "โน้ตข้ามระเบียง",
    logline: "นักวาดภาพขี้อายกับหนุ่มเจ้าของคาเฟ่ข้างห้องคุยกันผ่านโน้ตที่ส่งข้ามระเบียง โดยไม่รู้ว่าอีกฝ่ายคือใคร",
    cast: [
      { role: "LEAD", name: "ใบเตย", nameEn: "Baitoey", age: "26-year-old Thai woman", look: "petite, long wavy dark-brown hair, a tiny nose ring, ink-stained fingers",
        outfit: "a cream knit sweater, a long denim skirt and a canvas tote bag", voice: "warm, gentle, slightly shy female voice",
        trait: "ขี้อาย ช่างฝัน", want: "อยากรู้ว่าใครส่งโน้ตเพลงมาทุกคืน", secret: "วาดรูปผู้ชายข้างห้องไว้เต็มสมุด" },
      { role: "ALLY", name: "ภูมิ", nameEn: "Phum", age: "29-year-old Thai man", look: "tall, tousled wavy black hair, light stubble, a warm crooked smile",
        outfit: "a white linen shirt with rolled sleeves, beige chinos and a leather watch", voice: "soft, deep, playful male voice",
        trait: "อบอุ่น ขี้แกล้ง", want: "อยากให้คนข้างห้องได้ยินเพลงที่แต่ง", secret: "กำลังจะต้องย้ายไปลอนดอน" },
      { role: "RIVAL", name: "แพรวา", nameEn: "Praewa", age: "28-year-old Thai woman", look: "elegant, a sleek black bob and red lipstick",
        outfit: "a fitted black blazer dress and pearl earrings", voice: "polished, cool, measured female voice",
        trait: "มั่นใจ ตรงไปตรงมา", want: "อยากพาน้องชายกลับบ้าน", secret: "เป็นพี่สาวของภูมิ ไม่ใช่แฟน" },
    ],
    places: [
      { key: "A", name: "ระเบียงคอนโดข้างกัน", look: "two adjoining balconies of an old Bangkok apartment block at golden hour, potted plants, fairy lights and a low wall between them" },
      { key: "B", name: "คาเฟ่ของภูมิ", look: "a small warm cafe with wooden shelves of vinyl records, a chalkboard menu and rain on the front window" },
      { key: "C", name: "ทางเดินริมเจ้าพระยา", look: "a riverside promenade beside a lit cable-stayed bridge at night, the Chao Phraya river shimmering" },
    ],
    object: { name: "สมุดสเก็ตช์ปกน้ำเงิน", look: "a small navy-blue sketchbook tied with a frayed ribbon" },
    truth: "ภูมิคือคนส่งโน้ตเพลงข้ามระเบียงมาตั้งแต่คืนแรก และแพรวาคือพี่สาวที่มาพาเขากลับลอนดอน ไม่ใช่แฟน",
    ending: "ภูมิเลือกอยู่ต่อ ใบเตยเปิดสมุดสเก็ตช์หน้าสุดท้ายที่วาดเขาไว้ ทั้งคู่จับมือกันริมแม่น้ำ",
    reveal1: say("RIVAL", "ฉันไม่ใช่แฟนเขาหรอก ฉันเป็นพี่สาว และมาพาเขากลับลอนดอน"),
    reveal2: say("ALLY", "โน้ตเพลงทุกคืนนั่น ผมเขียนให้คุณคนเดียว"),
    finalLine: say("LEAD", "หน้าสุดท้ายของสมุดเล่มนี้ เป็นของคุณมาตลอด"),
  },
  season: ROMANCE_BALCONY_NOTES_SEASON,
  hooks: [say("LEAD", "เมื่อกี้... เขาหมายความว่ายังไง"), say("ALLY", "ขอโทษนะ ผมไม่ได้ตั้งใจ"), say("LEAD", "ใจเย็นๆ ใบเตย"), say("ALLY", "คุณโอเคไหม"), say("LEAD", "ทำไมใจเต้นแรงขนาดนี้")],
  moves: [
    m("note", "โน้ตเพลง", "{LEAD}พบโน้ตเพลงพับเป็นนกกระดาษวางบนระเบียง", "{LEAD} finds a paper crane folded from sheet music on her balcony railing, unfolds it and smiles", 1, { at: "A", say: say("LEAD", "คืนนี้ก็มาอีกแล้ว") }),
    m("reply", "เขียนตอบ", "{LEAD}วาดรูปเล็กๆ ส่งตอบกลับไป", "{LEAD} sketches a tiny drawing on a note, folds it into a crane and sets it on the low wall between the balconies", 1, { at: "A" }),
    m("cafe-meet", "เจอกันที่คาเฟ่", "{LEAD}เข้าคาเฟ่ของ{ALLY}โดยบังเอิญ", "{LEAD} shelters from the rain inside the cafe; {ALLY} looks up from the counter and their eyes meet", 1, { at: "B", say: say("ALLY", "เปียกหมดเลย เดี๋ยวผมชงอะไรอุ่นๆ ให้") }),
    m("umbrella", "ร่มคันเดียว", "ทั้งสองเดินกลับบ้านใต้ร่มคันเดียว", "{LEAD} and {ALLY} walk close together under one small umbrella on a rainy street, shoulders almost touching", 2, { say: say("ALLY", "บ้านเราไปทางเดียวกันพอดี") }),
    m("song", "เพลงจากห้องข้างๆ", "เสียงกีตาร์ดังมาจากห้องข้างๆ ตรงกับโน้ตที่ได้", "{LEAD} sits on her balcony at night holding the music note as soft guitar chords drift from next door; she closes her eyes", 1, { at: "A" }),
    m("jealous", "หึง", "{LEAD}เห็น{ALLY}หัวเราะกับ{RIVAL}แล้วใจหาย", "through the cafe window {LEAD} sees {ALLY} laughing with {RIVAL}; she lowers her eyes and turns away", 2, { at: "B" }),
    m("sketch-drop", "สมุดหล่น", "{LEAD}ทำ{OBJ}หล่น {ALLY}เกือบเห็นข้างใน", "{OBJ} slips from {LEAD}'s tote; {ALLY} picks it up and the ribbon starts to loosen; she snatches it back, blushing", 2, { say: say("LEAD", "อย่าเปิดนะ!") }),
    m("rooftop-talk", "คุยกันข้ามระเบียง", "ทั้งสองคุยกันข้ามระเบียงเป็นครั้งแรก", "golden hour: {LEAD} and {ALLY} lean on their balcony railings side by side and talk across the low wall, smiling", 1, { at: "A", say: say("ALLY", "ผมว่า... เราเคยคุยกันมาก่อนนะ") }),
    m("caught-rain", "ตากฝน", "{LEAD}วิ่งตากฝนจนเปียกปอน", "{LEAD} runs through heavy rain, soaked, hair stuck to her face, clutching {OBJ} to her chest", 2, { condition: { who: "LEAD", en: "a small plaster on her right knee from a fall in the rain", th: "หัวเข่าขวามีพลาสเตอร์" } }),
    m("advice", "คำเตือนของแพรวา", "{RIVAL}เตือน{LEAD}ว่าอย่าคิดไปไกล", "{RIVAL} stops {LEAD} at the cafe door and speaks calmly, not unkindly", 2, { at: "B", say: say("RIVAL", "อย่าผูกพันมากนะ เขาอยู่ได้อีกไม่นาน") }),
  ],
  cliffs: [
    m("c-signature", "ลายมือเดียวกัน", "{LEAD}เห็นลายมือบนเมนูคาเฟ่ตรงกับโน้ตเพลง", "{LEAD} holds a music note next to the cafe chalkboard; the handwriting is exactly the same; she slowly looks at {ALLY}", 2),
    m("c-suitcase", "กระเป๋าเดินทาง", "{LEAD}เห็น{ALLY}ลากกระเป๋าเดินทางออกจากตึก", "from her balcony {LEAD} sees {ALLY} below, wheeling a large suitcase toward a waiting taxi with {RIVAL}", 3, { say: say("LEAD", "จะไปไหน...") }),
    m("c-almost", "เกือบจูบ", "ทั้งสองยืนใกล้กันมาก แต่โทรศัพท์ดังขึ้น", "{LEAD} and {ALLY} lean closer and closer under the fairy lights, then his phone rings loudly and they both freeze", 2),
    m("c-open", "สมุดถูกเปิด", "{ALLY}เปิด{OBJ}ดู และเห็นรูปตัวเองเต็มหน้า", "{ALLY} opens {OBJ} and sees page after page of drawings of himself; he looks up just as {LEAD} walks in", 3, { say: say("ALLY", "นี่... ผมเหรอ") }),
    m("c-ring", "แหวน", "{RIVAL}ยื่นกล่องแหวนให้{ALLY}ต่อหน้า{LEAD}", "{RIVAL} hands {ALLY} a small velvet box in front of {LEAD}; {LEAD} turns and leaves before he can explain", 3),
    m("c-lastnote", "โน้ตใบสุดท้าย", "โน้ตใบสุดท้ายเขียนว่า: ขอบคุณที่ฟังเพลงของผม ลาก่อน", "{LEAD} unfolds a paper crane on her balcony; it reads only 'thank you for listening, goodbye'; tears well in her eyes", 2, { say: say("LEAD", "ลาก่อน... เหรอ") }),
  ],
  beats: {
    OPENING: { title: "นกกระดาษตัวแรก", at: "A", shots: [
      m("o1", "ระเบียง", "{LEAD}ย้ายเข้าคอนโดเก่า ระเบียงติดกับห้องของ{ALLY} {RIVAL}มาส่งของให้เขา", "golden hour on two adjoining balconies: {LEAD} waters her plants; on the next balcony {ALLY} plays guitar while {RIVAL} hands him a coffee; all three faces clearly visible, medium-wide shot", 1, { say: say("RIVAL", "เลิกเล่นได้แล้ว ข้างห้องเขาจะรำคาญ") }),
      m("o2", "นกกระดาษ", "คืนนั้น{LEAD}พบนกกระดาษจากโน้ตเพลงบนระเบียง", "night: {LEAD} finds a paper crane folded from sheet music on her railing and unfolds it curiously", 1, { say: say("LEAD", "ใครส่งมานะ") }),
      m("o3", "วาดตอบ", "{LEAD}วาดรูปดวงจันทร์ส่งกลับไป", "{LEAD} draws a little moon on the back of the note, folds it again and places it on the dividing wall", 1),
    ], cliff: m("o-c", "มือที่หยิบ", "มือผู้ชายเอื้อมมาหยิบนกกระดาษไปในความมืด", "from the dark side of the wall a man's hand with a leather watch reaches over and takes the crane; {LEAD} watches, holding her breath", 1) },
    INCITING: { title: "คาเฟ่วันฝนตก", at: "B", shots: [
      m("i1", "หลบฝน", "{LEAD}หลบฝนเข้าคาเฟ่ของ{ALLY}", "rain pours; {LEAD} hurries into the warm cafe, shaking off water; {ALLY} looks up from the counter", 1, { say: say("ALLY", "ยินดีต้อนรับครับ เปียกหมดเลย") }),
      m("i2", "นาฬิกา", "{LEAD}สังเกตเห็นนาฬิกาหนังที่ข้อมือเขา", "{ALLY} slides a cup of cocoa toward {LEAD}; she notices his leather watch and pauses", 1, { say: say("LEAD", "นาฬิกาสวยดีนะคะ") }),
      m("i3", "ยิ้ม", "ทั้งสองยิ้มให้กันเขินๆ", "{LEAD} and {ALLY} smile shyly at each other across the counter as rain streaks the window", 1),
    ], cliff: m("i-c", "แพรวาเข้าร้าน", "{RIVAL}เดินเข้าร้านมากอดแขน{ALLY}", "the door chimes; {RIVAL} walks in, takes {ALLY}'s arm familiarly; {LEAD}'s smile fades", 2, { say: say("RIVAL", "ที่รัก ไปกันได้แล้ว") }) },
    MIDPOINT: { title: "พี่สาว", at: "C", shots: [
      m("mp1", "เจอที่ริมน้ำ", "{LEAD}เจอ{RIVAL}ยืนคนเดียวที่ริมแม่น้ำ", "night on the riverside promenade: {LEAD} finds {RIVAL} alone by the railing, the lit bridge behind her", 1),
      m("mp2", "ความจริง", "{RIVAL}เล่าความจริง", "{RIVAL} turns to {LEAD} and speaks honestly for the first time", 1, { say: "REVEAL1" }),
      m("mp3", "โล่งใจปนเศร้า", "{LEAD}ทั้งโล่งใจและใจหายพร้อมกัน", "{LEAD} breathes out in relief, then her face falls as the second part sinks in", 1, { say: say("LEAD", "ลอนดอน... เมื่อไหร่คะ") }),
    ], cliff: m("mp-c", "อีกเจ็ดวัน", "{RIVAL}ยกตั๋วเครื่องบินขึ้นให้ดู", "{RIVAL} holds up a plane ticket; the city lights reflect on it", 2, { say: say("RIVAL", "อีกเจ็ดวัน") }) },
    CRISIS: { title: "นกกระดาษหยุดบิน", at: "A", shots: [
      m("cr1", "รอ", "{LEAD}รอโน้ตบนระเบียงทุกคืน แต่ไม่มีอีกแล้ว", "{LEAD} sits on her dark balcony wrapped in a blanket, watching the empty dividing wall; no crane comes", 2),
      m("cr2", "ห้องว่าง", "ห้องข้างๆ มืดสนิท", "the neighbouring balcony is dark and bare, the guitar gone; {LEAD} reaches out and touches the empty wall", 2),
      m("cr3", "ร้องไห้", "{LEAD}เปิด{OBJ}ดูรูปที่วาดเขาแล้วน้ำตาไหล", "{LEAD} opens {OBJ} to a drawing of {ALLY} and a tear falls onto the page", 2, { say: say("LEAD", "ทำไมไม่บอกเขาไปนะ") }),
    ], cliff: m("cr-c", "เสียงกีตาร์", "เสียงกีตาร์ดังขึ้นจากไกลๆ ทางแม่น้ำ", "faint guitar notes drift from far away, toward the river; {LEAD} stands up suddenly, eyes wide", 2) },
    CLIMAX: { title: "ริมแม่น้ำ", at: "C", shots: [
      m("cl1", "วิ่ง", "{LEAD}วิ่งไปที่ริมแม่น้ำ", "{LEAD} runs along the riverside promenade at night, out of breath, {OBJ} in her hand", 3),
      m("cl2", "เจอ", "{ALLY}นั่งเล่นกีตาร์อยู่ใต้สะพาน", "under the lit bridge {ALLY} sits on a bench playing guitar; he sees her and stops", 2, { say: "REVEAL2" }),
      m("cl3", "ยื่นสมุด", "{LEAD}ยื่น{OBJ}ให้เขา", "{LEAD} steps forward and holds out {OBJ} with trembling hands", 2, { say: say("LEAD", "ฉันก็มีอะไรจะให้คุณเหมือนกัน") }),
    ], cliff: m("cl-c", "เครื่องบิน", "เสียงประกาศขึ้นเครื่องดังจากโทรศัพท์ของเขา", "{ALLY}'s phone lights up with a boarding alert; he looks at the screen, then at {LEAD}", 2) },
    FINALE: { title: "หน้าสุดท้าย", at: "C", shots: [
      m("f1", "ปิดโทรศัพท์", "{ALLY}ปิดโทรศัพท์แล้วยิ้ม", "{ALLY} turns off his phone and puts it away, smiling at {LEAD}", 1, { say: say("ALLY", "ผมว่าผมยังไม่อยากไปไหน") }),
      m("f2", "หน้าสุดท้าย", "{LEAD}เปิดหน้าสุดท้ายของ{OBJ}", "{LEAD} opens {OBJ} to the last page, a drawing of the two of them on the balconies, and shows him", 1, { say: "FINAL" }),
      m("f3", "จับมือ", "ทั้งคู่จับมือกันเดินริมแม่น้ำ {RIVAL}มองยิ้มๆ อยู่ไกลๆ", "wide shot: {LEAD} and {ALLY} walk hand in hand along the shimmering river; far behind them {RIVAL} watches and smiles", 1, { say: say("RIVAL", "ไปเถอะ น้องชายฉัน") }),
    ] },
  },
};

const MYSTERY: GenreKit = {
  genre: "MYSTERY",
  style: "Photorealistic Thai detective noir, cinematic 1930s riverside hotel, moody amber and green light, deep shadows, slow precise camera",
  sound: "ticking clocks, ceiling fans, distant river boats, quiet footsteps on marble; no music score",
  hashtags: ["#ละครสั้น", "#สืบสวน", "#ไขคดี", "#ละครไทย"],
  premise: {
    key: "mystery-room-709", title: "ห้อง 709",
    logline: "แขกหายตัวจากห้อง 709 ที่ประตูล็อกจากด้านใน สิ่งเดียวที่เหลือคือนาฬิกาพกที่หยุดเดินตอนตีสามสิบเจ็ดนาที",
    cast: [
      { role: "LEAD", name: "สารวัตรนิล", nameEn: "Inspector Nin", age: "35-year-old Thai woman", look: "composed, sharp jawline, hair in a low bun, a thin silver pen behind her ear",
        outfit: "a dark green trench coat over a white shirt and black trousers", voice: "calm, precise, low female voice",
        trait: "ช่างสังเกต นิ่ง", want: "อยากปิดคดีที่พ่อเคยปิดไม่ได้", secret: "พ่อเคยทำคดีห้อง 709 เมื่อยี่สิบปีก่อน" },
      { role: "ALLY", name: "จ่อย", nameEn: "Joy", age: "23-year-old Thai man", look: "skinny, a big eager grin, neatly side-parted hair",
        outfit: "an ill-fitting grey suit, a loosened blue tie and a small notebook in hand", voice: "eager, slightly squeaky young male voice",
        trait: "กระตือรือร้น ซุ่มซ่าม", want: "อยากเป็นนักสืบเก่งๆ แบบนิล", secret: "จำตัวเลขได้ทุกตัวที่เคยเห็น" },
      { role: "RIVAL", name: "คุณชาติชาย", nameEn: "Mr. Chatchai", age: "55-year-old Thai man", look: "silver hair, gold-rimmed glasses, a neatly trimmed grey beard",
        outfit: "a cream three-piece suit with a pocket-watch chain", voice: "warm, courteous, carefully controlled male voice",
        trait: "สุภาพ เจ้าเล่ห์", want: "อยากให้ตำรวจออกไปจากโรงแรมเร็วที่สุด", secret: "ซ่อนลูกสาวไว้ในโรงแรมยี่สิบปี" },
    ],
    places: [
      { key: "A", name: "ห้อง 709", look: "an old riverside hotel room with art-deco wallpaper, a brass bed, an open window over the river and a stopped clock on the wall" },
      { key: "B", name: "ล็อบบี้โรงแรม", look: "a grand 1930s hotel lobby with a marble floor, slow ceiling fans, a long teak reception desk and a brass bell" },
      { key: "C", name: "ห้องเก็บของใต้ดิน", look: "a hotel basement storeroom lit by one caged bulb, stacked luggage trunks and shelves of old guest ledgers" },
      { key: "D", name: "ทางเดินชั้นเจ็ด", look: "a long seventh-floor hotel corridor with a faded red runner carpet, brass wall lamps, numbered teak doors and an old brass cage lift at the far end" },
      { key: "E", name: "ห้อง 708", look: "an old riverside hotel room that mirrors room 709, art-deco wallpaper, a brass bed and white dust sheets over the chairs" },
      { key: "G", name: "ห้องทำงานคุณชาติชาย", look: "a wood-panelled hotel manager's office behind the reception, a green-shaded desk lamp, an old black telephone, a wall safe and framed photos of the hotel" },
      { key: "H", name: "บันไดพนักงาน", look: "a narrow concrete service stairwell in an old hotel, iron railings, peeling green paint, a bare bulb on each landing and a small wooden dumbwaiter hatch in the wall" },
      { key: "I", name: "ระเบียงริมแม่น้ำหน้าโรงแรม", look: "a sunny riverside terrace in front of an old colonial hotel, white balustrade, potted palms and the wide brown river beyond" },
      { key: "J", name: "ห้องลับหลังผนัง", look: "a tiny hidden room behind a hotel wall lit by a warm lamp, a narrow bed, shelves of worn books and every wall covered in drawings of a river" },
    ],
    object: { name: "นาฬิกาพกหยุดที่ 3.17", look: "a gold pocket watch stopped at 3:17" },
    truth: "แขกที่หายไปคือลูกสาวของคุณชาติชาย ที่เขาซ่อนไว้ในห้องลับของโรงแรมมายี่สิบปีเพราะกลัวเธอจะจากไป",
    ending: "นิลพบห้องลับหลังห้อง 709 ผู้หายตัวยังมีชีวิต คุณชาติชายสารภาพ คดียี่สิบปีปิดลง",
    reveal1: say("ALLY", "สารวัตรครับ ห้อง 709 ถูกจองไว้ทุกคืนมายี่สิบปี แต่ไม่เคยมีแขกเข้าพัก"),
    reveal2: say("RIVAL", "ผมไม่ได้ทำร้ายเธอ ผมแค่ไม่ยอมให้เธอไปจากผม"),
    finalLine: say("LEAD", "ตีสามสิบเจ็ดนาที เวลาที่ทุกอย่างเริ่ม และจบลงตรงนี้"),
  },
  season: MYSTERY_ROOM_709_SEASON,
  hooks: [say("LEAD", "อย่าเพิ่งแตะอะไรทั้งนั้น"), say("ALLY", "สารวัตรครับ ดูนี่สิครับ"), say("LEAD", "ทุกอย่างมีเหตุผลเสมอ"), say("ALLY", "ผมจดไว้หมดแล้วครับ"), say("LEAD", "มีคนโกหกเรา")],
  moves: [
    m("dust", "ฝุ่นบนขอบหน้าต่าง", "{LEAD}พบรอยนิ้วบนฝุ่นขอบหน้าต่าง", "{LEAD} crouches by the open window and shines a small torch on the dusty sill, revealing four fingertip marks", 1, { at: "A", say: say("LEAD", "มีคนปีนออกทางนี้... หรือปีนเข้า"), clue: "มีรอยนิ้วบนขอบหน้าต่างห้อง 709" }),
    m("ledger", "สมุดทะเบียน", "{ALLY}ค้นสมุดทะเบียนแขกเก่าในห้องใต้ดิน", "{ALLY} blows dust off an old guest ledger in the basement and runs his finger down the columns", 1, { at: "C", say: say("ALLY", "ชื่อเดียวกัน... ทุกปี"), clue: "ชื่อผู้จองห้อง 709 ซ้ำเดิมทุกปี" }),
    m("interview", "สอบปากคำ", "{LEAD}สอบปากคำ{RIVAL}ที่ล็อบบี้", "{LEAD} sits across from {RIVAL} at the reception desk; he smiles politely and turns his pocket-watch chain between his fingers", 1, { at: "B", say: say("RIVAL", "แขกเช็กเอาต์ไปแล้วครับ ผมจำได้แม่น") }),
    m("clock", "นาฬิกาบนผนัง", "{LEAD}สังเกตว่านาฬิกาบนผนังก็หยุดที่ 3.17", "{LEAD} looks up at the stopped clock on the wall of room 709; its hands point to 3:17 as well", 1, { at: "A", say: say("LEAD", "เวลาเดียวกันอีกแล้ว"), clue: "นาฬิกาในห้องหยุดเวลาเดียวกับนาฬิกาพก" }),
    m("wall-knock", "ผนังกลวง", "{ALLY}เคาะผนังแล้วได้ยินเสียงกลวง", "{ALLY} leans on the wallpapered wall and taps it; it sounds hollow; he taps again, frowning", 2, { at: "A", say: say("ALLY", "สารวัตรครับ ผนังนี้... กลวง") }),
    m("staff", "พนักงานกลัว", "พนักงานเก่าแอบบอกใบ้แล้วรีบเดินหนี", "an old bellboy whispers to {LEAD} in the corridor, glancing over his shoulder, then hurries away", 2, { at: "B", say: say("LEAD", "เขากลัวใครบางคนอยู่") }),
    m("photo-old", "ภาพถ่ายเก่า", "{LEAD}พบภาพถ่ายเด็กหญิงกับ{RIVAL}ในกล่องเก่า", "{LEAD} lifts an old photograph from a trunk: a young {RIVAL} holding the hand of a little girl in a white dress", 2, { at: "C", say: say("LEAD", "ลูกสาวเขา... ไม่มีในประวัติเลย") }),
    m("chase-corridor", "เงาในทางเดิน", "{ALLY}วิ่งตามเงาปริศนาไปตามทางเดิน", "{ALLY} runs down a long dim hotel corridor after a fleeting shadow, his tie flying over his shoulder", 3, { say: say("ALLY", "หยุดนะ! ตำรวจ!") }),
    m("fall", "ตกบันได", "{ALLY}พลาดตกบันไดใต้ดิน", "{ALLY} misses a step on the basement stairs and tumbles down, then sits up holding his ankle", 3, { at: "C", say: say("ALLY", "ไม่เป็นไรครับ... แค่ข้อเท้า"), condition: { who: "ALLY", en: "a limp and a bandaged left ankle", th: "ข้อเท้าซ้ายพันผ้า เดินกะเผลก" } }),
    m("threat", "คำขู่", "{RIVAL}เตือน{LEAD}ด้วยรอยยิ้ม", "{RIVAL} stops {LEAD} by the lobby fountain, smiling warmly while his eyes stay cold", 2, { at: "B", say: say("RIVAL", "บางคดี ปิดไว้ก็ดีแล้วนะครับสารวัตร") }),
  ],
  cliffs: [
    m("c-ticking", "นาฬิกาเดิน", "นาฬิกาพกที่หยุดมายี่สิบปี จู่ๆ ก็เริ่มเดินอีกครั้ง", "on the table {OBJ} suddenly starts ticking again; {LEAD} and {ALLY} stare at it, frozen", 2, { say: say("ALLY", "มัน... เดินเองครับ") }),
    m("c-locked", "ถูกขัง", "ประตูห้องใต้ดินถูกล็อกจากด้านนอก ไฟดับ", "the basement door slams and locks from outside; the caged bulb goes out; only {LEAD}'s torch remains", 3),
    m("c-note", "กระดาษโน้ต", "{LEAD}พบโน้ตในเสื้อโค้ตตัวเอง: หยุดสืบได้แล้ว", "{LEAD} reaches into her trench coat pocket and pulls out a note she has never seen; it says stop now", 2, { say: say("LEAD", "มีคนเข้าใกล้ฉันได้ขนาดนี้...") }),
    m("c-voice", "เสียงหลังผนัง", "เสียงผู้หญิงฮัมเพลงดังลอดมาจากหลังผนังห้อง 709", "{LEAD} presses her ear to the wallpaper of room 709; a woman's faint humming comes from behind it", 3),
    m("c-missing", "จ่อยหายไป", "{LEAD}หันกลับมา {ALLY}ไม่อยู่แล้ว เหลือแต่สมุดจดตกพื้น", "{LEAD} turns around in the corridor; {ALLY} is gone; only his little notebook lies open on the carpet", 3, { say: say("LEAD", "จ่อย?") }),
    m("c-same-watch", "นาฬิกาเรือนที่สอง", "{RIVAL}หยิบนาฬิกาพกเรือนที่เหมือนกันทุกอย่างขึ้นมาดู", "{RIVAL} alone in his office takes out a second gold pocket watch, identical to the first, and opens it slowly", 2) ,
  ],
  beats: {
    OPENING: { title: "ประตูล็อกจากด้านใน", at: "A", shots: [
      m("o1", "ที่เกิดเหตุ", "{LEAD}กับ{ALLY}มาถึงห้อง 709 {RIVAL}เปิดประตูให้", "{RIVAL} unlocks room 709 with a brass key and steps aside; {LEAD} and {ALLY} enter; all three faces clearly visible, medium-wide shot", 1, { say: say("RIVAL", "ประตูล็อกจากด้านในครับ เราต้องงัดเข้ามา") }),
      m("o2", "นาฬิกาพก", "{LEAD}พบ{OBJ}บนหมอน", "{LEAD} puts on gloves and lifts {OBJ} from the pillow; it shows 3:17", 1, { say: say("LEAD", "ตีสามสิบเจ็ดนาที") }),
      m("o3", "จดบันทึก", "{ALLY}จดทุกอย่างในห้อง", "{ALLY} scribbles in his notebook, looking around the room wide-eyed", 1, { say: say("ALLY", "หน้าต่างชั้นเจ็ด ไม่มีระเบียง ไม่มีทางออก") }),
    ], cliff: m("o-c", "สีหน้าเจ้าของ", "{LEAD}หันไปเห็นว่า{RIVAL}จ้องนาฬิกาด้วยสายตาแปลกๆ", "{LEAD} glances back and catches {RIVAL} staring at {OBJ} with a strange, haunted look before he smooths his face into a smile", 1) },
    INCITING: { title: "คดีเก่า", at: "C", shots: [
      m("i1", "แฟ้มเก่า", "{LEAD}เปิดแฟ้มคดีเก่าของพ่อ", "{LEAD} opens a yellowed police file under the basement bulb; her father's signature is at the bottom", 1, { say: say("LEAD", "พ่อเคยทำคดีห้องนี้") }),
      m("i2", "เหมือนกัน", "คดีเมื่อยี่สิบปีก่อนเหมือนกันทุกอย่าง", "{ALLY} lays an old crime-scene photo beside a new one; both show {OBJ} at 3:17", 1, { say: say("ALLY", "เหมือนกันเป๊ะเลยครับ") }),
      m("i3", "ตัดสินใจ", "{LEAD}ตัดสินใจเปิดคดีใหม่", "{LEAD} closes the file and stands up with quiet determination", 1, { say: say("LEAD", "คราวนี้ฉันจะปิดคดีให้พ่อเอง") }),
    ], cliff: m("i-c", "เงาบนบันได", "มีเงาคนยืนดูอยู่บนบันไดแล้วหายไป", "a silhouette stands at the top of the basement stairs watching them, then steps back into darkness", 2) },
    MIDPOINT: { title: "การจองที่ไม่มีแขก", at: "B", shots: [
      m("mp1", "วิ่งมาบอก", "{ALLY}วิ่งเข้าล็อบบี้มาพร้อมสมุดทะเบียน", "{ALLY} rushes across the marble lobby clutching an old ledger", 2),
      m("mp2", "ความจริง", "{ALLY}เผยสิ่งที่พบ", "{ALLY} opens the ledger in front of {LEAD} and points to a column of entries", 1, { say: "REVEAL1" }),
      m("mp3", "เชื่อมโยง", "{LEAD}มองขึ้นไปที่ชั้นเจ็ด", "{LEAD} slowly looks up toward the seventh floor gallery above the lobby", 1, { say: say("LEAD", "ไม่ใช่ว่าไม่มีแขก... แขกไม่เคยออกไปต่างหาก") }),
    ], cliff: m("mp-c", "เจ้าของมอง", "{RIVAL}ยืนมองทั้งสองจากชั้นบน แล้วถอดแว่นออก", "on the upper gallery {RIVAL} watches them, slowly takes off his gold-rimmed glasses and walks away", 2) },
    CRISIS: { title: "ถูกถอนคดี", at: "B", shots: [
      m("cr1", "สั่งปิดคดี", "{LEAD}รับโทรศัพท์ถูกสั่งให้ปิดคดี", "{LEAD} stands at the reception desk holding a phone receiver, her face hardening as she listens", 2, { say: say("LEAD", "ปิดคดี? ทั้งที่ยังไม่เจอตัวคนหาย?") }),
      m("cr2", "ยึดบัตร", "{LEAD}วางบัตรตำรวจลงบนเคาน์เตอร์", "{LEAD} places her police badge on the teak counter and pushes it away", 2),
      m("cr3", "จ่อยตามมา", "{ALLY}ตามมาบอกว่าจะช่วยต่อ", "{ALLY} limps after her across the lobby and grabs her sleeve", 2, { say: say("ALLY", "ไม่มีบัตรก็ไม่เป็นไรครับ ผมยังอยู่") }),
    ], cliff: m("cr-c", "ประตูลับ", "วอลเปเปอร์ในห้อง 709 ฉีกออกเผยให้เห็นขอบประตู", "back in room 709 {LEAD} tears a strip of wallpaper away, revealing the outline of a hidden door", 3) },
    CLIMAX: { title: "ห้องหลังผนัง", at: "A", shots: [
      m("cl1", "เปิดประตู", "{LEAD}ดันประตูลับเปิดออก", "{LEAD} pushes the hidden door open; warm lamplight spills out from a small secret room", 3),
      m("cl2", "เจ้าของมาถึง", "{RIVAL}เข้ามายืนขวาง แล้วยอมสารภาพ", "{RIVAL} appears in the doorway behind them, breathing hard, then his shoulders drop", 2, { say: "REVEAL2" }),
      m("cl3", "ผู้หญิงในห้อง", "หญิงสาวคนหนึ่งค่อยๆ ลุกขึ้นจากเก้าอี้ในห้องลับ", "inside the secret room a pale young woman in a white dress slowly rises from an armchair", 2),
    ], cliff: m("cl-c", "เธอพูด", "หญิงสาวมองตรงมาที่{LEAD}และยื่นนาฬิกาพกเรือนที่สองให้", "the young woman looks straight at {LEAD} and holds out a second gold pocket watch", 2) },
    FINALE: { title: "ตีสามสิบเจ็ด", at: "B", shots: [
      m("f1", "ใส่กุญแจมือ", "{ALLY}ใส่กุญแจมือ{RIVAL}อย่างเงียบๆ", "{ALLY} gently handcuffs {RIVAL}, who does not resist, in the quiet lobby at dawn", 1),
      m("f2", "สองเรือน", "{LEAD}เปิดนาฬิกาสองเรือนพร้อมกัน", "{LEAD} holds both gold pocket watches side by side; both start ticking together", 1, { say: "FINAL" }),
      m("f3", "ออกจากโรงแรม", "{LEAD}กับ{ALLY}เดินออกจากโรงแรมสู่แสงเช้า", "wide shot: {LEAD} and {ALLY} walk out of the grand hotel doors into the morning light by the river", 1, { say: say("ALLY", "คดีต่อไปเมื่อไหร่ครับสารวัตร") }),
    ] },
  },
};

const FANTASY: GenreKit = {
  genre: "FANTASY",
  style: "Photorealistic Thai fantasy epic, lush cinematic look, magical glowing light, mist and fireflies, rich jade and gold palette, smooth sweeping camera",
  sound: "forest ambience, rushing water, soft magical chimes, wind through leaves; no music score",
  hashtags: ["#ละครสั้น", "#แฟนตาซี", "#ป่าหิมพานต์", "#ละครไทย"],
  premise: {
    key: "fantasy-naga-pearl", title: "ไข่มุกนาค",
    logline: "เด็กสาวหมู่บ้านริมป่าเก็บไข่มุกเรืองแสงได้จากแม่น้ำ คืนนั้นป่าหิมพานต์ก็เริ่มเรียกชื่อเธอ",
    cast: [
      { role: "LEAD", name: "น้ำ", nameEn: "Nam", age: "19-year-old Thai woman", look: "determined, long black hair in a single braid, a small crescent birthmark on her left cheek",
        outfit: "a simple indigo cotton blouse, a woven sarong and a cloth satchel", voice: "clear, brave, youthful female voice",
        trait: "กล้า ใจดี ดื้อ", want: "อยากรู้ว่าทำไมไข่มุกเลือกเธอ", secret: "พ่อแม่หายไปในป่าตอนเธอยังเล็ก" },
      { role: "ALLY", name: "ปีกทอง", nameEn: "Peek Thong", age: "small magical bird spirit", look: "the size of a cat, shimmering golden feathers, jewel-green eyes, a long elegant tail",
        outfit: "a tiny gold collar with a red gem", voice: "tiny, chirpy, sarcastic voice",
        trait: "ปากดี ขี้บ่น ซื่อสัตย์", want: "อยากให้ป่ากลับมามีแสง", secret: "เคยเป็นผู้ช่วยของผู้พิทักษ์คนก่อน" },
      { role: "RIVAL", name: "เจ้าเงา", nameEn: "Lord Ngao", age: "tall ancient figure", look: "gaunt, a gold mask covering the left half of his face, long silver hair",
        outfit: "a long flowing smoke-black robe", voice: "echoing, cold, slow male voice",
        trait: "เย็นชา โศกเศร้า", want: "อยากได้ไข่มุกเพื่อหยุดความกลัวในใจ", secret: "คือผู้พิทักษ์คนเก่าที่ถูกความกลัวกลืน" },
    ],
    places: [
      { key: "A", name: "หมู่บ้านริมป่า", look: "a small Thai riverside village of stilted wooden houses at dawn, morning mist, banana trees and a wooden footbridge" },
      { key: "B", name: "ป่าหิมพานต์", look: "an enchanted ancient forest with giant glowing roots, floating fireflies, ferns taller than a person and turquoise light" },
      { key: "C", name: "วิหารร้างกลางป่า", look: "a ruined stone temple swallowed by banyan roots, a cracked golden naga statue and shafts of moonlight" },
      { key: "D", name: "ริมแม่น้ำเชี่ยวกลางป่า", look: "a wide rushing river through the enchanted forest, mossy boulders, glowing turquoise roots along the banks and drifting spray" },
      { key: "E", name: "แอ่งน้ำตกในป่า", look: "a deep emerald pool below a small waterfall, hanging roots, glowing water-lilies and soft moss banks" },
      { key: "F", name: "ป่าตายสีเทา", look: "a dead grey part of the forest, leafless twisted trees, ash-grey ground and drifting black mist" },
      { key: "G", name: "บ้านไม้ใต้ถุนสูง", look: "inside a simple wooden Thai stilt house, woven mats, an oil lamp, baskets and wooden shutters" },
      { key: "H", name: "ระเบียงคดรอบวิหาร", look: "a moonlit cloister gallery around the ruined temple, crumbling arches and long walls of vine-covered ancient murals" },
      { key: "I", name: "โพรงต้นไทรยักษ์", look: "inside the hollow trunk of a giant banyan tree, walls of glowing moss and a narrow opening onto the forest" },
      { key: "J", name: "ทุ่งหิ่งห้อย", look: "a wide meadow of tall grass under the stars at the forest edge, thousands of fireflies, a ruined temple on the hill beyond" },
    ],
    object: { name: "ไข่มุกนาค", look: "a glowing jade-green pearl the size of a fist" },
    truth: "น้ำคือลูกหลานของผู้พิทักษ์คนสุดท้าย และเจ้าเงาคือผู้พิทักษ์คนเก่าที่ถูกความกลัวกลืนกินจนกลายเป็นเงา",
    ending: "น้ำคืนไข่มุกสู่พญานาคที่วิหาร ช่วยให้เจ้าเงากลับเป็นคน และป่าหิมพานต์กลับมามีแสง",
    reveal1: say("ALLY", "ปานรูปจันทร์เสี้ยวที่แก้มเจ้า คือตราของผู้พิทักษ์"),
    reveal2: say("RIVAL", "ข้าก็เคยถือไข่มุกนั่นเหมือนเจ้า ก่อนที่ความกลัวจะกินข้า"),
    finalLine: say("LEAD", "ป่ากลับมามีแสงแล้ว และข้าจะดูแลมันเอง"),
  },
  season: FANTASY_NAGA_PEARL_SEASON,
  hooks: [say("ALLY", "ข้าบอกแล้วไง อย่าแตะ!"), say("LEAD", "ปีกทอง เจ้าโอเคไหม"), say("LEAD", "ข้าไม่กลัวหรอก"), say("ALLY", "ทางนี้ เร็วเข้า"), say("LEAD", "ไข่มุก... มันกำลังบอกอะไรเรา")],
  moves: [
    m("glow-path", "ทางเรืองแสง", "ไข่มุกส่องแสงนำทางผ่านป่า", "{OBJ} in {LEAD}'s hands glows brighter and a trail of light appears on the forest floor ahead", 1, { at: "B", say: say("ALLY", "มันพาเราไปทางนั้น") }),
    m("spirits", "ภูตต้นไม้", "ภูตต้นไม้ตัวเล็กๆ โผล่มาจากรากไม้", "tiny glowing tree spirits peek out from the giant roots and float around {LEAD}, curious", 1, { at: "B", say: say("LEAD", "พวกเขาไม่ทำร้ายเราใช่ไหม") }),
    m("argue", "เถียงกัน", "{ALLY}กับ{LEAD}เถียงกันเรื่องทางไป", "{ALLY} flutters in front of {LEAD}'s face, wings flapping indignantly, as she rolls her eyes", 1, { say: say("ALLY", "ข้าอยู่ในป่านี้มาสามร้อยปี เจ้าอยู่สิบเก้า!") }),
    m("river-cross", "ข้ามแม่น้ำ", "{LEAD}ข้ามแม่น้ำบนหินที่ลอยขึ้นมาเอง", "{LEAD} steps across a rushing river on stones that rise from the water one by one under her feet", 2, { say: say("LEAD", "ทีละก้าว... ทีละก้าว") }),
    m("shadow-wolves", "หมาป่าเงา", "หมาป่าที่ทำจากควันดำไล่ตาม", "wolves made of black smoke slip out between the trees and circle {LEAD} with glowing eyes", 3, { at: "B", say: say("ALLY", "อย่าวิ่ง! มันกินความกลัว") }),
    m("light-shield", "โล่แสง", "{LEAD}ยกไข่มุกขึ้น แสงสีเขียวผลักเงาออกไป", "{LEAD} raises {OBJ} high and a wave of jade light bursts out, pushing the darkness back", 2, { say: say("LEAD", "ถอยไป!") }),
    m("village-fear", "ชาวบ้านกลัว", "ชาวบ้านมองน้ำด้วยความกลัวและปิดประตูใส่", "in the village, people close their wooden shutters as {LEAD} walks past holding the glowing pearl", 1, { at: "A", say: say("LEAD", "ข้าไม่ใช่ปีศาจ!") }),
    m("mural", "ภาพจิตรกรรม", "{LEAD}พบภาพจิตรกรรมโบราณที่มีคนหน้าเหมือนตัวเอง", "{LEAD} brushes vines off an ancient temple mural showing a girl with a crescent mark holding a green pearl", 2, { at: "C", say: say("LEAD", "นี่มัน... ข้า?"), clue: "ภาพจิตรกรรมโบราณมีผู้หญิงที่มีปานจันทร์เสี้ยว" }),
    m("wing-hurt", "ปีกบาดเจ็บ", "{ALLY}ปีกบาดเจ็บจากเงา", "{ALLY} tumbles out of the air with one wing glowing faintly dim; {LEAD} catches him in both hands", 3, { say: say("ALLY", "ไม่เป็นไร... แค่ขนหลุดนิดหน่อย"), condition: { who: "ALLY", en: "one golden wing dimmed and wrapped in a strip of indigo cloth", th: "ปีกข้างหนึ่งพันผ้าคราม" } }),
    m("dream", "ความฝัน", "{LEAD}ฝันเห็นพ่อแม่เรียกจากในป่า", "{LEAD} sleeps by a small fire; in soft-focus dream light, two figures call to her from among the glowing trees", 2, { at: "B", say: say("LEAD", "พ่อ... แม่...") }),
  ],
  cliffs: [
    m("c-mask", "หน้ากากทอง", "{RIVAL}ปรากฏตัวในหมอก หน้ากากทองสะท้อนแสงไข่มุก", "{RIVAL} rises out of the mist right in front of {LEAD}, his gold mask catching the pearl's green glow", 3, { say: say("RIVAL", "ส่งมันมา เด็กน้อย") }),
    m("c-crack", "ไข่มุกร้าว", "ไข่มุกเกิดรอยร้าวเล็กๆ แสงเริ่มกะพริบ", "a hairline crack appears across {OBJ}; its glow flickers; {LEAD} stares in horror", 3),
    m("c-taken", "ปีกทองถูกจับ", "มือควันดำคว้า{ALLY}หายไปในความมืด", "a hand of black smoke snatches {ALLY} out of the air and drags him into the darkness between the trees", 3, { say: say("LEAD", "ปีกทอง!") }),
    m("c-eyes", "ดวงตาพญานาค", "รูปปั้นพญานาคลืมตาสีเขียวขึ้นมา", "the cracked golden naga statue slowly opens glowing green eyes and looks down at {LEAD}", 2),
    m("c-village", "หมู่บ้านมืด", "{LEAD}มองกลับไปเห็นหมู่บ้านถูกเงาคลุม", "from a hilltop {LEAD} looks back and sees black mist swallowing her village, lights going out one by one", 3),
    m("c-name", "เสียงเรียกชื่อ", "ป่าทั้งป่าเรียกชื่อ{LEAD}พร้อมกัน", "every glowing root in the forest pulses at once and a deep voice whispers {LEAD}'s name from all directions", 2, { say: say("ALLY", "ป่า... เลือกเจ้าแล้ว") }),
  ],
  beats: {
    OPENING: { title: "ไข่มุกในแม่น้ำ", at: "A", shots: [
      m("o1", "พบไข่มุก", "{LEAD}พบไข่มุกเรืองแสงในแม่น้ำ ขณะที่{ALLY}เกาะดูอยู่บนกิ่งไม้ และ{RIVAL}มองอยู่จากชายป่า", "dawn at the misty river: {LEAD} wades in and lifts {OBJ} from the water; {ALLY} watches from a branch above; at the forest edge {RIVAL} stands in shadow; all three clearly visible, medium-wide shot", 1, { say: say("LEAD", "สวยจัง... มาจากไหนกัน") }),
      m("o2", "นกพูดได้", "{ALLY}บินลงมาพูดกับ{LEAD}", "{ALLY} swoops down and lands on {LEAD}'s shoulder; she jumps in surprise", 1, { say: say("ALLY", "วางลงเดี๋ยวนี้ ถ้ายังรักชีวิต") }),
      m("o3", "ปฏิเสธ", "{LEAD}กอดไข่มุกไว้ไม่ยอมวาง", "{LEAD} hugs {OBJ} to her chest and steps back toward the village footbridge, defiant", 1, { say: say("LEAD", "ข้าเจอก่อน มันเป็นของข้า") }),
    ], cliff: m("o-c", "ป่าเรียก", "คืนนั้นป่าทั้งป่าเรืองแสงและเรียกชื่อ{LEAD}", "night: from her stilt-house window {LEAD} sees the whole forest glow turquoise and hears it whisper her name", 2) },
    INCITING: { title: "เข้าป่า", at: "B", shots: [
      m("i1", "ออกเดินทาง", "{LEAD}แบกห่อผ้าเดินเข้าป่า โดยมี{ALLY}บินตาม", "{LEAD} walks into the enchanted forest with her satchel, {OBJ} glowing inside it; {ALLY} flies after her grumbling", 1, { say: say("ALLY", "บ้าไปแล้ว เข้าป่าตอนกลางคืน") }),
      m("i2", "ป่ามหัศจรรย์", "ป่าหิมพานต์งดงามเกินคำบรรยาย", "{LEAD} stops and stares, amazed, as fireflies swirl around giant glowing roots", 1, { say: say("LEAD", "ทั้งชีวิตไม่เคยเห็นอะไรแบบนี้") }),
      m("i3", "สัญญา", "{ALLY}ยอมช่วยเป็นผู้นำทาง", "{ALLY} lands on a root in front of her and puffs up his golden feathers", 1, { say: say("ALLY", "ก็ได้ ข้าจะนำทาง แต่ห้ามบ่น") }),
    ], cliff: m("i-c", "เงาตามมา", "เงาดำค่อยๆ ไหลตามรอยเท้า{LEAD}", "behind {LEAD}, a black shadow slides silently along the ground, following her footprints", 2) },
    MIDPOINT: { title: "ตราผู้พิทักษ์", at: "C", shots: [
      m("mp1", "วิหาร", "ทั้งสองมาถึงวิหารร้าง", "{LEAD} and {ALLY} step into the ruined temple; moonlight falls on the cracked naga statue", 1),
      m("mp2", "ความลับ", "{ALLY}เผยความจริงเรื่องปานที่แก้ม", "{ALLY} lands on the statue and looks at {LEAD}'s crescent birthmark seriously for the first time", 1, { say: "REVEAL1" }),
      m("mp3", "ยอมรับ", "{LEAD}แตะปานที่แก้มตัวเอง", "{LEAD} touches the crescent mark on her cheek; it begins to glow softly green", 2, { say: say("LEAD", "ผู้พิทักษ์... ข้าเนี่ยนะ") }),
    ], cliff: m("mp-c", "เจ้าเงามาถึง", "หมอกดำไหลเข้าวิหาร{RIVAL}ก้าวออกมา", "black mist pours through the temple doorway and {RIVAL} steps out of it, robe trailing smoke", 3, { say: say("RIVAL", "ผู้พิทักษ์คนใหม่... ตัวเล็กกว่าที่คิด") }) },
    CRISIS: { title: "แสงที่ดับ", at: "B", shots: [
      m("cr1", "ต่อสู้", "{RIVAL}โจมตีด้วยเงา {LEAD}ล้มลง", "{RIVAL} sweeps his arm and a wave of shadow knocks {LEAD} to the forest floor", 3),
      m("cr2", "ไข่มุกหลุด", "ไข่มุกหลุดจากมือกลิ้งไปในความมืด", "{OBJ} rolls out of {LEAD}'s hand across the roots, its light dimming", 3, { say: say("LEAD", "ไม่!") }),
      m("cr3", "ปีกทองปกป้อง", "{ALLY}กางปีกบังน้ำไว้", "{ALLY} spreads his golden wings in front of {LEAD} as a shield against the darkness", 3, { say: say("ALLY", "หนีไป น้ำ!") }),
    ], cliff: m("cr-c", "มืดสนิท", "แสงทั้งป่าดับลง เหลือแต่ความมืด", "every glowing root in the forest goes dark at once; total darkness; only {LEAD}'s breathing", 3) },
    CLIMAX: { title: "หัวใจของเงา", at: "C", shots: [
      m("cl1", "เดินเข้าหา", "{LEAD}เดินเข้าหา{RIVAL}มือเปล่า", "{LEAD} walks toward {RIVAL} through the dark temple with empty open hands, unafraid", 2, { say: say("LEAD", "ท่านไม่ได้อยากทำร้ายใคร ท่านแค่กลัว") }),
      m("cl2", "เจ้าเงาสารภาพ", "{RIVAL}ถอดหน้ากากทองออก", "{RIVAL} slowly removes his gold mask, revealing a tired human face beneath", 2, { say: "REVEAL2" }),
      m("cl3", "ไข่มุกกลับมา", "ไข่มุกลอยกลับมาหา{LEAD}และเรืองแสงอีกครั้ง", "{OBJ} floats back out of the darkness into {LEAD}'s hands and blazes with jade light", 3),
    ], cliff: m("cl-c", "พญานาคตื่น", "รูปปั้นพญานาคขยับและก้มหัวลงมาหา{LEAD}", "the golden naga statue cracks open and a great glowing naga head lowers toward {LEAD}", 3) },
    FINALE: { title: "แสงกลับคืน", at: "C", shots: [
      m("f1", "คืนไข่มุก", "{LEAD}ยื่นไข่มุกคืนสู่พญานาค", "{LEAD} lifts {OBJ} up to the glowing naga; light pours through the temple and over {RIVAL}, whose robe turns from black to white", 1),
      m("f2", "ป่าสว่าง", "ป่าหิมพานต์กลับมามีแสง", "dawn: the whole forest glows again; {LEAD} stands in the light with {ALLY} on her shoulder", 1, { at: "B", say: "FINAL" }),
      m("f3", "กลับหมู่บ้าน", "{LEAD}กลับหมู่บ้าน ชาวบ้านออกมาต้อนรับ", "wide shot at sunrise: {LEAD} walks across the village footbridge as villagers open their shutters and wave; {ALLY} and a smiling {RIVAL} follow", 1, { at: "A", say: say("ALLY", "ทีนี้ข้าขอนอนสักร้อยปีนะ") }),
    ] },
  },
};

/** The first story of each genre (kept for older series and screens that show one premise per genre). */
export const GENRE_KITS: Record<DramaGenre, GenreKit> = { HORROR, ACTION, COMEDY, ROMANCE, MYSTERY, FANTASY };

/** Every story per genre, first story first. A finished season hands over to the next unused one. */
export const GENRE_STORIES: Record<DramaGenre, GenreKit[]> = Object.fromEntries(
  (Object.keys(GENRE_KITS) as DramaGenre[]).map(genre => {
    const base = GENRE_KITS[genre];
    return [genre, [base, ...MORE_STORIES[genre].map(part => ({ ...part, genre, style: part.style ?? base.style, sound: part.sound ?? base.sound }))]];
  }),
) as Record<DramaGenre, GenreKit[]>;
