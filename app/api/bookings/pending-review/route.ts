import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";

import { exchangeCollections, reviewRequired } from "@/lib/exchange-schema";
import { getMongo } from "@/lib/mongodb";
import { getSession } from "@/lib/session";

export async function GET() {
  try {
    const session = await getSession();
    if (!session?.user?.id || !ObjectId.isValid(session.user.id)) {
      return NextResponse.json(
        { booking: null },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const userId = new ObjectId(session.user.id);
    const { db } = await getMongo();
    const { bookings, reviews } = exchangeCollections(db);

    // A completed barter can be reviewed by both participants, regardless
    // of which participant pressed Finish Barter. A review the other person's
    // finish is waiting on is required and comes first; otherwise the newest.
    const completed = bookings.find(
      {
        status: "completed",
        $or: [{ requesterId: userId }, { providerId: userId }],
      },
      { projection: { _id: 1, completedBy: 1, providerId: 1 } },
    ).sort({ updatedAt: -1 });

    let optional: string | null = null;
    for await (const booking of completed) {
      const review = await reviews.findOne(
        { bookingId: booking._id, authorId: userId },
        { projection: { _id: 1 } },
      );
      if (review) continue;
      if (reviewRequired(booking, userId)) {
        return NextResponse.json(
          { booking: { id: booking._id.toHexString(), required: true } },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      optional ??= booking._id.toHexString();
    }

    if (optional) {
      return NextResponse.json(
        { booking: { id: optional, required: false } },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json(
      { booking: null },
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
