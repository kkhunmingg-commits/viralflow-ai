import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { SOCIAL_PLATFORMS, type SocialPlatform } from "@/features/social-publish/config";
import { nextBrowserPost, reportBrowserPost } from "@/features/product-links/service";

/**
 * The ViralFlow Chrome extension asks here for the next clip to post from the user's own Chrome (GET), and says how it
 * went (POST). The user's ViralFlow sign-in comes with the request (the extension has this site's host permission).
 * Only ViralFlow's own pages or a Chrome extension may call it: a web page elsewhere can neither send its Origin as one
 * nor read the answer, and the extension's own header cannot be sent from another site without a CORS preflight,
 * which this route never approves.
 */
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };
const allowedOrigin = (request: NextRequest) => {
  if (request.headers.get("x-viralflow-extension") !== "1") return false;
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin || /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
};
async function signedIn() {
  const { data, error } = await (await createClient()).auth.getUser();
  return error || !data.user ? null : data.user.id;
}

export async function GET(request: NextRequest) {
  if (!allowedOrigin(request)) return NextResponse.json({ ok: false }, { status: 403, headers: noStore });
  const owner = await signedIn();
  if (!owner) return NextResponse.json({ ok: false, signedIn: false }, { status: 401, headers: noStore });
  try {
    const task = await nextBrowserPost(createAdminClient(), owner);
    return NextResponse.json({ ok: true, signedIn: true, task }, { headers: noStore });
  } catch (error) {
    console.error("[social-post/browser] next failed", error);
    return NextResponse.json({ ok: false, signedIn: true, task: null }, { status: 500, headers: noStore });
  }
}

const reportSchema = z.object({
  jobId: z.uuid(),
  platform: z.enum(SOCIAL_PLATFORMS as [SocialPlatform, ...SocialPlatform[]]),
  ok: z.boolean(),
  url: z.string().max(500).nullish(),
  error: z.string().max(300).regex(/^[A-Z_]+(:[\s\S]*)?$/).nullish(),
});
export async function POST(request: NextRequest) {
  if (!allowedOrigin(request)) return NextResponse.json({ ok: false }, { status: 403, headers: noStore });
  const owner = await signedIn();
  if (!owner) return NextResponse.json({ ok: false }, { status: 401, headers: noStore });
  const parsed = reportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400, headers: noStore });
  try {
    const saved = await reportBrowserPost(createAdminClient(), owner, parsed.data.jobId, parsed.data);
    return NextResponse.json({ ok: saved }, { headers: noStore });
  } catch (error) {
    console.error("[social-post/browser] report failed", error);
    return NextResponse.json({ ok: false }, { status: 500, headers: noStore });
  }
}
