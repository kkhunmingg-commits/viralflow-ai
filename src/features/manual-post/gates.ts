type Row = Record<string, unknown>;
/** EXPORT is independent of TikTok approval, but retains content and media checks. */
export function storedClipExportReady(video: Row, compliance: Row | null, originality: Row | null, script: Row | null) {
  const evidence = video.quality_explanation_json;
  const detail = evidence && typeof evidence === "object" ? evidence as Row : {};
  const score = Number(video.quality_score), threshold = Number(detail.qualityThreshold ?? 85);
  if (video.quality_status !== "PASS" || !["READY", "APPROVED"].includes(String(video.status))
    || !Number.isFinite(score) || score < threshold || score > 100 || !Number.isFinite(threshold) || threshold < 85 || threshold > 100
    || detail.reviewRequired === true || ["REVIEW", "FAIL"].includes(String(detail.visualVerificationStatus))
    || video.provider === "fal" && detail.visualVerificationStatus !== "PASS") return false;
  if (!script || compliance?.overall_status !== "PASS"
    || !["ORIGINAL", "ACCEPTABLE_VARIATION"].includes(String(originality?.originality_status))) return false;
  // Stored checks cannot authorize a script/media that was edited afterward.
  const changed = Math.max(Date.parse(String(video.updated_at)), Date.parse(String(script.updated_at)));
  const checked = Math.min(Date.parse(String(compliance.checked_at)), Date.parse(String(originality?.created_at)));
  return Number.isFinite(changed) && Number.isFinite(checked) && checked >= changed;
}
