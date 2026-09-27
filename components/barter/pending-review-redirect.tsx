"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

// Bookings already offered in this tab's visit. Session storage clears when the app is
// closed, so the review comes back the next time it's opened.
const KEY = "barter:reviewPrompted";
function promptedIds(): string[] {
  try { return JSON.parse(sessionStorage.getItem(KEY) ?? "[]"); } catch { return []; }
}
function prompted(id: string) {
  return promptedIds().includes(id);
}
function remember(id: string) {
  try { if (!prompted(id)) sessionStorage.setItem(KEY, JSON.stringify([...promptedIds(), id])); } catch {}
}

/**
 * Sends someone to review a completed barter they haven't reviewed. When the other person
 * finished it the review is required, so every page sends them back until it's written;
 * a barter they finished themselves is offered once per visit.
 */
export function PendingReviewRedirect() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    // Leave the current review page alone, even if another review is pending, and don't
    // offer an optional one again this visit: closing it means "not now".
    const reviewing = /^\/bookings\/([0-9a-f]{24})\/review(?:\/|$)/i.exec(pathname);
    if (reviewing) {
      remember(reviewing[1]);
      return;
    }

    const controller = new AbortController();

    async function checkForReview() {
      try {
        const response = await fetch("/api/bookings/pending-review", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok || controller.signal.aborted) return;

        const data: { booking?: { id?: unknown; required?: unknown } | null } = await response.json();
        const id = data.booking?.id;
        if (
          !controller.signal.aborted &&
          typeof id === "string" &&
          /^[0-9a-f]{24}$/i.test(id) &&
          (data.booking?.required === true || !prompted(id))
        ) {
          router.replace(`/bookings/${id}/review`);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("Unable to check pending reviews:", error);
        }
      }
    }

    void checkForReview();
    return () => controller.abort();
  }, [pathname, router]);

  return null;
}
