import { assClean, assTime, wrapLine } from "@/features/drama/subtitles";

/**
 * Subtitles burned into a product clip (720x1280): each take's spoken line, a small "made with AI" label for the
 * whole clip (platform disclosure), and "link in the comments" over the last seconds. Reels and Shorts start muted,
 * so the words have to be readable.
 */
export function buildProductSubtitles(input: { lines: string[]; durations: number[]; endCard: string; aiLabel: string; hookText?: string }) {
  const events: string[] = [];
  // Big words at the top for the first seconds: the reason to keep watching, readable with the sound off.
  if (input.hookText?.trim()) events.push(`Dialogue: 3,${assTime(0)},${assTime(Math.min(3, input.durations[0] ?? 3))},Hook,,0,0,0,,{\\fad(0,250)}${wrapLine(input.hookText.trim(), 16)}`);
  let start = 0;
  input.durations.forEach((duration, i) => {
    const end = start + duration, line = input.lines[i]?.trim();
    if (line) events.push(`Dialogue: 1,${assTime(start + .4)},${assTime(Math.max(start + 1.5, end - .3))},Sub,,0,0,0,,${wrapLine(line, 24)}`);
    start = end;
  });
  const total = start;
  events.push(`Dialogue: 0,${assTime(0)},${assTime(total)},Label,,0,0,0,,${assClean(input.aiLabel)}`);
  events.push(`Dialogue: 2,${assTime(Math.max(0, total - 2.5))},${assTime(total)},End,,0,0,0,,${wrapLine(input.endCard, 20)}`);
  return [
    "[Script Info]", "ScriptType: v4.00+", "PlayResX: 720", "PlayResY: 1280", "WrapStyle: 2", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Sub,Noto Sans Thai,44,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,3,1,2,50,50,210,1",
    "Style: Label,Noto Sans Thai,24,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,3,2,0,9,30,30,40,1",
    "Style: Hook,Noto Sans Thai,62,&H00FFFFFF,&H00FFFFFF,&H00000000,&HB4000000,1,0,0,0,100,100,0,0,3,6,0,8,50,50,170,1",
    "Style: End,Noto Sans Thai,52,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,1,0,0,0,100,100,0,0,3,4,0,8,60,60,330,1",
    "",
    "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events, "",
  ].join("\n");
}
