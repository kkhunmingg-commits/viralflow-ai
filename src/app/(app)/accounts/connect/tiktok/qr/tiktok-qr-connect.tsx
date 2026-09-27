"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

type QrState = "idle" | "loading" | "new" | "scanned" | "expired" | "error";

export function TikTokQrConnect() {
  const [image, setImage] = useState<string | null>(null);
  const [status, setStatus] = useState<QrState>("idle");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const generation = useRef(0);
  const starting = useRef(false);
  const automaticRefreshes = useRef(0);

  const start = useCallback(async (automatic = false) => {
    if (starting.current) return;
    if (!automatic) automaticRefreshes.current = 0;
    const currentGeneration = ++generation.current;
    starting.current = true;
    setImage(null);
    setExpiresAt(null);
    setStatus("loading");
    setErrorCode(null);
    try {
      const response = await fetch("/auth/tiktok/qr/session", { method: "POST", cache: "no-store" });
      const body: { image?: string; expiresAt?: number; error?: string } = await response.json();
      if (generation.current !== currentGeneration) return;
      if (!response.ok || !body.image?.startsWith("data:image/png;base64,") || !Number.isFinite(body.expiresAt) || body.expiresAt! <= Date.now()) {
        throw new Error(body.error ?? "qr_start_failed");
      }
      setImage(body.image);
      setExpiresAt(body.expiresAt!);
      setStatus("new");
    } catch (caught) {
      if (generation.current !== currentGeneration) return;
      setErrorCode(caught instanceof Error ? caught.message : "qr_start_failed");
      setStatus("error");
    } finally {
      starting.current = false;
    }
  }, []);

  const refreshExpired = useCallback(() => {
    if (starting.current) return;
    if (automaticRefreshes.current < 2) {
      automaticRefreshes.current += 1;
      void start(true);
    } else {
      setStatus("expired");
    }
  }, [start]);

  useEffect(() => {
    if (!expiresAt || (status !== "new" && status !== "scanned")) return;
    const currentGeneration = generation.current;
    const timer = window.setTimeout(() => {
      if (generation.current === currentGeneration) refreshExpired();
    }, Math.max(0, expiresAt - Date.now()));
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() >= expiresAt && generation.current === currentGeneration) refreshExpired();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [expiresAt, refreshExpired, status]);

  useEffect(() => {
    if (!image || (status !== "new" && status !== "scanned")) return;
    const currentGeneration = generation.current;
    let active = true;
    let polling = false;
    const timer = window.setInterval(async () => {
      if (polling || !active || generation.current !== currentGeneration) return;
      if (expiresAt && Date.now() >= expiresAt) { refreshExpired(); return; }
      polling = true;
      try {
        const response = await fetch("/auth/tiktok/qr/status", { method: "POST", cache: "no-store" });
        const body: { status?: string; accountPath?: string; error?: string } = await response.json();
        if (!active || generation.current !== currentGeneration) return;
        if (!response.ok) throw new Error(body.error ?? "qr_status_failed");
        if (body.status === "connected" && body.accountPath?.startsWith("/accounts/")) {
          window.location.assign(body.accountPath);
          return;
        }
        if (body.status === "expired") { refreshExpired(); return; }
        if (body.status === "scanned" || body.status === "new") setStatus(body.status);
      } catch (caught) {
        if (!active || generation.current !== currentGeneration) return;
        setErrorCode(caught instanceof Error ? caught.message : null);
        setStatus("error");
      } finally {
        polling = false;
      }
    }, 4000);
    return () => { active = false; window.clearInterval(timer); };
  }, [expiresAt, image, refreshExpired, status]);

  return <div className="large-empty" aria-live="polite">
    <button className="primary-action" type="button" onClick={() => void start()} disabled={status === "loading"}>
      {status === "loading" ? "กำลังเตรียม QR…" : image ? "สร้าง QR ใหม่" : "แสดง QR เพื่อเชื่อมบัญชี"}
    </button>
    {image && status !== "expired" && status !== "error" ? <Image src={image} width={320} height={320} alt="QR สำหรับอนุญาต TikTok ด้วยบัญชีที่เลือกบนโทรศัพท์" unoptimized /> : null}
    {status === "new" ? <p>ใช้เครื่องสแกนในแอป TikTok สแกน QR บนหน้านี้ หากมือถือแสดง QR โปรไฟล์ของคุณ ให้กดไอคอนสแกนบนหน้านั้นก่อน QR ที่หมดอายุจะสร้างใหม่ให้อัตโนมัติ</p> : null}
    {status === "scanned" ? <p>สแกนแล้ว — ยืนยันการอนุญาตในแอป TikTok</p> : null}
    {status === "expired" ? <p>QR หมดอายุแล้ว กรุณาสร้างใหม่</p> : null}
    {status === "error" ? <p role="alert">{errorCode === "tiktok_account_already_added"
      ? "บัญชีนี้อยู่ใน ViralFlow แล้ว กรุณาสแกนด้วย TikTok บัญชีอื่น"
      : `เชื่อมต่อไม่สำเร็จ (${errorCode ?? "qr_authorization_failed"}) กรุณาสร้าง QR ใหม่`}</p> : null}
  </div>;
}
