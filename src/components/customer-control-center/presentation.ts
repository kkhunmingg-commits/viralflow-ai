import type { CustomerPeriod } from "@/features/control-center/customer-types";

export function customerPeriod(value: string | string[] | undefined): CustomerPeriod {
  return value === "7d" || value === "30d" ? value : "today";
}

export function metricText(value: number | null | undefined, style: "number" | "money" | "hours" = "number", currency: string | null = null) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (style === "money" && currency && /^[A-Z]{3}$/.test(currency)) {
    return new Intl.NumberFormat("th-TH", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  }
  if (style === "hours") return `${new Intl.NumberFormat("th-TH", { maximumFractionDigits: 1 }).format(value)} ชม.`;
  return new Intl.NumberFormat("th-TH", { maximumFractionDigits: style === "money" ? 2 : 0 }).format(value);
}

export function customerTime(value: string | null | undefined, includeDate = false) {
  if (!value) return "ยังไม่ได้กำหนด";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "ยังไม่ได้กำหนด";
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit",
    ...(includeDate ? { day: "numeric", month: "short" } as const : {}),
  }).format(date);
}

export function friendlyTone(label: string): "good" | "active" | "attention" | "neutral" {
  if (/ปัญหา|ไม่สำเร็จ|ตรวจ|ต้อง|รอ|ยังไม่พร้อม/.test(label)) return "attention";
  if (/กำลัง|ทำงาน|โพสต์อยู่/.test(label)) return "active";
  if (/สำเร็จ|เสร็จ|พร้อม|เผยแพร่แล้ว|โพสต์แล้ว/.test(label)) return "good";
  return "neutral";
}

export function categoryName(value: string) {
  const labels: Record<string, string> = {
    beauty: "ความงาม", home: "ของใช้ในบ้าน", gadget: "อุปกรณ์", gadgets: "อุปกรณ์",
    fashion: "แฟชั่น", food: "อาหาร", health: "สุขภาพ", pets: "สัตว์เลี้ยง",
  };
  return labels[value.toLowerCase()] ?? value.replace(/[_-]/g, " ");
}
