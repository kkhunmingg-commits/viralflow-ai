import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOwnerAccounts } from "@/features/accounts/queries";
import { createClient } from "@/lib/supabase/server";
import { AiLiveControlRoom } from "./control-room";
import { DevPresenterConsole } from "./dev-presenter-console";
import { liveDevFallbackEnabled } from "@/features/ai-live/dev-config";
import "./ai-live.css";

export const metadata: Metadata = { title: "AI LIVE" };

export default async function AiLivePage() {
  const client = await createClient();
  const { data } = await client.auth.getUser();
  if (!data.user) redirect("/login");

  const [accounts, productsResult, categoriesResult] = await Promise.all([
    getOwnerAccounts(client, data.user.id),
    client.from("products").select("id,title,category_key").eq("owner_id", data.user.id).eq("status", "available").order("title").limit(100),
    client.from("categories").select("category_key,display_name").eq("owner_id", data.user.id).eq("status", "active").limit(100),
  ]);
  if (productsResult.error) throw productsResult.error;
  if (categoriesResult.error) throw categoriesResult.error;

  const customerAccounts = accounts.filter((account) => !account.is_mock).map((account) => ({
    id: account.id, label: account.username ? `@${account.username}` : account.display_name,
    avatarUrl: account.avatar_url ?? null, connected: account.authorization_status === "authorized",
  }));
  const categoryNames = new Map((categoriesResult.data ?? []).map((category) => [category.category_key, category.display_name]));
  const customerProducts = (productsResult.data ?? []).map((product) => ({
    id: product.id, title: product.title, category: categoryNames.get(product.category_key) ?? null,
  }));

  return <><AiLiveControlRoom accounts={customerAccounts} products={customerProducts} />
    {liveDevFallbackEnabled() && <DevPresenterConsole accounts={customerAccounts.filter((account) => account.connected)} products={customerProducts} />}
  </>;
}
