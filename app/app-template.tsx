import type { ReactNode } from "react";

import { PendingReviewRedirect } from "@/components/barter/pending-review-redirect";

export default function Template({ children }: { children: ReactNode }) {
  return (
    <>
      <PendingReviewRedirect />
      {children}
    </>
  );
}
