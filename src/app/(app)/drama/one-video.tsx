"use client";
import { useEffect } from "react";

/** Comparing takes puts several videos on one page; playing two at once makes a phone stutter, so starting one pauses the rest. */
export function OneVideoAtATime() {
  useEffect(() => {
    const onPlay = (event: Event) => {
      document.querySelectorAll("video").forEach(video => { if (video !== event.target && !video.paused) video.pause(); });
    };
    document.addEventListener("play", onPlay, true);
    return () => document.removeEventListener("play", onPlay, true);
  }, []);
  return null;
}
