import { notFound } from "next/navigation";
import { ObjectId } from "mongodb";

import { getMongo } from "@/lib/mongodb";
import { exchangeCollections, reviewRequired } from "@/lib/exchange-schema";
import { finisherFirstName } from "@/lib/review-prompt";
import { requireSession } from "@/lib/session";
import { ReviewModal } from "@/components/barter/review-modal";

export const dynamic = "force-dynamic";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{
    id: string;
  }>;
}) {
  const { user } = await requireSession();
  const { id } = await params;

  if (!/^[a-f\d]{24}$/i.test(id)) {
    notFound();
  }

  const { db } = await getMongo();
  const { bookings, reviews } = exchangeCollections(db);
  const viewer = new ObjectId(user.id);

  // Only the two people in a booking can open it; anyone else gets a 404.
  const booking = await bookings.findOne({
    _id: new ObjectId(id),
    $or: [{ requesterId: viewer }, { providerId: viewer }],
  });

  if (!booking) {
    notFound();
  }

  const reviewed = Boolean(
    await reviews.findOne({ bookingId: booking._id, authorId: viewer }, { projection: { _id: 1 } }),
  );

  const canReview = booking.status === "completed" && !reviewed;
  // When the other person finished it, the review can't be skipped (PendingReviewPrompt).
  const requiredBy = canReview && reviewRequired(booking, viewer) ? await finisherFirstName(db, booking) : undefined;

  return (
    <div className="min-h-dvh bg-barter-read">
      <ReviewModal
        bookingId={booking._id.toHexString()}
        serviceTitle={
          booking.serviceSnapshot.title
        }
        canReview={canReview}
        reviewed={reviewed}
        requiredBy={requiredBy}
      />
    </div>
  );
}
