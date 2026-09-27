import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";

import { getMongo } from "@/lib/mongodb";
import { getSession } from "@/lib/session";
import { addReview } from "@/lib/exchange-actions";
import { exchangeCollections } from "@/lib/exchange-schema";

export async function POST(request: Request) {
  try {
    const session = await getSession();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "You must be signed in to leave a review." },
        { status: 401 },
      );
    }

    const body = await request.json();

    const bookingId = String(body.bookingId ?? "");
    const rating = Number(body.rating);
    const comment = String(body.comment ?? "").trim();

    // ---------------------------------------------------------
    // Validate input
    // ---------------------------------------------------------

    if (!ObjectId.isValid(bookingId)) {
      return NextResponse.json(
        { error: "Invalid booking ID." },
        { status: 400 },
      );
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return NextResponse.json(
        { error: "Rating must be between 1 and 5." },
        { status: 400 },
      );
    }

    if (!comment) {
      return NextResponse.json(
        { error: "Review comment is required." },
        { status: 400 },
      );
    }

    if (comment.length > 2000) {
      return NextResponse.json(
        { error: "Review comment cannot exceed 2000 characters." },
        { status: 400 },
      );
    }

    const { db } = await getMongo();

    const {
      bookings,
      reviews,
    } = exchangeCollections(db);

    const bookingObjectId = new ObjectId(bookingId);
    const authorId = new ObjectId(session.user.id);

    // ---------------------------------------------------------
    // Load booking
    // ---------------------------------------------------------

    const booking = await bookings.findOne({
      _id: bookingObjectId,
    });

    if (!booking) {
      return NextResponse.json(
        { error: "Booking not found." },
        { status: 404 },
      );
    }

    // Only completed bookings can be reviewed.
    if (booking.status !== "completed") {
      return NextResponse.json(
        {
          error:
            "This booking must be completed before it can be reviewed.",
        },
        { status: 400 },
      );
    }

    // ---------------------------------------------------------
    // Make sure logged-in user participated in booking
    // ---------------------------------------------------------

    const isRequester =
      booking.requesterId.toString() === authorId.toString();

    const isProvider =
      booking.providerId.toString() === authorId.toString();

    if (!isRequester && !isProvider) {
      return NextResponse.json(
        {
          error:
            "You are not allowed to review this booking.",
        },
        { status: 403 },
      );
    }

    // The review is about the OTHER user in the booking.
    const subjectUserId = isRequester
      ? booking.providerId
      : booking.requesterId;

    // ---------------------------------------------------------
    // Prevent duplicate reviews
    // ---------------------------------------------------------

    const existingReview = await reviews.findOne({
      bookingId: bookingObjectId,
      authorId,
    });

    if (existingReview) {
      return NextResponse.json(
        {
          error:
            "You have already reviewed this booking.",
        },
        { status: 409 },
      );
    }

    // ---------------------------------------------------------
    // Create Review using your Review schema/helper
    //
    // Review:
    // {
    //   _id,
    //   bookingId,
    //   authorId,
    //   subjectUserId,
    //   rating,
    //   comment,
    //   createdAt
    // }
    // ---------------------------------------------------------

    const review = await addReview(db, {
      bookingId: bookingObjectId.toString(),
      authorId: authorId.toString(),
      subjectUserId: subjectUserId.toString(),
      rating,
      comment,
    });

    return NextResponse.json(
      {
        success: true,
        review: {
          id: review._id.toString(),
          bookingId: review.bookingId.toString(),
          authorId: review.authorId.toString(),
          subjectUserId: review.subjectUserId.toString(),
          rating: review.rating,
          comment: review.comment,
          createdAt: review.createdAt,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Failed to create review:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to create review.",
      },
      { status: 500 },
    );
  }
}