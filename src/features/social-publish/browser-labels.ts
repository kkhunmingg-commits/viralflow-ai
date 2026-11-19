/** Thai text for what the ViralFlow extension reports from the user's Chrome (codes come from extension.mjs). */
const LABELS: Array<[RegExp, string]> = [
  [/BROWSER_NOT_OPEN/, "ไม่มี Chrome ที่ติดตั้งส่วนขยาย ViralFlow เปิดอยู่ภายใน 1 วัน เปิด Chrome แล้วกด “ทำใหม่” หรือโพสต์เอง"],
  [/BROWSER_UNKNOWN/, "Chrome หยุดกลางทาง ไม่ทราบว่าโพสต์ขึ้นหรือยัง ตรวจในแอปก่อนโพสต์ซ้ำ"],
  [/BROWSER_LOGIN/, "ยังไม่ได้ล็อกอินแพลตฟอร์มนี้ใน Chrome ที่ติดตั้งส่วนขยาย ล็อกอินแล้วโพสต์ใหม่"],
  [/BROWSER_STOPPED/, "คุณกด STOP ระหว่างโพสต์"],
  [/BROWSER_NO_VIDEO/, "ส่วนขยายโหลดไฟล์คลิปไม่ได้ ลองใหม่"],
  [/BROWSER_UI/, "หน้าเว็บของแพลตฟอร์มเปลี่ยนไป ส่วนขยายหาปุ่มไม่เจอ ลองโพสต์เองหรืออัปเดตส่วนขยาย"],
  [/BROWSER_TIMEOUT/, "แพลตฟอร์มใช้เวลานานเกินไป ตรวจในแอปว่าโพสต์ขึ้นหรือยัง"],
];
export function browserErrorLabel(error: string) {
  const found = LABELS.find(([re]) => re.test(error));
  const detail = error.replace(/^BROWSER_[A-Z_]+:?\s*/, "").trim();
  return found ? `${found[1]}${detail && !/^BROWSER_(NOT_OPEN|UNKNOWN|STOPPED)/.test(error) ? ` (${detail.slice(0, 120)})` : ""}` : error;
}
