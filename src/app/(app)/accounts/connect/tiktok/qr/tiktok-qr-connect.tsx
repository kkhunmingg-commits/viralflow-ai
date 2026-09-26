"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

type QrState = "idle" | "loading" | "new" | "scanned" | "expired" | "error";

export function TikTokQrConnect() {
  const [image, setImage] = useState<string | null>(null);
  const [status, setStatus] = useState<QrState>("idle");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const polling = useRef(false);

  async function start() {
    setImage(null);
    setExpiresAt(null);
    setStatus("loading");
    setErrorCode(null);
    try {
      const response = await fetch("/auth/tiktok/qr/session", { method: "POST", cache: "no-store" });
      const body: { image?: string; expiresAt?: number } = await response.json();
      if (!response.ok || !body.image?.startsWith("data:image/png;base64,") || !Number.isFinite(body.expiresAt) || body.expiresAt! <= Date.now()) {
        throw new Error("qr_start_failed");
      }
      setImage(body.image);
      setExpiresAt(body.expiresAt!);
      setStatus("new");
    } catch {
      setStatus("error");
    }
  }

  useEffect(() => {
    if (!expiresAt || (status !== "new" && status !== "scanned")) return;
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => setStatus("expired"), remaining);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() >= expiresAt) setStatus("expired");
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [expiresAt, status]);

  useEffect(() => {
    if (!image || (status !== "new" && status !== "scanned")) return;
    const timer = window.setInterval(async () => {
      if (polling.current) return;
      if (expiresAt && Date.now() >= expiresAt) { setStatus("expired"); return; }
      polling.current = true;
      try {
        const response = await fetch("/auth/tiktok/qr/status", { method: "POST", cache: "no-store" });
        const body: { status?: string; accountPath?: string; error?: string } = await response.json();
        if (!response.ok) throw new Error(body.error ?? "qr_status_failed");
        if (body.status === "connected" && body.accountPath?.startsWith("/accounts/")) {
          window.location.assign(body.accountPath);
          return;
        }
        if (body.status === "expired") { setStatus("expired"); return; }
        if (body.status === "scanned" || body.status === "new") setStatus(body.status);
      } catch (caught) {
        setErrorCode(caught instanceof Error ? caught.message : null);
        setStatus("error");
      } finally {
        polling.current = false;
      }
    }, 4000);
    return () => window.clearInterval(timer);
  }, [expiresAt, image, status]);

  return <div className="large-empty" aria-live="polite">
    <button className="primary-action" type="button" onClick={start} disabled={status === "loading"}>
      {status === "loading" ? "กำลังเตรียม QR…" : image ? "สร้าง QR ใหม่" : "แสดง QR เพื่อเชื่อมบัญชี"}
    </button>
    {image && status !== "expired" && status !== "error" ? <Image src={image} width={320} height={320} alt="QR สำหรับอนุญาต TikTok ด้วยบัญชีที่เลือกบนโทรศัพท์" unoptimized /> : null}
    {status === "new" ? <p>เปิดแอป TikTok ที่เข้าสู่บัญชีใหม่ แล้วสแกน QR และอนุญาตสิทธิ์ หาก TikTok แจ้ง token_expire ให้กดสร้าง QR ใหม่แล้วสแกนทันที</p> : null}
    {status === "scanned" ? <p>สแกนแล้ว — ยืนยันการอนุญาตในแอป TikTok</p> : null}
    {status === "expired" ? <p>QR หมดอายุแล้ว กรุณาสร้างใหม่</p> : null}
    {status === "error" ? <p role="alert">{errorCode === "tiktok_account_already_added"
      ? "บัญชีนี้อยู่ใน ViralFlow แล้ว กรุณาสแกนด้วย TikTok บัญชีอื่น"
      : "เชื่อมต่อไม่สำเร็จ กรุณาลองสร้าง QR ใหม่"}</p> : null}
  </div>;
}
