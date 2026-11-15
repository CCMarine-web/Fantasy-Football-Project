"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** How often an open page asks for fresh server data during a live week. */
export const LIVE_REFRESH_MS = 5 * 60 * 1000;

/**
 * Keeps an already-open page current while games are being played.
 *
 * Only mounted when the league clock says the week is in progress. Every five
 * minutes, and when the tab comes back into view, it re-requests the page's
 * server data (router.refresh) — the same cached page any new visitor gets, so
 * it costs no extra Sleeper calls and never regenerates any written text. The
 * scores themselves are cached for ten minutes and carry their own "as of"
 * time, which is what the reader should trust.
 */
export function LiveRefresh({ intervalMs = LIVE_REFRESH_MS }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    let last = Date.now();
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      last = Date.now();
      router.refresh();
    };
    const timer = setInterval(refresh, intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - last >= intervalMs) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, intervalMs]);
  return null;
}
