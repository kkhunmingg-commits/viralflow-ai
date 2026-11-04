import { emptyStoryState, type CastMember, type DramaGenre, type EpisodePhase, type Line, type PlaceKey, type PlannedEpisode,
  type PlannedShot, type ReferenceMode, type Role, type SeriesBible, type StoryState } from "./contracts";
import { GENRE_STORIES, type Beat, type FixedPhase, type GenreKit, type Move, type Say } from "./genres";

/**
 * The built-in showrunner: writes a whole season up front (cast, places, hidden truth, locked ending and the phase of
 * every episode), then writes each episode from the story's running memory. Free and deterministic; a language-model
 * writer can replace `planEpisode` later without changing anything around it.
 */
export const SHOWRUNNER_WRITER = "showrunner-v1";
const ROLES: Role[] = ["LEAD", "ALLY", "RIVAL"];

/** Phase of every episode. The last is always the finale and the one before it the climax, so the story ends on time. */
export function seasonArc(total: number): EpisodePhase[] {
  const n = Math.max(3, Math.floor(total));
  const arc: EpisodePhase[] = Array.from({ length: n }, () => "RISING");
  const set = (index: number, phase: EpisodePhase) => { if (index >= 0 && index < n && arc[index] === "RISING") arc[index] = phase; };
  arc[n - 1] = "FINALE";
  arc[0] = "OPENING";
  if (n >= 4) set(n - 2, "CLIMAX");
  if (n >= 5) set(1, "INCITING");
  if (n >= 6) set(Math.min(Math.round(n * 0.75) - 1, n - 3), "CRISIS");
  set(Math.round(n / 2) - 1, "MIDPOINT");
  const midpoint = arc.indexOf("MIDPOINT");
  return arc.map((phase, i) => phase === "RISING" && midpoint >= 0 && i > midpoint ? "ESCALATION" : phase);
}

/** The story kit a series was written from (its premise key), or the genre's first story. */
export function kitFor(bible: Pick<SeriesBible, "genre" | "premiseKey">): GenreKit {
  const stories = GENRE_STORIES[bible.genre];
  return stories.find(kit => kit.premise.key === bible.premiseKey) ?? stories[0];
}

/** The next story for a genre: the first one not made yet, otherwise the one made longest ago. */
export function pickStory(genre: DramaGenre, used: string[]) {
  const stories = GENRE_STORIES[genre];
  const fresh = stories.find(kit => !used.includes(kit.premise.key));
  if (fresh) return fresh.premise.key;
  const lastUse = (key: string) => used.lastIndexOf(key);
  return stories.toSorted((a, b) => lastUse(a.premise.key) - lastUse(b.premise.key))[0].premise.key;
}

export function createBible(genre: DramaGenre, totalEpisodes: number, storyKey?: string): SeriesBible {
  const kit = kitFor({ genre, premiseKey: storyKey ?? "" }), p = kit.premise;
  return { version: 1, genre, premiseKey: p.key, title: p.title, logline: p.logline, style: kit.style, sound: kit.sound,
    hashtags: [...kit.hashtags, `#${p.title.replace(/\s+/g, "")}`], cast: p.cast, places: p.places, object: p.object,
    truth: p.truth, ending: p.ending, arc: seasonArc(totalEpisodes) };
}

/** Small deterministic random source so a series always writes the same episode from the same memory. */
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

const castOf = (bible: SeriesBible, role: Role) => bible.cast.find(c => c.role === role) as CastMember;
const placeOf = (bible: SeriesBible, key: PlaceKey) => bible.places.find(p => p.key === key) ?? bible.places[0];
const objectNoun = (look: string) => look.replace(/^(an?|the)\s+/i, "the ");

/** Fills {LEAD}/{ALLY}/{RIVAL}/{OBJ} with English (prompts) or Thai (subtitles, summaries). */
export function fill(text: string, bible: SeriesBible, language: "en" | "th") {
  return text.replace(/\{(LEAD|ALLY|RIVAL|OBJ)\}/g, (_, key: string) => key === "OBJ"
    ? (language === "en" ? objectNoun(bible.object.look) : bible.object.name)
    : (language === "en" ? castOf(bible, key as Role).nameEn : castOf(bible, key as Role).name));
}
const rolesIn = (text: string) => ROLES.filter(role => text.includes(`{${role}}`));

function lineOf(say: Say | undefined, kit: GenreKit): Line | null {
  if (!say) return null;
  if (say === "REVEAL1") return kit.premise.reveal1;
  if (say === "REVEAL2") return kit.premise.reveal2;
  if (say === "FINAL") return kit.premise.finalLine;
  return say;
}

const CAMERA = {
  hook: "medium shot, slow push-in, steady",
  body: ["over-the-shoulder medium close-up, gentle handheld", "close-up on faces, shallow depth of field", "medium-wide two-shot, slow lateral dolly"],
  cliff: "slow push-in ending on a tight close-up, hold the final frame",
  intro: "medium-wide establishing shot, every face clearly visible and well lit",
};

export interface ShotDraft { move: Move; place: PlaceKey; camera: string; hook?: boolean }

/** The English prompt the Flow worker types. Character and place descriptions are repeated word for word every time. */
export function shotPrompt(bible: SeriesBible, draft: ShotDraft, state: Pick<StoryState, "conditions">, mode: ReferenceMode, kit = kitFor(bible)) {
  const place = placeOf(bible, draft.place), line = lineOf(draft.move.say, kit);
  const present = rolesIn(draft.move.en);
  const speakerVisible = line ? present.includes(line.who) : false;
  const cast = present.map(role => {
    const c = castOf(bible, role), condition = state.conditions[role];
    return `- ${c.nameEn}: ${c.age}, ${c.look}; wearing ${c.outfit}${condition ? `; ${condition.en}` : ""}. Voice: ${c.voice}.`;
  });
  const speaker = line ? castOf(bible, line.who) : null;
  const dialogue = line && speaker
    ? speakerVisible ? `Dialogue: ${speaker.nameEn} says in Thai, clearly and naturally: "${fill(line.line, bible, "th")}"`
      : `Dialogue: an off-screen ${speaker.voice} says in Thai: "${fill(line.line, bible, "th")}"`
    : "No dialogue; natural sound only.";
  const reference = mode === "PREVIOUS_FRAME" ? "Begin exactly on the attached image (same people, same place, same light) and continue the action from there."
    : mode === "KEY_STILL" ? "Match every character's face, hair and clothes to the attached reference image." : "";
  return [
    `${bible.style}. Vertical 9:16, one continuous 8-second shot.`,
    `Setting: ${place.look}.`,
    ...(cast.length ? ["Characters (keep faces, hair, clothes and voices identical in every shot):", ...cast] : []),
    ...(draft.move.en.includes("{OBJ}") ? [`Key object, always identical: ${bible.object.look}.`] : []),
    `Action: ${fill(draft.move.en, bible, "en")}.`,
    dialogue,
    `Camera: ${draft.camera}.`,
    `Sound: ${bible.sound}.`,
    ...(reference ? [reference] : []),
    "No on-screen text, no captions, no subtitles, no watermark, no logo. Realistic human motion and expressions.",
  ].join("\n");
}

function pickMoves(kit: GenreKit, state: StoryState, phase: EpisodePhase, count: number, rand: () => number, pulse: number) {
  const levels = phase === "ESCALATION" ? [2, 3] : pulse > .2 ? [2, 3] : [1, 2];
  const recent = new Set(state.usedMoves.slice(-(kit.moves.length - count)));
  let pool = kit.moves.filter(move => levels.includes(move.level) && !recent.has(move.id));
  if (pool.length < count) pool = kit.moves.filter(move => !recent.has(move.id));
  if (pool.length < count) pool = [...kit.moves];
  const chosen: Move[] = [];
  while (chosen.length < count && pool.length) chosen.push(...pool.splice(Math.floor(rand() * pool.length), 1));
  return chosen;
}
function pickCliff(kit: GenreKit, state: StoryState, rand: () => number) {
  const recent = new Set(state.usedCliffs.slice(-(kit.cliffs.length - 1)));
  const pool = kit.cliffs.filter(cliff => !recent.has(cliff.id));
  return (pool.length ? pool : kit.cliffs)[Math.floor(rand() * (pool.length || kit.cliffs.length))];
}

const FIXED: Partial<Record<EpisodePhase, FixedPhase>> = { OPENING: "OPENING", INCITING: "INCITING", MIDPOINT: "MIDPOINT", CRISIS: "CRISIS", CLIMAX: "CLIMAX", FINALE: "FINALE" };

/**
 * Writes episode `number` from the story so far. Shot 1 picks up the previous cliffhanger (episode 1 introduces the
 * cast instead, and its last frame becomes the series key still); the last shot is a new cliffhanger, or the ending.
 */
export function planEpisode(input: { bible: SeriesBible; state: StoryState; number: number; shotsPerEpisode: number; seed: string; pulse?: number }): PlannedEpisode {
  const { bible, number } = input, kit = kitFor(bible), state = input.state ?? emptyStoryState();
  const shots = Math.max(2, Math.min(6, Math.floor(input.shotsPerEpisode)));
  const phase = bible.arc[number - 1] ?? "FINALE";
  const rand = random(`${input.seed}:${number}`);
  const fixedKey = FIXED[phase], beat: Beat | null = fixedKey ? kit.beats[fixedKey] : null;
  const finale = phase === "FINALE";

  // Shot 1: the cast introduction (episode 1) or the continuation of last episode's cliffhanger.
  let current: PlaceKey = state.place ?? beat?.at ?? "A";
  const drafts: ShotDraft[] = [];
  let body: Move[];
  if (number === 1 && beat) {
    current = beat.at;
    drafts.push({ move: beat.shots[0], place: current, camera: CAMERA.intro });
    body = beat.shots.slice(1);
  } else {
    const previous = state.lastCliff ?? { en: "a tense silence", th: "ความเงียบที่ตึงเครียด" };
    const hookLine = kit.hooks[Math.floor(rand() * kit.hooks.length)];
    drafts.push({ hook: true, place: current, camera: CAMERA.hook, move: { id: `hook-${number}`, t: "ต่อจากตอนที่แล้ว", level: 2,
      th: `ต่อจากตอนที่แล้ว: ${previous.th}`,
      en: `the scene picks up the exact moment from before (${previous.en}); {LEAD} reacts, catches a breath and the tension holds`,
      say: hookLine } });
    body = beat ? [...beat.shots] : [];
  }

  // Middle shots, then the cliffhanger (or, in the finale, the ending shot last).
  const middleCount = finale ? shots - 1 : shots - 2;
  let middle: Move[];
  if (finale) {
    const last = body[body.length - 1], before = body.slice(0, -1);
    const extra = Math.max(0, middleCount - body.length);
    middle = middleCount <= 0 ? [] : middleCount === 1 ? [last]
      : [...before.slice(0, Math.max(0, middleCount - 1 - extra)), ...pickMoves(kit, state, "RISING", extra, rand, 0), last];
  } else {
    middle = body.slice(0, middleCount);
    if (middle.length < middleCount) middle.push(...pickMoves(kit, state, phase, middleCount - middle.length, rand, input.pulse ?? 0)
      .filter(move => !middle.some(m => m.id === move.id)));
  }
  middle.forEach((move, i) => {
    current = move.at ?? (beat ? beat.at : current);
    drafts.push({ move, place: current, camera: CAMERA.body[i % CAMERA.body.length] });
  });
  const cliff = finale ? null : beat?.cliff ?? pickCliff(kit, state, rand);
  if (cliff) {
    current = cliff.at ?? current;
    drafts.push({ move: cliff, place: current, camera: CAMERA.cliff });
  }

  // Memory: lasting changes apply from the shot they happen in, so later shots (and episodes) keep them.
  const next: StoryState = { ...state, conditions: { ...state.conditions }, clues: [...state.clues], usedMoves: [...state.usedMoves], usedCliffs: [...state.usedCliffs] };
  const planned: PlannedShot[] = drafts.map((draft, i) => {
    const mode: ReferenceMode = number === 1 && i === 0 ? "NONE" : i === 0 ? "KEY_STILL"
      : draft.place === drafts[i - 1].place ? "PREVIOUS_FRAME" : "KEY_STILL";
    const prompt = shotPrompt(bible, draft, next, mode, kit);
    if (draft.move.condition) next.conditions[draft.move.condition.who] = { en: draft.move.condition.en, th: draft.move.condition.th };
    if (draft.move.clue && !next.clues.includes(draft.move.clue)) next.clues.push(draft.move.clue);
    if (!draft.hook && !fixedKey && draft.move !== cliff) next.usedMoves.push(draft.move.id);
    const line = lineOf(draft.move.say, kit);
    return { position: i + 1, summary: fill(draft.move.th, bible, "th"), prompt, subtitle: line ? fill(line.line, bible, "th") : "",
      speaker: line?.who ?? null, referenceMode: mode };
  });
  if (cliff && !fixedKey) next.usedCliffs.push(cliff.id);
  // Fixed beats also use moves picked to pad them; remember those too.
  middle.filter(move => kit.moves.includes(move) && !next.usedMoves.includes(move.id)).forEach(move => next.usedMoves.push(move.id));

  const title = beat?.title ?? middle[0]?.t ?? "ตอนใหม่";
  const summary = planned.map(shot => shot.summary).join(" ");
  next.episode = number;
  next.place = current;
  next.lastCliff = cliff ? { th: fill(cliff.th, bible, "th"), en: fill(cliff.en, bible, "en") } : null;
  next.usedMoves = next.usedMoves.slice(-40);
  next.usedCliffs = next.usedCliffs.slice(-20);
  next.recap = [...state.recap, { episode: number, title, summary: summary.slice(0, 400) }].slice(-6);

  const total = bible.arc.length;
  const caption = [
    `${bible.title} EP.${number}/${total} ${title}`,
    planned[planned.length - 1]?.summary ?? "",
    finale ? "จบบริบูรณ์ ขอบคุณที่ติดตามจนตอนสุดท้าย" : "ตอนต่อไปมาพรุ่งนี้ กดติดตามไว้ไม่พลาด",
  ].filter(Boolean).join("\n").slice(0, 1800);
  return { number, phase, title, summary: summary.slice(0, 2000), cliffhanger: next.lastCliff?.th ?? "", shots: planned, stateAfter: next,
    caption, hashtags: bible.hashtags.slice(0, 6) };
}
