"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const FAST_MS = 4000, SLOW_MS = 15000;

/**
 * Keeps every signed-in page current without a manual reload: polls a tiny fingerprint of the owner's data while the
 * tab is visible and re-renders the server parts the moment it changes (a clip finished, was posted or deleted, a
 * Google account signed in). Also re-renders when the tab or app comes back to the foreground or the network returns.
 */
export function LiveRefresh() {
  const router = useRouter();
  const version = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false, timer: ReturnType<typeof setTimeout> | undefined, failures = 0, inFlight = false;
    const schedule = (ms: number) => { clearTimeout(timer); if (!cancelled) timer = setTimeout(check, ms); };
    async function check() {
      if (cancelled) return;
      if (document.visibilityState !== "visible" || inFlight) return schedule(FAST_MS);
      inFlight = true;
      try {
        const response = await fetch("/api/live/version", { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const { version: next } = await response.json() as { version?: string };
        failures = 0;
        if (next && version.current !== null && next !== version.current) router.refresh();
        if (next) version.current = next;
      } catch { failures++; }
      finally { inFlight = false; }
      // Back off while the server is unreachable; resume the fast pace once it answers again.
      schedule(failures ? Math.min(SLOW_MS * failures, 60000) : FAST_MS);
    }
    const resume = (event?: Event) => {
      if (document.visibilityState !== "visible") return;
      // pageshow also fires on the first load; only a page restored from the back/forward cache is stale.
      if (event instanceof PageTransitionEvent && !event.persisted) return;
      router.refresh();
      schedule(0);
    };
    schedule(0);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    window.addEventListener("pageshow", resume);
    return () => {
      cancelled = true; clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("pageshow", resume);
    };
  }, [router]);

  return null;
}
