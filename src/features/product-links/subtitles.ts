import { assClean, assTime, wrapLine } from "@/features/drama/subtitles";

/** An ASS drawing of a rounded rectangle w x h centred on its \\pos (radius h/2: a pill). */
function pill(w: number, h: number) {
  const r = h / 2, x0 = 0, x1 = w, y0 = 0, y1 = h, k = r * 0.552;
  const n = (v: number) => Math.round(v);
  return [`m ${n(x0 + r)} ${n(y0)}`, `l ${n(x1 - r)} ${n(y0)}`, `b ${n(x1 - r + k)} ${n(y0)} ${n(x1)} ${n(r - k)} ${n(x1)} ${n(r)}`,
    `b ${n(x1)} ${n(r + k)} ${n(x1 - r + k)} ${n(y1)} ${n(x1 - r)} ${n(y1)}`, `l ${n(x0 + r)} ${n(y1)}`,
    `b ${n(x0 + r - k)} ${n(y1)} ${n(x0)} ${n(r + k)} ${n(x0)} ${n(r)}`, `b ${n(x0)} ${n(r - k)} ${n(x0 + r - k)} ${n(y0)} ${n(x0 + r)} ${n(y0)}`].join(" ");
}
/** Thai base letters (marks above/below take no width): shrink a long end card so it stays on one line in the pill. */
function endFontSize(text: string) {
  const width = [...text].filter(c => !/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/.test(c)).length;
  return Math.max(30, Math.min(54, Math.floor(540 / Math.max(1, width) / 0.62)));
}

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
  // The end card: one line (never broken inside a Thai word) on a rounded brand-pink pill in the lower third,
  // below the product, fading in (10 Nov owner: the old two-line black box split "อยู่" and was hard to read).
  const endStart = Math.max(0, total - 2.8), endText = assClean(input.endCard);
  events.push(`Dialogue: 2,${assTime(endStart)},${assTime(total)},Pill,,0,0,0,,{\\an5\\pos(360,1120)\\fad(250,0)\\p1}${pill(600, 108)}{\\p0}`);
  events.push(`Dialogue: 3,${assTime(endStart)},${assTime(total)},End,,0,0,0,,{\\an5\\pos(360,1120)\\fad(250,0)\\fs${endFontSize(endText)}}${endText}`);
  return [
    "[Script Info]", "ScriptType: v4.00+", "PlayResX: 720", "PlayResY: 1280", "WrapStyle: 2", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Sub,Noto Sans Thai,44,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,3,1,2,50,50,210,1",
    "Style: Label,Noto Sans Thai,24,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,3,2,0,9,30,30,40,1",
    "Style: Hook,Noto Sans Thai,62,&H00FFFFFF,&H00FFFFFF,&H00000000,&HB4000000,1,0,0,0,100,100,0,0,3,6,0,8,50,50,170,1",
    "Style: End,Noto Sans Thai,46,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1",
    "Style: Pill,Noto Sans Thai,20,&H006B3BFF,&H006B3BFF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,0,6,5,0,0,0,1",
    "",
    "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events, "",
  ].join("\n");
}
