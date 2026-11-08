import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { flowPool, type PoolAccount, type PoolSummary } from "@/features/flow-farm/pool";

export type PoolMode = "PROMO" | "PRODUCT" | "DRAMA";
const MODE_NAME: Record<PoolMode, string> = { PROMO: "คลิปโปรโมท", PRODUCT: "คลิปสินค้าจากลิงก์", DRAMA: "ละครซีรีส์" };

/** One account's state today in words, for the mode the page is about. */
export function poolAccountStatus(a: PoolAccount, mode: PoolMode) {
  if (!a.active) return { text: "พักไว้ ไม่ใช้ทุกโหมด", tone: "off" as const };
  if (a.loginState === "PENDING") return { text: "⏳ รอล็อกอิน (เปิดคอมที่ติดตั้งเครื่องสร้างคลิปไว้)", tone: "off" as const };
  if (a.loginState === "FAILED") return { text: `⚠ ล็อกอินไม่สำเร็จ${a.loginNote ? ` (${a.loginNote})` : ""} กด “ล็อกอินใหม่” ในแท็บคลิปโปรโมท`, tone: "off" as const };
  if (a.exhaustedToday || a.leftToday === 0) return { text: `เครดิตวันนี้หมดแล้ว (ใช้ ${Math.min(a.usedToday, a.perDay)}/${a.perDay}) พรุ่งนี้ใช้ต่อได้`, tone: "off" as const };
  const left = `เหลือ ${a.leftToday}/${a.perDay} คลิปวันนี้`;
  const kept = a.dramaReserved > 0 ? ` · กันไว้ให้ละคร ${Math.min(a.dramaReserved, a.leftToday)} ช็อต` : "";
  if (a.openForClips) return { text: `✓ ใช้ได้ทั้ง 3 โหมด · ${left}${kept}`, tone: "ok" as const };
  if (mode === "DRAMA") return { text: `✓ ${left} · ตอนนี้กันไว้ให้ละครก่อน`, tone: "ok" as const };
  return { text: `${left} · ตอนนี้กันไว้ให้ละครก่อน คลิปนี้จะใช้บัญชีอื่น`, tone: "hold" as const };
}

function headline(pool: PoolSummary, mode: PoolMode) {
  if (!pool.accounts.length) return "ยังไม่มีบัญชี Google";
  if (!pool.usable) return "วันนี้ไม่มีบัญชีที่ใช้ได้ (ยังไม่ล็อกอิน หรือเครดิตหมดทุกบัญชี)";
  const drama = pool.keptForDrama > 0 ? ` · กันไว้ให้ละคร ${pool.keptForDrama} คลิป` : "";
  if (mode === "DRAMA") return `ใช้ได้ ${pool.usable} บัญชี · เหลือรวม ${pool.leftToday} คลิปวันนี้${drama}`;
  return `ใช้ได้ ${pool.usable} บัญชี · ${MODE_NAME[mode]}ใช้ได้อีกประมาณ ${pool.openClips} คลิปวันนี้${drama}`;
}

/**
 * Lucky, 8 Nov: every signed-in Google account works for all three clip modes. Each mode's page shows the same list:
 * which accounts can be used, how many clips each has left today, and what is kept back for drama episodes.
 */
export async function AccountPoolPanel({ owner, mode, channelNames = {}, pool: given }: { owner: string; mode: PoolMode; channelNames?: Record<string, string>; pool?: PoolSummary }) {
  const pool = given ?? await flowPool(createAdminClient(), owner).catch(() => null);
  if (!pool) return <p className="manual-warning">อ่านสถานะบัญชี Google ไม่ได้ ลองรีเฟรชหน้านี้</p>;
  const where = (a: PoolAccount) => a.purpose === "REPAIR" ? "บัญชีซ่อม" : a.tiktokAccountId ? `ผูกกับ ${channelNames[a.tiktokAccountId] ?? "ช่อง TikTok"}` : "บัญชีกลาง";
  return <div className="account-pool" aria-label="บัญชี Google ที่ใช้ได้">
    <p className="account-pool-head"><strong>บัญชี Google กองกลาง ({pool.accounts.length})</strong> · {headline(pool, mode)}</p>
    {pool.accounts.length === 0 ? <p className="manual-muted">ผูกบัญชี Google ที่ <Link href="/post">แท็บสร้างคลิปโปรโมท</Link> แล้วใช้ได้ทุกโหมด</p>
      : <ol className="library-flow-list account-pool-list">{pool.accounts.map(a => {
        const status = poolAccountStatus(a, mode);
        return <li key={a.id} className={status.tone === "off" ? "paused" : undefined}>
          <div><strong>{a.label}</strong><small>{where(a)} · {status.text}</small></div>
          <span className={`account-pool-left ${status.tone}`} aria-hidden="true">{a.leftToday}/{a.perDay}</span>
        </li>;
      })}</ol>}
    <p className="manual-muted">ทุกบัญชีที่ล็อกอินแล้วใช้ร่วมกันทั้ง 3 โหมด (คลิปโปรโมท · คลิปสินค้าจากลิงก์ · ละคร) ระบบใช้บัญชีของช่องนั้นก่อน
      ตอนละครที่ถึงคิววันนี้ได้บัญชีที่ยังเหลือพอทำครบทั้งตอนเก็บไว้ก่อน ส่วนที่เหลือใช้ทำคลิปโปรโมทและคลิปสินค้า จะได้ไม่แย่งเครดิตกัน</p>
  </div>;
}
