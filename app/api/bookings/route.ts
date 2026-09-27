import { ObjectId, type ClientSession } from "mongodb";
import { NextResponse } from "next/server";
import { getMongo } from "@/lib/mongodb";
import { getSession } from "@/lib/session";
import {
  addBooking,
  BookingAcceptanceError,
  createAcceptedTestBooking,
} from "@/lib/exchange-actions";
import { exchangeCollections, type Booking } from "@/lib/exchange-schema";

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
    status: booking.status,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
  };
}

export async function POST(request: Request) {
  let mongoSession: ClientSession | undefined;
  try {
    const session = await getSession();
    if (!session?.user?.id || !ObjectId.isValid(session.user.id)) {
      return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    }

    const body = await request.json();
    const { serviceId, durationMinutes, status } = body;
    if (typeof serviceId !== "string" || !ObjectId.isValid(serviceId)) {
      return NextResponse.json({ error: "A valid serviceId is required." }, { status: 400 });
    }
    if (
      durationMinutes !== undefined &&
      (!Number.isInteger(durationMinutes) || durationMinutes <= 0)
    ) {
      return NextResponse.json(
        { error: "durationMinutes must be a positive whole number." },
        { status: 400 },
      );
    }
    if (status !== undefined && status !== "accepted") {
      return NextResponse.json(
        { error: 'The only supported test status is "accepted".' },
        { status: 400 },
      );
    }
    if (status === "accepted" && process.env.NODE_ENV !== "development") {
      return NextResponse.json(
        { error: "Test bookings are only available in development." },
        { status: 403 },
      );
    }

    const { client, db } = await getMongo();
    const input = { serviceId, requesterId: session.user.id, durationMinutes };
    mongoSession = client.startSession();
    const booking = await mongoSession.withTransaction(async () =>
      status === "accepted"
        ? createAcceptedTestBooking(db, input, { session: mongoSession })
        : addBooking(db, input, { session: mongoSession }),
    );
    if (!booking) {
      throw new Error("Booking creation did not return a booking.");
    }

    return NextResponse.json({ booking: serializeBooking(booking) }, { status: 201 });
  } catch (error) {
    console.error("POST /api/bookings failed:", error);
    if (error instanceof BookingAcceptanceError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    if (error instanceof Error && error.message.startsWith("INSUFFICIENT_CREDITS:")) {
      return NextResponse.json(
        {
          error: "You do not have enough credits to book this service.",
          code: "INSUFFICIENT_CREDITS",
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create booking." },
      { status: 500 },
    );
  } finally {
    if (mongoSession) await mongoSession.endSession();
  }
}

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user?.id || !ObjectId.isValid(session.user.id)) {
      return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
    }

    const url = new URL(request.url);
    const serviceId = url.searchParams.get("serviceId");
    const status = url.searchParams.get("status");
    if (!serviceId || !ObjectId.isValid(serviceId)) {
      return NextResponse.json({ error: "A valid serviceId is required." }, { status: 400 });
    }
    if (status !== null && status !== "accepted") {
      return NextResponse.json(
        { error: 'Only status="accepted" is supported.' },
        { status: 400 },
      );
    }

    const { db } = await getMongo();
    const { bookings } = exchangeCollections(db);
    const currentUserId = new ObjectId(session.user.id);
    const booking = await bookings.findOne(
      {
        serviceId: new ObjectId(serviceId),
        status: "accepted",
        $or: [
          { requesterId: currentUserId },
          { providerId: currentUserId },
        ],
      },
      { sort: { createdAt: -1 } },
    );
    return NextResponse.json({ booking: booking ? serializeBooking(booking) : null });
  } catch (error) {
    console.error("GET /api/bookings failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to retrieve booking." },
      { status: 500 },
    );
  }
}
