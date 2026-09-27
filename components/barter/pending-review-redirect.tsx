"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

export function PendingReviewRedirect() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    // Leave the current review page alone, even if another review is pending.
    if (/^\/bookings\/[^/]+\/review(?:\/|$)/.test(pathname)) return;

    const controller = new AbortController();

    async function checkForReview() {
      try {
        const response = await fetch("/api/bookings/pending-review", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok || controller.signal.aborted) return;

        const data: { booking?: { id?: unknown } | null } = await response.json();
        const id = data.booking?.id;
        if (
          !controller.signal.aborted &&
          typeof id === "string" &&
          /^[0-9a-f]{24}$/i.test(id)
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
