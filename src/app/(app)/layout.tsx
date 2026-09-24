import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", data.user.id)
    .maybeSingle();

  const fallbackName = data.user.email?.split("@")[0] ?? "Owner";
  const isGoogleUser = data.user.app_metadata.provider === "google";
  const metadata = data.user.user_metadata;
  const googleName = isGoogleUser && typeof metadata?.full_name === "string"
    ? metadata.full_name
    : isGoogleUser && typeof metadata?.name === "string" ? metadata.name : null;
  const displayName = profile?.display_name && profile.display_name !== fallbackName
    ? profile.display_name
    : googleName || profile?.display_name || fallbackName;
  let avatarUrl: string | null = null;
  if (isGoogleUser && typeof metadata?.avatar_url === "string") {
    try {
      const url = new URL(metadata.avatar_url);
      if (url.protocol === "https:" && (url.hostname === "googleusercontent.com" || url.hostname.endsWith(".googleusercontent.com"))) {
        avatarUrl = url.href;
      }
    } catch { /* Invalid metadata falls back to initials. */ }
  }

  return (
    <div className="app-frame">
      <Sidebar />
      <div className="app-main">
        <Topbar
          displayName={displayName}
          email={data.user.email ?? ""}
          avatarUrl={avatarUrl}
        />
        <main className="page-content">{children}</main>
      </div>
    </div>
  );
}

