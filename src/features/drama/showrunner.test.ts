import { describe, expect, it } from "vitest";
import { DRAMA_GENRES, emptyStoryState, type StoryState } from "./contracts";
import { GENRE_STORIES } from "./genres";
import { createBible, kitFor, pickStory, planEpisode, seasonArc } from "./showrunner";

describe("seasonArc", () => {
  it.each([3, 4, 5, 6, 10, 15, 20, 30, 60])("plans %i episodes that open and end the season", total => {
    const arc = seasonArc(total);
    expect(arc).toHaveLength(total);
    expect(arc[0]).toBe("OPENING");
    expect(arc.at(-1)).toBe("FINALE");
    expect(arc.filter(p => p === "FINALE")).toHaveLength(1);
    if (total >= 4) expect(arc.at(-2)).toBe("CLIMAX");
    if (total >= 6) { expect(arc).toContain("MIDPOINT"); expect(arc).toContain("CRISIS"); }
    // Rising action never comes after the midpoint.
    const mid = arc.indexOf("MIDPOINT");
    if (mid >= 0) expect(arc.slice(mid + 1)).not.toContain("RISING");
  });
});

/** Writes a whole season the way the service does: each episode from the state the previous one left. */
function season(genre: (typeof DRAMA_GENRES)[number], total: number, shots: number, story?: string) {
  const bible = createBible(genre, total, story);
  let state: StoryState = emptyStoryState();
  const episodes = [];
  for (let n = 1; n <= total; n++) {
    const ep = planEpisode({ bible, state, number: n, shotsPerEpisode: shots, seed: `series-${genre}` });
    episodes.push(ep);
    state = ep.stateAfter;
  }
  return { bible, episodes, state };
}

describe("planEpisode", () => {
  for (const genre of DRAMA_GENRES) for (const kit of GENRE_STORIES[genre]) for (const shots of [2, 3, 4, 5, 6]) {
    it(`${kit.premise.key} with ${shots} shots writes a full season with no loose placeholders`, () => {
      const { bible, episodes, state } = season(genre, 12, shots, kit.premise.key);
      expect(bible.premiseKey).toBe(kit.premise.key);
      expect(bible.cast).toHaveLength(3);
      for (const ep of episodes) {
        expect(ep.shots).toHaveLength(shots);
        expect(ep.shots.map(s => s.position)).toEqual(Array.from({ length: shots }, (_, i) => i + 1));
        for (const shot of ep.shots) {
          expect(shot.prompt).not.toMatch(/\{(LEAD|ALLY|RIVAL|OBJ)\}|REVEAL[12]|undefined|\bnull\b|NaN/);
          expect(shot.subtitle).not.toMatch(/\{|undefined/);
          expect(shot.prompt.length).toBeLessThan(4000);
        }
        expect(ep.caption.length).toBeLessThanOrEqual(2200);
        expect(ep.caption).toContain(`EP.${ep.number}/12`);
        expect(ep.stateAfter.episode).toBe(ep.number);
      }
      expect(episodes.at(-1)!.phase).toBe("FINALE");
      expect(episodes.at(-1)!.caption).toContain("จบบริบูรณ์");
      expect(state.recap.length).toBeLessThanOrEqual(6);
    });
  }

  it("attaches a start picture only when it shows the same place", () => {
    const { episodes } = season("HORROR", 6, 4);
    expect(episodes[0].shots[0].referenceMode).toBe("NONE");
    for (const [e, ep] of episodes.entries()) for (const [i, shot] of ep.shots.entries()) {
      expect(["NONE", "KEY_STILL", "PREVIOUS_FRAME"]).toContain(shot.referenceMode);
      // The first shot of a later episode may pick up from the cliffhanger frame of the episode before.
      if (shot.referenceMode === "PREVIOUS_FRAME") expect(i + e).toBeGreaterThan(0);
    }
    // Episode 1 of บ้านกระจกผ้าแดง: hall, hall, hall, hall, then the attic starts fresh instead of morphing from the hall.
    expect(episodes[0].shots.map(s => s.referenceMode)).toContain("NONE");
  });

  it("gives every line its speaker's voice and age, and keeps one take in one place", () => {
    const { episodes } = season("HORROR", 6, 5);
    const prompts = episodes.flatMap(ep => ep.shots.map(s => s.prompt));
    expect(prompts.every(p => p.includes("no cuts, no transitions, no flashes"))).toBe(true);
    const jaem = prompts.find(p => p.includes("only Aunt Jaem"));
    expect(jaem).toMatch(/old person.s voice/);
    expect(prompts.filter(p => p.includes("only Min")).some(p => p.includes("old person"))).toBe(false);
    const lines = episodes.flatMap(ep => ep.shots.filter(s => s.subtitle));
    expect(lines.every(s => /^(มิน|ต้น|ป้าแจ่ม): /.test(s.subtitle))).toBe(true);
  });

  it("names the speaker by look, keeps everyone from the previous frame silent, and guards anatomy", () => {
    const { episodes } = season("HORROR", 6, 5);
    const [, key, night] = episodes[0].shots;
    // Aunt Jaem hands over the key while Ton, still in the frame from shot 1, stays silent.
    expect(key.referenceMode).toBe("PREVIOUS_FRAME");
    expect(key.prompt).toContain("only Aunt Jaem speaks: Aunt Jaem (the elderly Thai woman in her sixties, silver hair in a tight bun");
    expect(key.prompt).toMatch(/Ton \(the 26-year-old Thai man[^)]*\) stay silent/);
    expect(key.prompt).toContain("Ton is still in the room from the moment before");
    // Late at night is a jump in time: it starts fresh instead of continuing the daytime frame.
    expect(night.referenceMode).toBe("NONE");
    const prompts = episodes.flatMap(ep => ep.shots.map(s => s.prompt));
    expect(prompts.every(p => p.includes("exactly two arms"))).toBe(true);
  });

  it("puts every speaker on screen in every story, except a voice on the phone", () => {
    for (const genre of DRAMA_GENRES) for (const story of GENRE_STORIES[genre]) {
      const { episodes } = season(genre, 12, 5, story.premise.key);
      for (const ep of episodes) for (const shot of ep.shots) {
        if (!shot.subtitle) continue;
        const where = `${story.premise.key} EP${ep.number} shot ${shot.position}`;
        if (shot.prompt.includes("off-screen voice")) {
          expect(shot.prompt, where).toMatch(/phone|radio|intercom|walkie-talkie|loudspeaker|on the other end/i);
          continue;
        }
        const speaker = shot.prompt.match(/only (.+?) speaks:/)?.[1];
        expect(speaker, where).toBeTruthy();
        expect(shot.prompt.match(/People on screen: (.+?)\. Each of them/)?.[1], where).toContain(speaker);
        // An action that keeps the speaker silent fights the line (a hook only recalls how the last episode ended).
        if (!shot.prompt.includes("picks up the exact moment")) expect(shot.prompt.match(/Action: ([^\n]+)/)?.[1], where).not.toMatch(/\bsilently\b|in silence|without a word/i);
      }
    }
  });

  it("picks up the previous cliffhanger and carries memory forward", () => {
    const { episodes } = season("MYSTERY", 8, 4);
    for (let i = 1; i < episodes.length; i++) {
      expect(episodes[i - 1].stateAfter.lastCliff).not.toBeNull();
      expect(episodes[i].stateAfter.recap.at(-1)!.episode).toBe(i + 1);
    }
    expect(episodes.at(-1)!.stateAfter.usedMoves.length).toBeGreaterThan(0);
  });

  it("is deterministic for the same series and episode", () => {
    const bible = createBible("ROMANCE", 10);
    const a = planEpisode({ bible, state: emptyStoryState(), number: 1, shotsPerEpisode: 4, seed: "x" });
    const b = planEpisode({ bible, state: emptyStoryState(), number: 1, shotsPerEpisode: 4, seed: "x" });
    expect(a).toEqual(b);
  });

  it("repeats each character's locked look word for word in every prompt they appear in", () => {
    const { bible, episodes } = season("FANTASY", 6, 4);
    const lead = bible.cast.find(c => c.role === "LEAD")!;
    const withLead = episodes.flatMap(e => e.shots).filter(s => s.prompt.includes(lead.nameEn));
    expect(withLead.length).toBeGreaterThan(0);
    for (const shot of withLead) expect(shot.prompt).toContain(lead.look);
  });
});

describe("stories", () => {
  it("has at least two complete stories per genre with unique keys and cast names", () => {
    const keys = new Set<string>();
    for (const genre of DRAMA_GENRES) {
      expect(GENRE_STORIES[genre].length).toBeGreaterThanOrEqual(2);
      for (const kit of GENRE_STORIES[genre]) {
        expect(kit.genre).toBe(genre);
        expect(keys.has(kit.premise.key)).toBe(false);
        keys.add(kit.premise.key);
        expect(kit.premise.cast.map(c => c.role).toSorted()).toEqual(["ALLY", "LEAD", "RIVAL"]);
        expect(kit.premise.places.map(p => p.key)).toEqual(["A", "B", "C"]);
        expect(kit.moves.length).toBeGreaterThanOrEqual(8);
        expect(kit.cliffs.length).toBeGreaterThanOrEqual(5);
        expect(kit.beats.FINALE.cliff).toBeUndefined();
        expect(kit.beats.MIDPOINT.shots.some(s => s.say === "REVEAL1")).toBe(true);
        expect(kit.beats.CLIMAX.shots.some(s => s.say === "REVEAL2")).toBe(true);
        expect(kit.beats.FINALE.shots.some(s => s.say === "FINAL")).toBe(true);
      }
    }
  });

  it("picks an unused story first, then the one made longest ago", () => {
    const [first, second] = GENRE_STORIES.HORROR.map(k => k.premise.key);
    expect(pickStory("HORROR", [])).toBe(first);
    expect(pickStory("HORROR", [first])).toBe(second);
    expect(pickStory("HORROR", [first, second])).toBe(first);
    expect(pickStory("HORROR", [second, first])).toBe(second);
  });

  it("keeps old series on their own story and falls back to the first", () => {
    expect(kitFor({ genre: "COMEDY", premiseKey: GENRE_STORIES.COMEDY[1].premise.key })).toBe(GENRE_STORIES.COMEDY[1]);
    expect(kitFor({ genre: "COMEDY", premiseKey: "gone" })).toBe(GENRE_STORIES.COMEDY[0]);
  });
});

describe("written seasons", () => {
  const written = Object.values(GENRE_STORIES).flat().filter(kit => kit.season);
  it("has a written season for at least one story", () => expect(written.length).toBeGreaterThan(0));
  for (const kit of written) {
    it(`${kit.premise.key}: 30 episodes, 5 shots each, continuous and within Flow's prompt size`, () => {
      expect(kit.season).toHaveLength(30);
      const ids = new Set<string>();
      for (const script of kit.season!) {
        expect(script).not.toBeNull();
        expect(script!.shots).toHaveLength(5);
        for (const move of script!.shots) { expect(ids.has(move.id)).toBe(false); ids.add(move.id); }
      }
      const bible = createBible(kit.genre, 30, kit.premise.key);
      let state = emptyStoryState();
      for (let n = 1; n <= 30; n++) {
        const ep = planEpisode({ bible, state, number: n, shotsPerEpisode: 5, seed: "s" });
        expect(ep.title).toBe(kit.season![n - 1]!.title);
        expect(ep.shots).toHaveLength(5);
        for (const shot of ep.shots) { expect(shot.prompt.length).toBeLessThan(12000); expect(shot.prompt).not.toMatch(/\{(LEAD|ALLY|RIVAL|OBJ)\}/); }
        // Inside an episode every shot after the first continues from the last frame of the one before.
        const script = kit.season![n - 1]!;
        expect(ep.shots.slice(1).every((shot, i) => shot.referenceMode === "PREVIOUS_FRAME" || Boolean(script.shots[i + 1].at && script.shots[i + 1].at !== script.at))).toBe(true);
        state = ep.stateAfter;
      }
    });
  }
});
