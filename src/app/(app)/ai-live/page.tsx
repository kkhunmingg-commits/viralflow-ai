import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOwnerAccounts } from "@/features/accounts/queries";
import { createClient } from "@/lib/supabase/server";
import { LivePresenterConsole } from "./presenter-console";
import { DevPresenterConsole } from "./dev-presenter-console";
import { liveDevFallbackEnabled } from "@/features/ai-live/dev-config";
import "./ai-live.css";

export const metadata: Metadata = { title: "AI LIVE" };

export default async function AiLivePage() {
  const client = await createClient();
  const { data } = await client.auth.getUser();
  if (!data.user) redirect("/login");

  const [accounts, productsResult] = await Promise.all([
    getOwnerAccounts(client, data.user.id),
    client.from("products").select("id,title").eq("owner_id", data.user.id).eq("status", "available").order("title").limit(100),
  ]);
  if (productsResult.error) throw productsResult.error;

  const connectedAccounts = accounts
    .filter((account) => !account.is_mock && account.authorization_status === "authorized")
    .map((account) => ({ id: account.id, label: account.username ? `@${account.username}` : account.display_name }));

  return <><LivePresenterConsole accounts={connectedAccounts} products={productsResult.data ?? []} />
    {liveDevFallbackEnabled() && <DevPresenterConsole accounts={connectedAccounts} products={productsResult.data ?? []} />}
  </>;
}
