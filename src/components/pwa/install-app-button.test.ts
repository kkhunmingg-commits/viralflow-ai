import { describe, expect, it } from "vitest";
import { detectPlatform } from "./install-app-button";

const iphoneSafari = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

describe("detectPlatform", () => {
  it("hides the button once opened from the home screen", () => expect(detectPlatform(iphoneSafari, true)).toBe("standalone"));
  it("gives iPhone Safari the Share → Add to Home Screen steps", () => expect(detectPlatform(iphoneSafari, false)).toBe("ios-safari"));
  it("tells in-app browsers on iPhone to open Safari first", () => {
    expect(detectPlatform(iphoneSafari + " Line/14.0.0", false)).toBe("ios-other");
    expect(detectPlatform(iphoneSafari.replace("Version/18.0", "CriOS/130.0"), false)).toBe("ios-other");
  });
  it("treats an iPad in desktop mode as iOS", () =>
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", false)).toBe("ios-safari"));
  it("recognises Android and desktop", () => {
    expect(detectPlatform("Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36", false)).toBe("android");
    expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36", false)).toBe("desktop");
  });
});
