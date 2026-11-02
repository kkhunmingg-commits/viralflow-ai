import type { MetadataRoute } from "next";

/** Lets phones install ViralFlow as a home-screen app (no APK). Opens straight on the clip library. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "ViralFlow AI",
    short_name: "ViralFlow",
    description: "สร้างคลิปในคอม โพสต์จากมือถือ: คัดลอกคำบรรยาย บันทึกและแชร์คลิปไป TikTok",
    lang: "th",
    start_url: "/post",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0d1018",
    theme_color: "#0d1018",
    icons: [
      { src: "/icons/vf-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/vf-icon-1024.png", sizes: "1024x1024", type: "image/png", purpose: "any" },
      { src: "/icons/vf-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/vf-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "คลังคลิป", short_name: "คลิป", url: "/post#library", icons: [{ src: "/icons/vf-icon-192.png", sizes: "192x192" }] },
      { name: "บัญชี TikTok", short_name: "บัญชี", url: "/accounts", icons: [{ src: "/icons/vf-icon-192.png", sizes: "192x192" }] },
    ],
  };
}
