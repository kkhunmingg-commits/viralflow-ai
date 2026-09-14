import Link from "next/link";

export default function SettingsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="settings-layout">
      <aside className="settings-menu">
        <p className="eyebrow">SETTINGS</p>
        <Link href="/settings">Workspace</Link>
        <Link href="/settings/integrations">Integrations</Link>
      </aside>
      <div>{children}</div>
    </div>
  );
}

