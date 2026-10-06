import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { getCustomerOverview } from "@/features/control-center/customer-data";
import { PostOverview } from "@/components/customer-control-center/post-overview";
import { customerPeriod } from "@/components/customer-control-center/presentation";
import { AutoRefresh } from "../auto/auto-refresh";
import "@/components/customer-control-center/customer-control-center.css";

export const metadata: Metadata = { title: "POST" };

export default async function PostPage({ searchParams }: { searchParams: Promise<{ period?: string | string[] }> }) {
  const { period } = await searchParams;
  const data = await getCustomerOverview(customerPeriod(period));
  const requestKeys = Object.fromEntries(data.accounts.map((account) => [account.id, randomUUID()]));
  return <><AutoRefresh /><PostOverview data={data} requestKeys={requestKeys} /></>;
}
