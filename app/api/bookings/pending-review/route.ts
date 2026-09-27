import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";

import { getMongo } from "@/lib/mongodb";
import { pendingReview } from "@/lib/review-prompt";
import { getSession } from "@/lib/session";

/** The viewer's next review to show as a popup (`PendingReviewPrompt`), or `booking: null`. */
export async function GET() {
  try {
    const session = await getSession();
    if (!session?.user?.id || !ObjectId.isValid(session.user.id)) {
      return NextResponse.json(
        { booking: null },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const { db } = await getMongo();
    return NextResponse.json(
      { booking: await pendingReview(db, new ObjectId(session.user.id)) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("GET /api/bookings/pending-review failed:", error);
    return NextResponse.json(
      { error: "Unable to check pending reviews." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
