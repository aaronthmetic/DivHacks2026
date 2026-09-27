"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ReviewModal } from "./review-modal";

type Review = { id: string; serviceTitle: string; required?: boolean; requiredBy?: string };

// Optional reviews already offered in this tab's visit. Session storage clears when the app
// is closed, so the review comes back the next time it's opened.
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

const OPEN = "barter:review";
/** Opens the review popup over the current page, as Finish Barter does once the barter is done. */
export function openReview(review: Review) {
  window.dispatchEvent(new CustomEvent<Review>(OPEN, { detail: review }));
}

/**
 * Pops up a review of a completed barter the viewer hasn't reviewed, over whatever page is
 * open. When the other person finished it the review is required: the popup can't be closed
 * and comes back on every page until it's sent. A barter they finished themselves is offered
 * once per visit.
 */
export function PendingReviewPrompt() {
  const pathname = usePathname();
  const router = useRouter();
  const [review, setReview] = useState<Review | null>(null);
  const [checks, setChecks] = useState(0);

  useEffect(() => {
    const show = (event: Event) => setReview((event as CustomEvent<Review>).detail);
    window.addEventListener(OPEN, show);
    return () => window.removeEventListener(OPEN, show);
  }, []);

  useEffect(() => {
    // The review page shows its own form.
    if (/^\/bookings\/[^/]+\/review(?:\/|$)/.test(pathname)) return;

    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/bookings/pending-review", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const data: { booking?: Review | null } = await response.json();
        const next = data.booking;
        if (controller.signal.aborted || !next || !/^[0-9a-f]{24}$/i.test(next.id)) return;
        if (next.required || !prompted(next.id)) setReview((open) => open ?? next);
      } catch (error) {
        if (!controller.signal.aborted) console.error("Unable to check pending reviews:", error);
      }
    })();
    return () => controller.abort();
  }, [pathname, checks]);

  if (!review || /^\/bookings\/[^/]+\/review(?:\/|$)/.test(pathname)) return null;
  return (
    <ReviewModal
      key={review.id}
      bookingId={review.id}
      serviceTitle={review.serviceTitle}
      requiredBy={review.required ? review.requiredBy ?? "Your partner" : undefined}
      onClose={() => {
        // Closing an optional review means "not now".
        remember(review.id);
        setReview(null);
      }}
      onReviewed={() => {
        setReview(null);
        router.refresh();
        // Another barter may be waiting for a review.
        setChecks((n) => n + 1);
      }}
    />
  );
}
