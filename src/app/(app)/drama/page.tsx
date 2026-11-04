import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";

/** Drama mode now lives inside the clip studio; old links and bookmarks land there. */
export default async function DramaPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  redirect(`/post?studio=drama${msg ? `&msg=${encodeURIComponent(msg.slice(0, 300))}` : ""}`);
}
