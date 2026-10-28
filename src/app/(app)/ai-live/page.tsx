import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOwnerAccounts } from "@/features/accounts/queries";
import { liveCandidates } from "@/features/ai-live/lineup-service";
import { liveBlockStart, selectLiveLineup } from "@/features/ai-live/live-director";
import { createClient } from "@/lib/supabase/server";
import { LivePlan } from "./live-plan";
import { LivePresenterConsole } from "./presenter-console";
import "./ai-live.css";

export const metadata: Metadata = { title: "AI LIVE" };

export default async function AiLivePage() {
  const client = await createClient();
  const { data } = await client.auth.getUser();
  if (!data.user) redirect("/login");

  const blockStart = liveBlockStart();
  const [accounts, productsResult, candidates] = await Promise.all([
    getOwnerAccounts(client, data.user.id),
    client.from("products").select("id,title").eq("owner_id", data.user.id).eq("status", "available").order("title").limit(100),
    liveCandidates(client, data.user.id, blockStart),
  ]);
  if (productsResult.error) throw productsResult.error;

  const connectedAccounts = accounts
    .filter((account) => !account.is_mock && account.authorization_status === "authorized")
    .map((account) => ({ id: account.id, label: account.username ? `@${account.username}` : account.display_name }));

  return <>
    <LivePlan lineup={selectLiveLineup(candidates, blockStart)} candidates={candidates} blockStart={blockStart} />
    <LivePresenterConsole accounts={connectedAccounts} products={productsResult.data ?? []} />
  </>;
}
