import { signOut } from "@/app/(app)/actions";
import Image from "next/image";
import Link from "next/link";
import { InstallAppButton } from "@/components/pwa/install-app-button";
import { BrandIcon } from "@/components/brand-icon";

export function Topbar({
  displayName,
  email,
  avatarUrl,
}: {
  displayName: string;
  email: string;
  avatarUrl?: string | null;
}) {
  const initial = (displayName || email || "V").slice(0, 1).toUpperCase();

  return (
    <header className="topbar">
      <Link href="/auto" className="topbar-brand" aria-label="ViralFlow หน้าหลัก"><BrandIcon className="brand-mark" size={36} /><span>ViralFlow</span></Link>
      <div className="topbar-title">
        <p className="topbar-kicker">VIRALFLOW AI</p>
        <p className="topbar-status">
          <span className="signal-dot" /> พื้นที่ทำงานของคุณ
        </p>
      </div>
      <div className="user-menu">
        <InstallAppButton label="ติดตั้งแอป" />
        <Link href="/profile" className="avatar-link" aria-label="โปรไฟล์">
          {avatarUrl ? <Image className="avatar" src={avatarUrl} alt="" width={34} height={34} unoptimized referrerPolicy="no-referrer" /> : <span className="avatar">{initial}</span>}
        </Link>
        <Link href="/profile" className="user-copy">
          <strong>{displayName}</strong>
          <small>{email}</small>
        </Link>
        <form action={signOut}>
          <button className="text-button" type="submit">
            ออกจากระบบ
          </button>
        </form>
      </div>
    </header>
  );
}

