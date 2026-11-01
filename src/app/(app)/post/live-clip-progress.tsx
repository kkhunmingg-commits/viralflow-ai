"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { flowClipStatusLabels, flowErrorLabel, flowProgressLabels, type FlowClipStatus } from "@/features/flow-farm/contracts";
import type { LiveClipProgress } from "@/features/flow-farm/service";

const ACTIVE: FlowClipStatus[] = ["QUEUED", "GENERATING"];
const ORDER: FlowClipStatus[] = ["QUEUED", "GENERATING", "READY", "SCHEDULED", "POSTED", "FAILED", "SKIPPED_NO_CREDIT"];
const ago = (ms: number) => ms < 60_000 ? `${Math.max(0, Math.round(ms / 1000))} วิ` : `${Math.floor(ms / 60_000)} นาที ${Math.round((ms % 60_000) / 1000)} วิ`;

/** Today's clips with each one's live step; polls every few seconds while anything is still being made. */
export function LiveClipProgressPanel({ accountId, initial }: { accountId: string; initial: LiveClipProgress }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [offsetMs, setOffsetMs] = useState(0);
  const [tick, setTick] = useState(() => Date.now());
  const [stale, setStale] = useState(false);
  const finished = useRef(new Set(initial.clips.filter(c => !ACTIVE.includes(c.status)).map(c => c.id)));

  const busy = data.clips.some(c => ACTIVE.includes(c.status));
  useEffect(() => {
    let cancelled = false, timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      if (document.visibilityState === "visible") {
        try {
          const response = await fetch(`/api/flow-farm/progress?account=${accountId}`, { cache: "no-store" });
          if (!response.ok) throw new Error(String(response.status));
          const next = await response.json() as LiveClipProgress;
          if (cancelled) return;
          setData(next); setStale(false); setOffsetMs(Date.parse(next.now) - Date.now());
          // A clip just reached the library: re-render the server parts (library grid, counts, capacity).
          const done = next.clips.filter(c => !ACTIVE.includes(c.status) && !finished.current.has(c.id));
          if (done.length) { done.forEach(c => finished.current.add(c.id)); router.refresh(); }
        } catch { if (!cancelled) setStale(true); }
      }
      if (!cancelled) timer = setTimeout(poll, busy ? 4000 : 20000);
    }
    timer = setTimeout(poll, busy ? 4000 : 20000);
    const onVisible = () => { if (document.visibilityState === "visible") { clearTimeout(timer); void poll(); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [accountId, busy, router]);
  useEffect(() => { const id = setInterval(() => setTick(Date.now()), 1000); return () => clearInterval(id); }, []);

  const now = tick + offsetMs;
  const online = data.lastSeen !== null && now - Date.parse(data.lastSeen) < 3 * 60_000;
  const counts = data.clips.reduce((map, c) => map.set(c.status, (map.get(c.status) ?? 0) + 1), new Map<FlowClipStatus, number>());
  const total = data.clips.length, doneCount = data.clips.filter(c => !ACTIVE.includes(c.status)).length;
  const progress = data.progress;
  const queuedWaiting = data.clips.filter(c => c.status === "QUEUED").length;
  if (!total) return null;

  return <div className="live-progress" aria-live="polite">
    <div className="live-progress-head">
      <strong>{busy ? `กำลังทำ ${doneCount}/${total} คลิป` : `เสร็จครบ ${doneCount}/${total} คลิป`}</strong>
      <span className={stale ? "live-dot stale" : busy ? "live-dot on" : "live-dot"}>{stale ? "เชื่อมต่อไม่ได้ กำลังลองใหม่" : busy ? "อัปเดตอัตโนมัติทุก 4 วินาที" : "อัปเดตอัตโนมัติ"}</span>
    </div>
    <div className="live-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={doneCount}><span style={{ width: `${Math.round(doneCount / total * 100)}%` }} /></div>
    <ul className="library-counts">{ORDER.filter(s => counts.get(s)).map(s => <li key={s} className={`library-chip library-${s.toLowerCase()}`}>{flowClipStatusLabels[s]} <strong>{counts.get(s)}</strong></li>)}</ul>
    {busy && !online && <p className="manual-warning">มีคลิปรอสร้าง {queuedWaiting} คลิป แต่เครื่องสร้างคลิปไม่ได้ติดต่อมา{data.lastSeen ? ` ${ago(now - Date.parse(data.lastSeen))}` : ""} เปิดคอมเครื่องที่ติดตั้งไว้ให้ออนไลน์</p>}
    <ol className="live-list">{data.clips.map(clip => {
      const live = clip.status === "GENERATING" && progress?.clipId === clip.id ? progress : null;
      const since = live ? now - Date.parse(live.at) : 0;
      const step = live ? `${flowProgressLabels[live.stage]}${live.detail ? ` · ${live.detail}` : ""}` : null;
      return <li key={clip.id} className={`live-item live-${clip.status.toLowerCase()}`}>
        <span className="live-icon" aria-hidden="true">{clip.status === "GENERATING" ? "⏳" : clip.status === "QUEUED" ? "•" : ["FAILED", "SKIPPED_NO_CREDIT"].includes(clip.status) ? "✕" : "✓"}</span>
        <div><span className="live-title">{clip.title}</span>
          <small>{flowClipStatusLabels[clip.status]}
            {clip.status === "GENERATING" && (step ? ` · ${step} (${ago(since)} ที่แล้ว)` : ` · เริ่ม ${ago(now - Date.parse(clip.updated_at))} ที่แล้ว`)}
            {["FAILED", "SKIPPED_NO_CREDIT"].includes(clip.status) && clip.error ? ` · ${flowErrorLabel(clip.error)}` : ""}</small></div>
      </li>;
    })}</ol>
  </div>;
}
