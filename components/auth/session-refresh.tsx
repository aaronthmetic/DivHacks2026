"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Module-level so the throttle also holds across navigations, which re-run the effect.
let inFlight = false;
let lastAttempt = 0;

async function refresh() {
  if (document.visibilityState !== "visible" || inFlight || Date.now() - lastAttempt < 60_000) return;
  inFlight = true;
  lastAttempt = Date.now();
  try {
    await fetch("/api/auth/get-session", { credentials: "same-origin", cache: "no-store" });
  } catch {
    // A transient network failure is retried on the next visible interval.
  } finally { inFlight = false; }
}

// Route responses can renew HttpOnly cookies; Server Component reads cannot. The root layout
// mounts this once for signed-in visitors, so every protected page renews sessions.
export function SessionRefresh() {
  const pathname = usePathname();
  useEffect(() => {
    void refresh();
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    const interval = window.setInterval(refresh, 5 * 60_000);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      window.clearInterval(interval);
    };
  }, [pathname]);
  return null;
}
