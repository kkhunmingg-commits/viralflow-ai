"use client";

import { useCallback, useEffect, useState } from "react";
import { OverlayStage } from "@/features/live-overlay/stage";
import type { OverlayConfig, OverlayProduct } from "@/features/live-overlay/model";
import "./overlay.css";

type Data = { config: OverlayConfig; updatedAt: string; products: OverlayProduct[] };
const POLL_MS = 5000;

export function LiveOverlayClient({ token }: { token: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [bad, setBad] = useState(false);
  // Only reached after a fetch, so the server render (nothing yet) never differs.
  const [inObs] = useState(() => typeof window === "undefined" || "obsstudio" in window);
  useEffect(() => {
    let stop = false, timer: ReturnType<typeof setTimeout> | undefined, last = "";
    const load = async () => {
      try {
        const r = await fetch(`/live-overlay/data?k=${encodeURIComponent(token)}`, { cache: "no-store" });
        if (r.status === 404) setBad(true);
        else if (r.ok) {
          const next = await r.json() as Data;
          // Same layout and products: keep the current objects so pop-ups and the ticker do not restart.
          const key = next.updatedAt + JSON.stringify(next.products);
          if (key !== last) { last = key; setData(next); }
          setBad(false);
        }
      } catch { /* keep showing the last layout while the internet is down */ }
      if (!stop) timer = setTimeout(load, POLL_MS);
    };
    void load();
    return () => { stop = true; clearTimeout(timer); };
  }, [token]);
  const imageSrc = useCallback((ref: string) => ref.startsWith("https://") ? ref : `/live-overlay/img?k=${encodeURIComponent(token)}&ref=${encodeURIComponent(ref)}`, [token]);

  // A wrong link shows nothing on the live (an error box would go out to viewers); it says so only in a normal browser.
  if (bad) return <main className="lo-page">{inObs ? null : <p className="lo-page-bad">ลิงก์โอเวอร์เลย์ไม่ถูกต้อง คัดลอกลิงก์ใหม่จากหน้า AI LIVE</p>}</main>;
  return <main className="lo-page">{data ? <OverlayStage mode="live" config={data.config} products={data.products} imageSrc={imageSrc} /> : null}</main>;
}
