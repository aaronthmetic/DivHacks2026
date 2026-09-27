import { notFound } from "next/navigation";
import { ObjectId } from "mongodb";

import { getMongo } from "@/lib/mongodb";
import { exchangeCollections } from "@/lib/exchange-schema";
import { ReviewModal } from "@/components/barter/review-modal";

export const dynamic = "force-dynamic";

export default async function ReviewPage({
  params,
}: {
  params: Promise<{
    id: string;
  }>;
}) {
  const { id } = await params;

  if (!ObjectId.isValid(id)) {
    notFound();
  }

  const { db } = await getMongo();

  const { bookings } = exchangeCollections(db);

  const booking = await bookings.findOne({
    _id: new ObjectId(id),
  });

  if (!booking) {
    notFound();
  }

  return (
    <div className="min-h-dvh bg-barter-read">
      <ReviewModal
        bookingId={booking._id.toHexString()}
        serviceTitle={
          booking.serviceSnapshot.title
        }
        canReview={booking.status === "completed"}
      />
    </div>
  );
}