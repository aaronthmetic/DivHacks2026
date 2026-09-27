import { ObjectId, type ClientSession } from "mongodb";
import { NextResponse } from "next/server";
import { getMongo } from "@/lib/mongodb";
import { getSession } from "@/lib/session";
import {
  acceptBooking,
  addReview,
  appendReviewToUser,
  BookingAcceptanceError,
} from "@/lib/exchange-actions";
import { exchangeCollections, type Booking } from "@/lib/exchange-schema";

class BookingRouteError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BookingRouteError";
  }
}

function serializeBooking(booking: Booking) {
  return {
    id: booking._id.toHexString(),
    serviceId: booking.serviceId.toHexString(),
    providerId: booking.providerId.toHexString(),
    requesterId: booking.requesterId.toHexString(),
    serviceSnapshot: booking.serviceSnapshot,
    durationMinutes: booking.durationMinutes,
    totalCredits: booking.totalCredits,
    scheduledAt: booking.scheduledAt,
    providerCompletedAt: booking.providerCompletedAt,
    requesterConfirmedAt: booking.requesterConfirmedAt,
    status: booking.status,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
  };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let mongoSession: ClientSession | undefined;
  try {
    const session = await getSession();
    if (!session?.user?.id || !ObjectId.isValid(session.user.id)) {
      return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    }
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid booking ID." }, { status: 400 });
    }
    const body = await request.json();
    if (body?.status !== "accepted" && body?.status !== "completed") {
      return NextResponse.json(
        { error: 'The booking status must be "accepted" or "completed".' },
        { status: 400 },
      );
    }

    const { client, db } = await getMongo();

    // Production acceptance: call the same exchange action as the test shortcut,
    // with the authenticated actor. Only the provider can accept the request.
    if (body.status === "accepted") {
      const booking = await acceptBooking(db, {
        bookingId: id,
        actorId: session.user.id,
      });
      return NextResponse.json({ success: true, booking: serializeBooking(booking) });
    }

    const bookingId = new ObjectId(id);
    const currentUserId = new ObjectId(session.user.id);
    const { bookings, accounts, transactions } = exchangeCollections(db);
    mongoSession = client.startSession();
    let completedBooking: Booking | null = null;
    let completedByOwner = false;
    let remainingCredits: number | null = null;
    let providerCredits: number | null = null;

    await mongoSession.withTransaction(async () => {
      const booking = await bookings.findOne(
        { _id: bookingId },
        { session: mongoSession },
      );
      if (!booking) {
        throw new BookingRouteError(404, "BOOKING_NOT_FOUND", "Booking not found.");
      }
      const isRequester = booking.requesterId.equals(currentUserId);
      const isOwner = booking.providerId.equals(currentUserId);
      if (!isRequester && !isOwner) {
        throw new BookingRouteError(403, "NOT_BOOKING_PARTICIPANT", "You are not part of this booking.");
      }
      if (booking.status === "completed") {
        throw new BookingRouteError(409, "BOOKING_ALREADY_COMPLETED", "This booking has already been completed.");
      }
      if (booking.status !== "accepted") {
        throw new BookingRouteError(400, "BOOKING_NOT_ACCEPTED", "Only an accepted booking can be completed.");
      }
      if (booking.requesterId.equals(booking.providerId)) {
        throw new BookingRouteError(400, "INVALID_BOOKING_PARTICIPANTS", "The requester and provider must be different users.");
      }

      const now = new Date();
      if (isOwner) {
        // The provider owns the service. Completing it from their side does
        // not check balances, debit the requester, credit the provider, or
        // create credit transactions.
        const updatedBooking = await bookings.findOneAndUpdate(
          { _id: booking._id, status: "accepted" },
          { $set: { status: "completed", providerCompletedAt: now, updatedAt: now } },
          { returnDocument: "after", session: mongoSession },
        );
        if (!updatedBooking) {
          throw new BookingRouteError(409, "BOOKING_STATUS_CHANGED", "The booking status changed before it could be completed.");
        }
        completedBooking = updatedBooking;
        completedByOwner = true;
        return;
      }

      if (!Number.isFinite(booking.totalCredits) || booking.totalCredits <= 0) {
        throw new BookingRouteError(400, "INVALID_BOOKING_CREDITS", "This booking has an invalid credit amount.");
      }

      const updatedAccount = await accounts.findOneAndUpdate(
        {
          userId: booking.requesterId,
          availableCredits: { $gte: booking.totalCredits },
        },
        {
          $inc: { availableCredits: -booking.totalCredits },
          $set: { updatedAt: now },
        },
        { returnDocument: "after", session: mongoSession },
      );
      if (!updatedAccount) {
        throw new BookingRouteError(
          400,
          "INSUFFICIENT_CREDITS",
          "You do not have enough credits to complete this booking.",
        );
      }
      remainingCredits = updatedAccount.availableCredits;

      // An account may not exist yet for a provider who has never received
      // credits. $inc creates availableCredits with this amount on insert.
      const providerAccount = await accounts.findOneAndUpdate(
        { userId: booking.providerId },
        {
          $inc: { availableCredits: booking.totalCredits },
          $set: { updatedAt: now },
          $setOnInsert: {
            _id: new ObjectId(),
            userId: booking.providerId,
            heldCredits: 0,
            createdAt: now,
          },
        },
        { upsert: true, returnDocument: "after", session: mongoSession },
      );
      if (!providerAccount) {
        throw new Error("Failed to credit the provider's account.");
      }
      providerCredits = providerAccount.availableCredits;

      await transactions.insertOne(
        {
          _id: new ObjectId(),
          accountId: updatedAccount._id,
          bookingId: booking._id,
          type: "payment",
          availableDelta: -booking.totalCredits,
          heldDelta: 0,
          idempotencyKey: `booking:${booking._id.toHexString()}:completion-payment`,
          createdAt: now,
        },
        { session: mongoSession },
      );
      await transactions.insertOne(
        {
          _id: new ObjectId(),
          accountId: providerAccount._id,
          bookingId: booking._id,
          type: "earning",
          availableDelta: booking.totalCredits,
          heldDelta: 0,
          idempotencyKey: `booking:${booking._id.toHexString()}:completion-earning`,
          createdAt: now,
        },
        { session: mongoSession },
      );

      const updatedBooking = await bookings.findOneAndUpdate(
        { _id: booking._id, status: "accepted" },
        { $set: { status: "completed", requesterConfirmedAt: now, updatedAt: now } },
        { returnDocument: "after", session: mongoSession },
      );
      if (!updatedBooking) {
        throw new BookingRouteError(409, "BOOKING_STATUS_CHANGED", "The booking status changed before it could be completed.");
      }
      completedBooking = updatedBooking;
    });

    if (!completedBooking) {
      throw new Error("Booking completion transaction did not return a booking.");
    }
    const result: Booking = completedBooking;
    return NextResponse.json({
      success: true,
      booking: serializeBooking(result),
      credits: completedByOwner ? null : {
        deducted: result.totalCredits,
        remaining: remainingCredits,
        earned: result.totalCredits,
        providerBalance: providerCredits,
      },
    });
  } catch (error) {
    console.error("PATCH /api/bookings/[id] failed:", error);
    if (error instanceof BookingAcceptanceError || error instanceof BookingRouteError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      return NextResponse.json(
        { error: "This booking has already been charged.", code: "BOOKING_ALREADY_CHARGED" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update booking." },
      { status: 500 },
    );
  } finally {
    if (mongoSession) await mongoSession.endSession();
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session?.user?.id || !ObjectId.isValid(session.user.id)) {
      return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    }
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid booking ID." }, { status: 400 });
    }
    const body = await request.json();
    const rating = Number(body.rating);
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return NextResponse.json(
        { error: "Rating must be a whole number from 1 to 5." },
        { status: 400 },
      );
    }
    if (!comment) {
      return NextResponse.json({ error: "A review comment is required." }, { status: 400 });
    }
    if (comment.length > 2000) {
      return NextResponse.json(
        { error: "Review comments cannot exceed 2000 characters." },
        { status: 400 },
      );
    }

    const bookingId = new ObjectId(id);
    const authorId = new ObjectId(session.user.id);
    const { db } = await getMongo();
    const { bookings, reviews } = exchangeCollections(db);
    const booking = await bookings.findOne({ _id: bookingId });
    if (!booking) {
      return NextResponse.json({ error: "Booking not found." }, { status: 404 });
    }
    if (booking.status !== "completed") {
      return NextResponse.json(
        { error: "This booking must be completed before you can leave a review." },
        { status: 400 },
      );
    }
    const isRequester = booking.requesterId.equals(authorId);
    const isProvider = booking.providerId.equals(authorId);
    if (!isRequester && !isProvider) {
      return NextResponse.json({ error: "You are not part of this booking." }, { status: 403 });
    }
    const subjectUserId = isRequester ? booking.providerId : booking.requesterId;
    const existingReview = await reviews.findOne({ bookingId, authorId });
    if (existingReview) {
      return NextResponse.json(
        { error: "You have already reviewed this booking." },
        { status: 409 },
      );
    }

    const review = await addReview(db, {
      bookingId,
      authorId,
      subjectUserId,
      rating,
      comment,
    });
    await appendReviewToUser(db, subjectUserId.toHexString(), review._id, review.rating);
    return NextResponse.json(
      {
        success: true,
        review: {
          id: review._id.toHexString(),
          bookingId: review.bookingId.toHexString(),
          authorId: review.authorId.toHexString(),
          subjectUserId: review.subjectUserId.toHexString(),
          rating: review.rating,
          comment: review.comment,
          createdAt: review.createdAt.toISOString(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("POST /api/bookings/[id] failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to submit review." },
      { status: 500 },
    );
  }
}
