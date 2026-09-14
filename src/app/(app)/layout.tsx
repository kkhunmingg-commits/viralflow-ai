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

  return (
    <div className="app-frame">
      <Sidebar />
      <div className="app-main">
        <Topbar
          displayName={profile?.display_name || fallbackName}
          email={data.user.email ?? ""}
        />
        <main className="page-content">{children}</main>
      </div>
    </div>
  );
}

