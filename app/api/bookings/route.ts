import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";

import { getMongo } from "@/lib/mongodb";
import { getSession } from "@/lib/session";
import { addBooking } from "@/lib/exchange-actions";
import { exchangeCollections } from "@/lib/exchange-schema";

/*
 * Find an accepted booking for a service involving
 * the currently logged-in user.
 *
 * GET:
 * /api/bookings?serviceId=...&status=accepted
 */
export async function GET(request: Request) {
  try {
    const session = await getSession();

    if (!session?.user?.id) {
      return NextResponse.json(
        {
          error: "Unauthorized",
        },
        {
          status: 401,
        },
      );
    }

    if (!ObjectId.isValid(session.user.id)) {
      return NextResponse.json(
        {
          error: "Invalid user ID",
        },
        {
          status: 400,
        },
      );
    }

    const url = new URL(request.url);

    const serviceId =
      url.searchParams.get("serviceId");

    const status =
      url.searchParams.get("status");

    if (
      !serviceId ||
      !ObjectId.isValid(serviceId)
    ) {
      return NextResponse.json(
        {
          error: "Invalid service ID",
        },
        {
          status: 400,
        },
      );
    }

    if (
      status !== null &&
      status !== "accepted"
    ) {
      return NextResponse.json(
        {
          error:
            "Only accepted booking lookup is supported",
        },
        {
          status: 400,
        },
      );
    }

    const { db } = await getMongo();

    const { bookings } =
      exchangeCollections(db);

    const userId = new ObjectId(
      session.user.id,
    );

    const serviceObjectId =
      new ObjectId(serviceId);

    /*
     * The user can be either:
     *
     * requesterId -> they requested the service
     * providerId  -> they provide the service
     */
    const booking = await bookings.findOne(
      {
        serviceId: serviceObjectId,
        status: "accepted",
        $or: [
          {
            requesterId: userId,
          },
          {
            providerId: userId,
          },
        ],
      },
      {
        sort: {
          updatedAt: -1,
        },
      },
    );

    if (!booking) {
      return NextResponse.json({
        booking: null,
      });
    }

    return NextResponse.json({
      booking: {
        id: booking._id.toString(),

        serviceId:
          booking.serviceId.toString(),

        providerId:
          booking.providerId.toString(),

        requesterId:
          booking.requesterId.toString(),

        status: booking.status,

        serviceSnapshot:
          booking.serviceSnapshot,

        durationMinutes:
          booking.durationMinutes,

        totalCredits:
          booking.totalCredits,

        scheduledAt:
          booking.scheduledAt,

        createdAt:
          booking.createdAt,

        updatedAt:
          booking.updatedAt,
      },
    });
  } catch (error) {
    console.error(
      "Failed to retrieve accepted booking:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Failed to retrieve accepted booking",
      },
      {
        status: 500,
      },
    );
  }
}

/*
 * Create a new booking.
 *
 * POST:
 * /api/bookings
 *
 * Body:
 * {
 *   serviceId: string,
 *   durationMinutes?: number
 * }
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();

    if (!session?.user?.id) {
      return NextResponse.json(
        {
          error: "Unauthorized",
        },
        {
          status: 401,
        },
      );
    }

    if (!ObjectId.isValid(session.user.id)) {
      return NextResponse.json(
        {
          error: "Invalid user ID",
        },
        {
          status: 400,
        },
      );
    }

    const body = await request.json();

    const serviceId =
      typeof body.serviceId === "string"
        ? body.serviceId.trim()
        : "";

    const durationMinutes =
      body.durationMinutes;

    if (!serviceId) {
      return NextResponse.json(
        {
          error: "serviceId is required",
        },
        {
          status: 400,
        },
      );
    }

    if (!ObjectId.isValid(serviceId)) {
      return NextResponse.json(
        {
          error: "Invalid serviceId",
        },
        {
          status: 400,
        },
      );
    }

    /*
     * durationMinutes is optional because fixed-price
     * services do not need it.
     *
     * If provided, however, it must be a positive
     * whole number.
     */
    if (
      durationMinutes !== undefined &&
      (!Number.isInteger(durationMinutes) ||
        durationMinutes <= 0)
    ) {
      return NextResponse.json(
        {
          error:
            "An hourly booking requires positive whole minutes.",
        },
        {
          status: 400,
        },
      );
    }

    const { db } = await getMongo();

    const booking = await addBooking(db, {
      serviceId,

      requesterId:
        session.user.id,

      durationMinutes:
        durationMinutes !== undefined
          ? durationMinutes
          : undefined,
    });

    return NextResponse.json(
      {
        booking: {
          id: booking._id.toString(),

          serviceId:
            booking.serviceId.toString(),

          providerId:
            booking.providerId.toString(),

          requesterId:
            booking.requesterId.toString(),

          serviceSnapshot:
            booking.serviceSnapshot,

          durationMinutes:
            booking.durationMinutes,

          totalCredits:
            booking.totalCredits,

          scheduledAt:
            booking.scheduledAt,

          status:
            booking.status,

          createdAt:
            booking.createdAt,

          updatedAt:
            booking.updatedAt,
        },
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    console.error(
      "Failed to create booking:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to create booking",
      },
      {
        status: 500,
      },
    );
  }
}