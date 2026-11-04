import { describe, expect, it } from "vitest";
import { DRAMA_GENRES, emptyStoryState, type StoryState } from "./contracts";
import { createBible, planEpisode, seasonArc } from "./showrunner";

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
function season(genre: (typeof DRAMA_GENRES)[number], total: number, shots: number) {
  const bible = createBible(genre, total);
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
  for (const genre of DRAMA_GENRES) for (const shots of [2, 3, 4, 5, 6]) {
    it(`${genre} with ${shots} shots writes a full season with no loose placeholders`, () => {
      const { bible, episodes, state } = season(genre, 12, shots);
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

  it("uses the right reference image for each shot", () => {
    const { episodes } = season("HORROR", 6, 4);
    expect(episodes[0].shots[0].referenceMode).toBe("NONE");
    for (const ep of episodes.slice(1)) expect(ep.shots[0].referenceMode).toBe("KEY_STILL");
    for (const ep of episodes) for (const shot of ep.shots.slice(1)) expect(["KEY_STILL", "PREVIOUS_FRAME"]).toContain(shot.referenceMode);
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
