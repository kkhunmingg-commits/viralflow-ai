import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { getCustomerPostAccount } from "@/features/control-center/customer-data";
import { PostAccountDetail } from "@/components/customer-control-center/post-account-detail";
import { customerPeriod } from "@/components/customer-control-center/presentation";
import { AutoRefresh } from "../../auto/auto-refresh";
import "@/components/customer-control-center/customer-control-center.css";

export const metadata: Metadata = { title: "คลิปของบัญชี" };

export default async function PostAccountPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ period?: string | string[] }>;
}) {
  const [{ id }, { period }] = await Promise.all([params, searchParams]);
  const data = await getCustomerPostAccount(id, customerPeriod(period));
  if (!data) notFound();
  return <><AutoRefresh /><PostAccountDetail data={data} requestKey={randomUUID()} /></>;
}
