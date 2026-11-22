import { createTikTokProvider, TikTokTokenService } from "@/features/tiktok/services";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Serves a connected TikTok account's profile picture through ViralFlow.
 * TikTok hands out signed CDN avatar links that stop working after a few days, so the stored link
 * goes stale and the browser shows a broken image. When that happens this route asks TikTok for a
 * fresh link with the account's own token, saves it, and serves the picture. The page falls back to
 * the account's initial if no picture can be served.
 */
const maxBytes = 2 * 1024 * 1024;

function isTikTokImageHost(raw: string | null | undefined): raw is string {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && /(^|\.)(tiktokcdn(-[a-z]+)?\.com|tiktokcdn\.[a-z.]+|ibytedtos\.com|byteimg\.com|tiktokv\.com|muscdn\.com)$/i.test(url.hostname);
  } catch { return false; }
}

async function fetchImage(url: string) {
  try {
    const response = await fetch(url, { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(8000) });
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !type.startsWith("image/")) return null;
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) return null;
    return { bytes, type };
  } catch { return null; }
}

function notFound() {
  return new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return notFound();
  const client = await createClient();
  const { data: userData } = await client.auth.getUser();
  const ownerId = userData.user?.id;
  if (!ownerId) return new Response(null, { status: 401 });

  const admin = createAdminClient();
  const { data: account } = await admin.from("tiktok_accounts")
    .select("id,avatar_url,is_mock,authorization_status")
    .eq("owner_id", ownerId).eq("id", id).maybeSingle();
  if (!account || account.is_mock) return notFound();

  let image = isTikTokImageHost(account.avatar_url) ? await fetchImage(account.avatar_url) : null;
  if (!image && account.authorization_status === "authorized") {
    try {
      const token = await new TikTokTokenService(admin).getAccessToken(ownerId, id);
      const user = await createTikTokProvider().getBasicUserInfo(token);
      if (isTikTokImageHost(user.avatarUrl)) {
        image = await fetchImage(user.avatarUrl);
        if (image && user.avatarUrl !== account.avatar_url) {
          await admin.from("tiktok_accounts").update({ avatar_url: user.avatarUrl }).eq("owner_id", ownerId).eq("id", id);
        }
      }
    } catch { image = null; }
  }
  if (!image) return notFound();
  return new Response(image.bytes, {
    headers: {
      "Content-Type": image.type,
      "Cache-Control": "private, max-age=21600, stale-while-revalidate=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
