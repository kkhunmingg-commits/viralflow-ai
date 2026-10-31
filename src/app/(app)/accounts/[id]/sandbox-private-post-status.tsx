"use client";

import { useEffect, useState } from "react";

type StatusResult = {
  publish_id?: string;
  status?: string;
  fail_reason?: string | null;
  publicaly_available_post_id?: string[];
  uploaded_bytes?: number;
  error?: { code?: string; message?: string; log_id?: string | null };
  error_code?: string;
};

const maxPolls = 10;

export function SandboxPrivatePostStatus({ publishId }: { publishId: string }) {
  const [result, setResult] = useState<StatusResult | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [stopped, setStopped] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    let count = 0;

    async function poll() {
      count += 1;
      try {
        const response = await fetch(`/api/tiktok/sandbox-private-post?publish_id=${encodeURIComponent(publishId)}`, {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        const data = await response.json() as StatusResult;
        if (cancelled) return;
        setResult(data);
        setAttempts(count);
        if (!response.ok) {
          setProblem(data.error?.code ?? data.error_code ?? `status_http_${response.status}`);
          setStopped(true);
          return;
        }
        if (data.status === "PUBLISH_COMPLETE" || data.status === "FAILED") {
          setStopped(true);
          return;
        }
        if (count >= maxPolls) {
          setProblem("status_poll_timeout");
          setStopped(true);
          return;
        }
        timer = setTimeout(poll, Math.min(3_000 * 2 ** (count - 1), 15_000));
      } catch {
        if (!cancelled) {
          setProblem("status_poll_unavailable");
          setStopped(true);
        }
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      controller.abort();
    };
  }, [publishId, cycle]);

  return <div className="panel" aria-live="polite">
    <h3>สถานะ Direct Post</h3>
    <dl className="detail-list">
      <div><dt>publish_id</dt><dd>{publishId}</dd></div>
      <div><dt>status</dt><dd>{result?.status ?? "กำลังตรวจ"}</dd></div>
      <div><dt>fail_reason</dt><dd>{result?.fail_reason ?? "—"}</dd></div>
      <div><dt>post_id</dt><dd>{result?.publicaly_available_post_id?.join(", ") || "—"}</dd></div>
      <div><dt>uploaded_bytes</dt><dd>{result?.uploaded_bytes ?? "—"}</dd></div>
      <div><dt>error.code</dt><dd>{result?.error?.code ?? result?.error_code ?? "—"}</dd></div>
      <div><dt>error.message</dt><dd>{result?.error?.message || "—"}</dd></div>
      <div><dt>error.log_id</dt><dd>{result?.error?.log_id ?? "—"}</dd></div>
    </dl>
    <p>{stopped ? problem ? `${problem} · ตรวจแล้ว ${attempts} ครั้ง` : "ตรวจสถานะสุดท้ายแล้ว" : `กำลังตรวจครั้งที่ ${attempts + 1} จาก ${maxPolls}`}</p>
    {stopped && problem ? <button className="secondary-action" type="button" onClick={() => {
      setProblem(null);
      setStopped(false);
      setAttempts(0);
      setCycle(value => value + 1);
    }}>ตรวจสถานะต่อด้วย publish_id เดิม</button> : null}
  </div>;
}
