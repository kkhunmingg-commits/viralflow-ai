import { emptyStoryState, type CastMember, type DramaGenre, type EpisodePhase, type Line, type PlaceKey, type PlannedEpisode,
  type PlannedShot, type ReferenceMode, type Role, type SeriesBible, type StoryState } from "./contracts";
import { GENRE_STORIES, type Beat, type EpisodeScript, type FixedPhase, type GenreKit, type Move, type Say } from "./genres";

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
// A series keeps the places it was created with; places added to its story later are read from the story itself.
const placeOf = (bible: SeriesBible, key: PlaceKey, kit?: GenreKit) =>
  bible.places.find(p => p.key === key) ?? kit?.premise.places.find(p => p.key === key) ?? bible.places[0];
/** Every place the series can visit: the ones it was created with, then any added to its story later. */
export const seriesPlaces = (bible: SeriesBible, kit = kitFor(bible)) =>
  [...bible.places, ...kit.premise.places.filter(p => !bible.places.some(b => b.key === p.key))];
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
  hook: "medium two-shot, slow push-in, steady",
  body: ["over-the-shoulder medium close-up, gentle handheld", "close-up on faces, shallow depth of field", "medium-wide two-shot, slow lateral dolly"],
  cliff: "slow push-in ending on a tight close-up, hold the final frame",
  intro: "wide establishing shot of the whole place with a slow push-in, every face clearly visible and well lit",
};

/**
 * 17 Nov (Lucky, after a competitor's drama clips): every cut changes the camera set-up, like a TV drama's coverage:
 * establishing wide, then shot / reverse shot over the listener's shoulder for each line, reaction close-ups for the
 * silent beats, and a push-in for the cliffhanger. The size never repeats twice in a row, and screen direction is kept
 * (the lead always frame-left, everyone else frame-right) so the cuts read as one scene.
 */
export function coverageCamera(input: { index: number; total: number; intro: boolean; hook: boolean; cliff: boolean; speaker: string | null; listeners: string[]; others: string[];
  previous: string | null }) {
  if (input.intro) return "wide establishing shot of the whole place with a slow push-in, every face clearly visible and well lit";
  if (input.cliff) return "slow push-in ending on a tight close-up of the face that reacts, hold the final frame";
  const options: string[] = [];
  if (input.speaker && input.listeners.length) {
    options.push(`over-the-shoulder medium close-up on ${input.speaker} past ${input.listeners[0]}'s shoulder, slow push-in`);
    options.push(`medium close-up on ${input.speaker}, ${input.listeners[0]} soft at the frame edge, slight handheld`);
  }
  if (input.speaker && !input.listeners.length) options.push(`medium close-up on ${input.speaker}, slow push-in, eyes catching the light`);
  if (!input.speaker && input.others.length) {
    options.push(`close-up reaction on ${input.others[0]}'s face, shallow depth of field, slow drift`);
    options.push("medium-wide shot from a low three-quarter angle, slow lateral dolly");
  }
  options.push("medium-wide two-shot, slow lateral dolly", "close-up on faces, shallow depth of field, gentle handheld");
  const size = (camera: string) => /^wide|medium-wide/.test(camera) ? "wide" : /close-up/.test(camera) && !/medium/.test(camera) ? "close" : "medium";
  const fresh = options.filter(camera => !input.previous || size(camera) !== size(input.previous));
  const list = fresh.length ? fresh : options;
  return list[(input.index + (input.hook ? 1 : 0)) % list.length];
}

/** Body positions that vary from shot to shot by the kind of place (Lucky: lying on the bed, sitting on the sofa...). */
const POSTURES: Array<[RegExp, string[]]> = [
  [/bed(room)?|dorm|hospital/i, ["sitting on the edge of the bed", "lying on the bed propped up on one elbow", "standing by the window of the room"]],
  [/living room|sofa|couch|condo|apartment|house|home/i, ["sitting on the sofa", "standing behind the sofa, hands on its back", "sitting on the floor leaning against the sofa"]],
  [/kitchen/i, ["leaning against the kitchen counter", "standing at the counter, busy with the hands", "sitting on a stool at the counter"]],
  [/office|meeting|desk|company/i, ["standing by the big window", "sitting on the edge of the desk", "standing at the coffee counter"]],
  [/cafe|café|restaurant|shop|store|market/i, ["sitting at a table", "standing at the counter", "walking in through the door"]],
  [/street|road|alley|park|garden|beach|field|forest|temple|car|parking/i, ["walking slowly", "standing still, turning", "sitting on a bench or low wall"]],
];
export function postureHint(placeLook: string, index: number) {
  const list = POSTURES.find(([re]) => re.test(placeLook))?.[1];
  return list ? list[index % list.length] : null;
}

/** Words in a move that mean other people (a crowd, customers, a one-off extra) belong in the shot. */
const CROWD = /\b(crowd|customers?|class|students|children|kids|passengers|people|guests|audience|villagers|everyone|strangers?|men|women|man|woman|officers?|police|figure)\b/i;
/** One take, one place: Veo otherwise flashes or morphs into a different room mid-shot. */
const CONTINUITY = "One single continuous take: no cuts, no transitions, no flashes, no dissolves. The location, background and lighting stay exactly the same from the first frame to the last, and every person's hair and clothes never change.";
const OLD = /elderly|(?<!-)\bold\b|sixties|seventies|eighties|grand(mother|father|ma|pa)|\b[6-9]\d-year/i;

/** Veo does not know who "Aunt Jaem" is: name each person by what the camera sees (age, hair, clothes). */
export function tagOf(c: CastMember) {
  const parts = c.look.split(/,\s*/);
  const hair = parts.find(part => /hair|bald|bun/i.test(part)) ?? parts[0];
  const clothes = c.outfit.split(/,| over | and /)[0].trim();
  return `${c.nameEn} (the ${c.age.replace(/^an?\s+/i, "")}, ${hair}, in ${clothes})`;
}

/**
 * The spoken line with the speaker's age, look and voice next to it, so Veo gives the line to the right person:
 * the speaker stands nearest the camera with their lips moving, everyone else on screen is named and kept silent.
 */
export function dialogueLine(speaker: CastMember, line: string, visible: boolean, silent: CastMember[] = []) {
  const aged = OLD.test(`${speaker.age} ${speaker.look}`) ? "; unmistakably an old person's voice: aged, thin, slightly shaky and breathy, never young" : "";
  const voice = `${speaker.voice}${aged}`;
  const quiet = silent.length ? ` ${silent.map(tagOf).join(" and ")} ${silent.length > 1 ? "stay" : "stays"} silent with ${silent.length > 1 ? "their mouths" : "mouth"} closed and never ${silent.length > 1 ? "speak" : "speaks"} this line.` : "";
  return visible
    ? `Dialogue (Thai, lip-synced): only ${speaker.nameEn} speaks: ${tagOf(speaker)}, in a ${voice}. ${speaker.nameEn} is in the foreground nearest the camera, face and moving lips clearly visible and lit, and says: "${line}". The voice comes from ${speaker.nameEn}'s own mouth.${quiet || " Everyone else stays silent with their mouth closed."}`
    : `Dialogue (Thai): an off-screen voice belonging to ${speaker.nameEn} (${speaker.age}), a ${voice}, says: "${line}". No one on screen speaks.${quiet}`;
}

/** Correct bodies: Veo sometimes grows a third arm or merges hands, most often in close two-shots. */
const ANATOMY = "Correct human anatomy: every person has exactly two arms, two hands and five fingers on each hand; no extra, missing or merged limbs; hands never fuse with objects or with another person.";
/** A move that jumps in time (night to morning) cannot continue from the last frame of the previous moment. */
const TIME_JUMP = /\b(late at night|that night|at night|in the morning|next morning|morning light|the next day|hours later|at dawn|midnight)\b/i;
/** A voice on a phone or radio is the one line that rightly comes from someone who is not in the shot. */
const REMOTE_VOICE = /\b(phone|on the other end|radio|walkie-talkie|intercom|loudspeaker)\b/i;

/**
 * Who the shot shows: everyone its action names, plus the speaker when the action leaves them out (a scream at a
 * falling mirror, a hook line from the friend). An off-screen voice is only for phone calls; otherwise Veo hands the
 * line to whoever is on screen.
 */
export function shotRoles(move: Move, kit: GenreKit) {
  const named = rolesIn(move.en), line = lineOf(move.say, kit);
  const joins = line && !named.includes(line.who) && !REMOTE_VOICE.test(move.en) ? line.who : null;
  return { named, joins, all: joins ? [...named, joins] : named };
}

export interface ShotDraft { move: Move; place: PlaceKey; camera: string; hook?: boolean; from?: string;
  /** A new camera set-up: the attached previous frame is a reference (Flow ingredients), not the first frame. */
  angle?: boolean; posture?: string | null }
/** The line the worker looks for to attach the picture as a reference instead of the first frame. Keep in sync with flow-farm/service.ts. */
export const ANGLE_REFERENCE = "Use the attached image only as a reference";

/** The English prompt the Flow worker types. Character and place descriptions are repeated word for word every time. */
export function shotPrompt(bible: SeriesBible, draft: ShotDraft, state: Pick<StoryState, "conditions">, mode: ReferenceMode, kit = kitFor(bible), carried: Role[] = []) {
  const place = placeOf(bible, draft.place, kit), line = lineOf(draft.move.say, kit);
  const { all: named, joins } = shotRoles(draft.move, kit);
  // Starting from the previous frame keeps whoever was in it; name them, or Veo gives one of them the line.
  const stay = mode === "PREVIOUS_FRAME" ? carried.filter(role => !named.includes(role)) : [];
  const present = [...named, ...stay];
  const speakerVisible = line ? present.includes(line.who) : false;
  const cast = present.map(role => {
    const c = castOf(bible, role), condition = state.conditions[role];
    return `- ${c.nameEn}: ${c.age}, ${c.look}; wearing ${c.outfit}${condition ? `; ${condition.en}` : ""}. Voice: ${c.voice}.`;
  });
  const speaker = line ? castOf(bible, line.who) : null;
  const silent = present.filter(role => role !== line?.who).map(role => castOf(bible, role));
  const dialogue = line && speaker ? dialogueLine(speaker, fill(line.line, bible, "th"), speakerVisible, silent) : "No dialogue; natural sound only.";
  const names = present.map(role => castOf(bible, role).nameEn);
  const background = stay.length ? ` ${stay.map(role => castOf(bible, role).nameEn).join(" and ")} ${stay.length > 1 ? "are" : "is"} still in the room from the moment before, in the background.` : "";
  const crowd = CROWD.test(draft.move.en);
  const people = names.length
    ? `People on screen: ${names.join(", ")}. Each of them appears exactly once; never duplicate a person, never show a double or a look-alike, faces never blend or morph into each other${crowd ? "" : "; no other people"}.${background}`
    : crowd ? "" : "No people on screen.";
  // Omni makes one 10-second take: spell out where it starts, what happens when, and the frame it ends on, so the next
  // shot (which starts from that last frame) continues the same moment instead of starting over.
  const from = mode === "PREVIOUS_FRAME" && draft.from ? `Continues directly from the previous shot, which ended on: ${fill(draft.from, bible, "en")}.` : "";
  const timeline = `Timeline (10 seconds): 0-2s everyone already in place and moving; 2-8s the action happens${line ? " and the line is spoken once, clearly, around the middle of the shot" : ""}; 8-10s the action eases on as the camera finishes its move, every face still in view, same people, same place.`;
  // A new camera set-up in the same place: the previous frame is only a reference for faces, clothes, place and light,
  // so the cut changes angle like a real edit instead of starting again on the same picture.
  const reference = mode === "PREVIOUS_FRAME" && draft.angle ? `${ANGLE_REFERENCE} for faces, clothes, place and light; NEW camera angle (see Camera), not the image's framing.`
    : mode === "PREVIOUS_FRAME" ? "Begin exactly on the attached image (same people, same place, same light) and continue the action from there."
    : mode === "KEY_STILL" ? "Begin on the attached image of this same place and continue from there; keep every face, hair and outfit as shown." : "";
  const posture = draft.posture ? `Blocking: unless the action says otherwise, ${names[0] ?? "the lead"} is ${draft.posture}.` : "";
  const direction = names.length > 1 ? `Screen direction: ${names[0]} frame-left, ${names.slice(1).join(" and ")} frame-right.` : "";
  const lines = [
    `${bible.style}. Vertical 9:16, one continuous 10-second shot.`,
    `Setting: ${place.look}.`,
    ...(cast.length ? ["Characters (keep faces, hair, clothes and voices identical in every shot):", ...cast] : []),
    ...(people ? [people] : []),
    ...(draft.move.en.includes("{OBJ}") ? [`Key object, always identical: ${bible.object.look}.`] : []),
    ...(from ? [from] : []),
    `Action: ${fill(draft.move.en, bible, "en")}${joins ? `; ${castOf(bible, joins).nameEn} is right there in the shot, reacting, and says the line` : ""}.`,
    timeline,
    dialogue,
    ...(posture ? [posture] : []),
    `Camera: ${draft.camera}.`,
    ...(direction ? [direction] : []),
    CONTINUITY,
    `Sound: ${bible.sound}.`,
    ...(reference ? [reference] : []),
    ANATOMY,
    "No on-screen text, no captions, no subtitles, no watermark, no logo. Realistic human motion and expressions.",
  ];
  // Flow's prompt box takes under 4000 characters: the blocking and screen-direction hints go first when it is full.
  for (const optional of [posture, direction]) if (lines.join("\n").length >= PROMPT_LIMIT && optional) lines.splice(lines.indexOf(optional), 1);
  return lines.join("\n");
}
const PROMPT_LIMIT = 3990;

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

  // A season written episode by episode: its shots are used as they are, in order.
  const script: EpisodeScript | null = kit.season && kit.season.length === bible.arc.length ? kit.season[number - 1] ?? null : null;
  // Shot 1: the cast introduction (episode 1) or the continuation of last episode's cliffhanger.
  let current: PlaceKey = state.place ?? beat?.at ?? "A";
  const drafts: ShotDraft[] = [];
  let body: Move[];
  if (script) {
    body = [];
  } else if (number === 1 && beat) {
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
  let cliff: Move | null;
  if (script) {
    // Fewer shots than written: keep the opening, the cliffhanger and the shots right before it.
    const written = script.shots, first = written[0], last = written[written.length - 1];
    const inner = written.slice(1, -1).slice(-Math.max(0, shots - 2));
    middle = inner;
    cliff = finale ? null : last;
    const order = finale ? [first, ...inner, last].slice(0, shots) : [first, ...inner, last];
    order.forEach((move, i) => {
      current = move.at ?? script.at;
      drafts.push({ move, place: current, hook: i === 0 && number > 1,
        camera: i === 0 ? (number === 1 ? CAMERA.intro : CAMERA.hook) : i === order.length - 1 && !finale ? CAMERA.cliff : CAMERA.body[(i - 1) % CAMERA.body.length] });
    });
  } else if (finale) {
    const last = body[body.length - 1], before = body.slice(0, -1);
    const extra = Math.max(0, middleCount - body.length);
    middle = middleCount <= 0 ? [] : middleCount === 1 ? [last]
      : [...before.slice(0, Math.max(0, middleCount - 1 - extra)), ...pickMoves(kit, state, "RISING", extra, rand, 0), last];
  } else {
    middle = body.slice(0, middleCount);
    if (middle.length < middleCount) middle.push(...pickMoves(kit, state, phase, middleCount - middle.length, rand, input.pulse ?? 0)
      .filter(move => !middle.some(m => m.id === move.id)));
  }
  if (!script) {
    middle.forEach((move, i) => {
      current = move.at ?? (beat ? beat.at : current);
      drafts.push({ move, place: current, camera: CAMERA.body[i % CAMERA.body.length] });
    });
    cliff = finale ? null : beat?.cliff ?? pickCliff(kit, state, rand);
    if (cliff) {
      current = cliff.at ?? current;
      drafts.push({ move: cliff, place: current, camera: CAMERA.cliff });
    }
  } else cliff = finale ? null : script.shots[script.shots.length - 1];
  // Each shot knows how the one before it ended, for the prompt's "continues from".
  drafts.forEach((draft, i) => { if (i > 0) draft.from = drafts[i - 1].move.en; else if (state.lastCliff) draft.from = state.lastCliff.en; });
  // Coverage: a different camera set-up at every cut (wide -> over-the-shoulder -> reaction close-up -> push-in).
  drafts.forEach((draft, i) => {
    const line = lineOf(draft.move.say, kit), { all } = shotRoles(draft.move, kit);
    const speaker = line ? castOf(bible, line.who).nameEn : null;
    const others = all.filter(role => role !== line?.who).map(role => castOf(bible, role).nameEn);
    const isCliff = !finale && i === drafts.length - 1 && drafts.length > 1;
    draft.camera = coverageCamera({ index: i, total: drafts.length, intro: number === 1 && i === 0, hook: !!draft.hook, cliff: isCliff,
      speaker, listeners: speaker ? others : [], others, previous: i > 0 ? drafts[i - 1].camera : null });
    // Inside one place every later shot is a new angle on the same moment; the first shot of an episode 2+ still
    // continues straight on from the last frame of the episode before (the "previously" feel).
    draft.angle = i > 0 && draft.place === drafts[i - 1].place;
    draft.posture = postureHint(placeOf(bible, draft.place, kit).look, i + number);
  });

  // Memory: lasting changes apply from the shot they happen in, so later shots (and episodes) keep them.
  const next: StoryState = { ...state, conditions: { ...state.conditions }, clues: [...state.clues], usedMoves: [...state.usedMoves], usedCliffs: [...state.usedCliffs] };
  // Flow starts a shot from the attached picture, so a picture of another room makes the background flash or morph
  // into the new one. Attach one only when it shows the same place: the previous shot's last frame, or the key still
  // (episode 1's first shot, in the opening place). A shot in a new place starts from its description alone.
  const stillPlace = kit.beats.OPENING?.at ?? "A";
  // Who is visible at the end of each shot: the people it names, plus anyone it carried over from the frame before.
  const seen: Role[][] = [];
  const planned: PlannedShot[] = drafts.map((draft, i) => {
    const mode: ReferenceMode = number === 1 && i === 0 ? "NONE"
      : TIME_JUMP.test(draft.move.en) ? "NONE"
      // Episode 2 onward, in the place the last episode ended: start from that episode's last frame.
      : i === 0 && state.place && draft.place === state.place && state.lastCliff ? "PREVIOUS_FRAME"
      : i > 0 && draft.place === drafts[i - 1].place ? "PREVIOUS_FRAME" : draft.place === stillPlace ? "KEY_STILL" : "NONE";
    const carried = mode === "PREVIOUS_FRAME" ? seen[i - 1] ?? [] : [];
    const own = shotRoles(draft.move, kit).all;
    seen[i] = [...own, ...carried.filter(role => !own.includes(role))];
    const prompt = shotPrompt(bible, draft, next, mode, kit, carried);
    if (draft.move.condition) next.conditions[draft.move.condition.who] = { en: draft.move.condition.en, th: draft.move.condition.th };
    if (draft.move.clue && !next.clues.includes(draft.move.clue)) next.clues.push(draft.move.clue);
    if (!draft.hook && !fixedKey && !script && draft.move !== cliff) next.usedMoves.push(draft.move.id);
    const line = lineOf(draft.move.say, kit);
    // The subtitle names who speaks ("มิน: ..."); the cut colours each name.
    return { position: i + 1, summary: fill(draft.move.th, bible, "th"), prompt, subtitle: line ? `${castOf(bible, line.who).name}: ${fill(line.line, bible, "th")}` : "",
      speaker: line?.who ?? null, referenceMode: mode };
  });
  if (cliff && !fixedKey && !script) next.usedCliffs.push(cliff.id);
  // Fixed beats also use moves picked to pad them; remember those too.
  middle.filter(move => kit.moves.includes(move) && !next.usedMoves.includes(move.id)).forEach(move => next.usedMoves.push(move.id));

  const title = script?.title ?? beat?.title ?? middle[0]?.t ?? "ตอนใหม่";
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
    finale ? "จบบริบูรณ์ ขอบคุณที่ดูจนตอนสุดท้าย กดติดตามไว้ เพื่อดูเรื่องใหม่" : "กดติดตามไว้ เพื่อดูตอนต่อไป",
  ].filter(Boolean).join("\n").slice(0, 1800);
  return { number, phase, title, summary: summary.slice(0, 2000), cliffhanger: next.lastCliff?.th ?? "", shots: planned, stateAfter: next,
    caption, hashtags: bible.hashtags.slice(0, 6) };
}
