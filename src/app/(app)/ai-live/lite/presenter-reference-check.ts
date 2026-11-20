export interface PresenterReferenceCheck {
  width: number;
  height: number;
  recommendation: string;
}

async function decodeReference(file: File): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    try { return { width: bitmap.width, height: bitmap.height }; }
    finally { bitmap.close(); }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error("เปิดภาพนี้ไม่ได้ กรุณาเลือกภาพใหม่"));
      image.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
}

/** Verifies the actual image bytes/dimensions, never claims face, motion, or speech quality. */
export async function inspectPresenterReference(file: File, decode = decodeReference): Promise<PresenterReferenceCheck> {
  if (!["image/jpeg", "image/png"].includes(file.type) || file.size === 0 || file.size > 4 * 1024 * 1024) {
    throw new Error("เลือกภาพ JPEG หรือ PNG ขนาดไม่เกิน 4 MB");
  }
  const { width, height } = await decode(file);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || width > 8192 || height > 8192 || width * height > 16_777_216) {
    throw new Error("ขนาดภาพนี้ยังไม่รองรับ กรุณาเลือกภาพใหม่");
  }
  return { width, height, recommendation: Math.min(width, height) < 512
    ? "ภาพค่อนข้างเล็ก แนะนำภาพที่ชัดและใหญ่กว่านี้"
    : "เลือกภาพใบหน้าชัด แสงสม่ำเสมอ และไม่มีสิ่งบังใบหน้า" };
}
