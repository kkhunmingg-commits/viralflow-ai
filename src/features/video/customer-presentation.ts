type CustomerVideo = { status?: unknown; quality_status?: unknown; quality_explanation_json?: unknown };

/** Only these fixed customer labels may leave the server; provider details remain in server records. */
export function customerVideoStatus(video: CustomerVideo) {
  const explanation = video.quality_explanation_json;
  const review = explanation && typeof explanation === "object" && "reviewRequired" in explanation && explanation.reviewRequired === true;
  const cancelled = explanation && typeof explanation === "object" && "cancelled" in explanation && explanation.cancelled === true;
  if (cancelled || video.status === "CANCELLED") return "ยกเลิกแล้ว";
  if (review || (["READY", "APPROVED"].includes(String(video.status)) && video.quality_status !== "PASS")) return "REVIEW_REQUIRED";
  if (["QUEUED", "PROCESSING", "RETRYING"].includes(String(video.status))) return "กำลังสร้างวิดีโอ";
  if (["READY", "APPROVED"].includes(String(video.status)) && video.quality_status === "PASS") return "สำเร็จ";
  return "สร้างวิดีโอไม่สำเร็จ";
}
