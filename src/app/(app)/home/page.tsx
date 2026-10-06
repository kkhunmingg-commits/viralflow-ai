import type { Metadata } from "next";
import { getCustomerOverview } from "@/features/control-center/customer-data";
import { HomeOverview } from "@/components/customer-control-center/home-overview";
import { ShareSummaryButton } from "@/components/customer-control-center/share-summary";
import { customerPeriod } from "@/components/customer-control-center/presentation";
import { AutoRefresh } from "../auto/auto-refresh";
import "@/components/customer-control-center/customer-control-center.css";

export const metadata: Metadata = { title: "Home" };

export default async function HomePage({ searchParams }: { searchParams: Promise<{ period?: string | string[] }> }) {
  const { period } = await searchParams;
  const data = await getCustomerOverview(customerPeriod(period));
  return <><AutoRefresh /><HomeOverview data={data} shareAction={<ShareSummaryButton overview={data} />} /></>;
}
