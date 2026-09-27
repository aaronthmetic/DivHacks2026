import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";

import { getMongo } from "@/lib/mongodb";
import { getSession } from "@/lib/session";

import {
  addReview,
  appendReviewToUser,
} from "@/lib/exchange-actions";

import {
  exchangeCollections,
} from "@/lib/exchange-schema";

export async function POST(request: Request) {
  try {
    const session = await getSession();

    if (!session?.user?.id) {
      return NextResponse.json(
        {
          error: "You must be signed in to leave a review.",
        },
        {
          status: 401,
        },
      );
    }

    const body = await request.json();

    const bookingId = body.bookingId;
    const rating = Number(body.rating);
    const comment =
      typeof body.comment === "string"
        ? body.comment.trim()
        : "";

    /*
     * Validate request.
     */
    if (
      typeof bookingId !== "string" ||
      !ObjectId.isValid(bookingId)
    ) {
      return NextResponse.json(
        {
          error: "Invalid booking ID.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      !Number.isInteger(rating) ||
      rating < 1 ||
      rating > 5
    ) {
      return NextResponse.json(
        {
          error:
            "Rating must be a whole number from 1 to 5.",
        },
        {
          status: 400,
        },
      );
    }

    if (!comment) {
      return NextResponse.json(
        {
          error: "A review comment is required.",
        },
        {
          status: 400,
        },
      );
    }

    if (comment.length > 2000) {
      return NextResponse.json(
        {
          error:
            "Review comments cannot exceed 2000 characters.",
        },
        {
          status: 400,
        },
      );
    }

    if (!ObjectId.isValid(session.user.id)) {
      return NextResponse.json(
        {
          error: "Invalid user session.",
        },
        {
          status: 401,
        },
      );
    }

    const { db } = await getMongo();

    const {
      bookings,
      reviews,
    } = exchangeCollections(db);

    const bookingObjectId =
      new ObjectId(bookingId);

    const authorId =
      new ObjectId(session.user.id);

    /*
     * Find booking.
     */
    const booking = await bookings.findOne({
      _id: bookingObjectId,
    });

    if (!booking) {
      return NextResponse.json(
        {
          error: "Booking not found.",
        },
        {
          status: 404,
        },
      );
    }

    /*
     * Reviews are only allowed after the booking
     * has been completed.
     */
    if (booking.status !== "completed") {
      return NextResponse.json(
        {
          error:
            "This booking must be completed before it can be reviewed.",
        },
        {
          status: 400,
        },
      );
    }

    const isRequester =
      booking.requesterId.equals(authorId);

    const isProvider =
      booking.providerId.equals(authorId);

    /*
     * Only people involved in the booking may review it.
     */
    if (!isRequester && !isProvider) {
      return NextResponse.json(
        {
          error:
            "You are not part of this booking.",
        },
        {
          status: 403,
        },
      );
    }

    /*
     * Determine the person being reviewed.
     *
     * Requester reviews provider.
     * Provider reviews requester.
     */
    const subjectUserId = isRequester
      ? booking.providerId
      : booking.requesterId;

    /*
     * Prevent more than one review from the same
     * person for the same booking.
     */
    const existingReview =
      await reviews.findOne({
        bookingId: bookingObjectId,
        authorId,
      });

    if (existingReview) {
      return NextResponse.json(
        {
          error:
            "You have already reviewed this booking.",
        },
        {
          status: 409,
        },
      );
    }

    /*
     * Create review using your existing
     * exchange-actions helper.
     */
    const review = await addReview(db, {
      bookingId: bookingObjectId,
      authorId,
      subjectUserId,
      rating,
      comment,
    });

    /*
     * Update the reviewed user's:
     *
     * rating
     * numberOfReviews
     * reviews[]
     */
    await appendReviewToUser(
      db,
      subjectUserId,
      review._id,
      review.rating,
    );

    return NextResponse.json(
      {
        review: {
          id: review._id.toHexString(),
          bookingId:
            review.bookingId.toHexString(),
          authorId:
            review.authorId.toHexString(),
          subjectUserId:
            review.subjectUserId.toHexString(),
          rating: review.rating,
          comment: review.comment,
          createdAt:
            review.createdAt.toISOString(),
        },
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    console.error(
      "POST /api/reviews failed:",
      error,
    );

    return NextResponse.json(
      {
        error: "Failed to submit review.",
      },
      {
        status: 500,
      },
    );
  }
}