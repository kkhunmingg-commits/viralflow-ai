import { signOut } from "@/app/(app)/actions";

export function Topbar({
  displayName,
  email,
}: {
  displayName: string;
  email: string;
}) {
  const initial = (displayName || email || "V").slice(0, 1).toUpperCase();

  return (
    <header className="topbar">
      <div>
        <p className="topbar-kicker">VIRALFLOW AI</p>
        <p className="topbar-status">
          <span className="signal-dot" /> ศูนย์ควบคุมงานประจำวัน
        </p>
      </div>
      <div className="user-menu">
        <span className="avatar">{initial}</span>
        <div className="user-copy">
          <strong>{displayName}</strong>
          <small>{email}</small>
        </div>
        <form action={signOut}>
          <button className="text-button" type="submit">
            ออกจากระบบ
          </button>
        </form>
      </div>
    </header>
  );
}

