/** ASS subtitles for a cut episode (720x1280): one Thai line per shot, the series tag, and the closing card. */
export interface EpisodeCut {
  seriesTitle: string; episodeNumber: number; totalEpisodes: number; episodeTitle: string; finale: boolean;
  shots: Array<{ durationSeconds: number; subtitle: string }>;
  /** The cast's Thai names (lead, ally, rival): a subtitle "name: line" shows the name in that character's colour. */
  speakers?: string[];
}

/** ASS colours (&HBBGGRR) for the lead, the ally and the rival. */
const SPEAKER_COLOURS = ["&H0066E0FF&", "&H00FFC864&", "&H008C8CFF&"];

/** "มิน: ใครอยู่ตรงนั้น" → the name on its own small line in the speaker's colour, then the line. */
export function subtitleText(subtitle: string, speakers: string[] = []) {
  const match = /^([^:]{1,24}):\s*(.+)$/.exec(subtitle.trim());
  const at = match ? speakers.indexOf(match[1].trim()) : -1;
  if (!match || at < 0) return wrapLine(subtitle);
  return `{\\c${SPEAKER_COLOURS[at % SPEAKER_COLOURS.length]}\\fs34}${assClean(match[1])}{\\r}\\N${wrapLine(match[2])}`;
}

export const assTime = (seconds: number) => {
  const s = Math.max(0, seconds), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), rest = s - h * 3600 - m * 60;
  return `${h}:${String(m).padStart(2, "0")}:${rest.toFixed(2).padStart(5, "0")}`;
};
/** ASS treats { } and \ as markup; subtitles are plain text. */
export const assClean = (text: string) => text.replace(/[{}\\]/g, "").replace(/\s+/g, " ").trim();

/** Thai has no spaces between words: break a long line at a space when there is one, otherwise near the middle. */
export function wrapLine(text: string, max = 22) {
  const value = assClean(text);
  if ([...value].length <= max) return value;
  const chars = [...value], middle = Math.floor(chars.length / 2);
  const spaces = chars.map((c, i) => c === " " ? i : -1).filter(i => i > 0);
  if (spaces.length) {
    const at = spaces.reduce((best, i) => Math.abs(i - middle) < Math.abs(best - middle) ? i : best, spaces[0]);
    return `${chars.slice(0, at).join("")}\\N${chars.slice(at + 1).join("")}`;
  }
  // Never split before a Thai combining vowel or tone mark (U+0E31, U+0E34–0E3A, U+0E47–0E4E).
  let at = middle;
  while (at < chars.length - 1 && /[ัิ-ฺ็-๎]/.test(chars[at])) at++;
  return `${chars.slice(0, at).join("")}\\N${chars.slice(at).join("")}`;
}

export function buildEpisodeSubtitles(cut: EpisodeCut) {
  const events: string[] = [];
  let start = 0;
  for (const shot of cut.shots) {
    const end = start + shot.durationSeconds;
    if (shot.subtitle.trim()) events.push(`Dialogue: 1,${assTime(start + .5)},${assTime(Math.max(start + 1.5, end - .4))},Sub,,0,0,0,,${subtitleText(shot.subtitle, cut.speakers)}`);
    start = end;
  }
  const total = start;
  events.push(`Dialogue: 2,${assTime(0)},${assTime(Math.min(3, total))},Tag,,0,0,0,,${assClean(cut.seriesTitle)} · EP.${cut.episodeNumber}/${cut.totalEpisodes}\\N${assClean(cut.episodeTitle)}`);
  events.push(`Dialogue: 2,${assTime(Math.max(0, total - 2.5))},${assTime(total)},End,,0,0,0,,${cut.finale ? "จบบริบูรณ์\\Nกดติดตามไว้ เพื่อดูเรื่องใหม่" : "กดติดตามไว้\\Nเพื่อดูตอนต่อไป"}`);
  return [
    "[Script Info]", "ScriptType: v4.00+", "PlayResX: 720", "PlayResY: 1280", "WrapStyle: 2", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Sub,Noto Sans Thai,44,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,3,1,2,50,50,190,1",
    "Style: Tag,Noto Sans Thai,32,&H0000D7FF,&H00FFFFFF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,2,1,7,40,40,90,1",
    "Style: End,Noto Sans Thai,58,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,1,0,0,0,100,100,0,0,3,4,0,5,60,60,0,1",
    "",
    "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events, "",
  ].join("\n");
}
