import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";

import { getMongo } from "@/lib/mongodb";
import { getSession } from "@/lib/session";
import { exchangeCollections } from "@/lib/exchange-schema";

export async function PATCH(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  },
) {
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

    const { id } = await params;

    if (!ObjectId.isValid(id)) {
      return NextResponse.json(
        {
          error: "Invalid booking ID",
        },
        {
          status: 400,
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

    if (body.status !== "completed") {
      return NextResponse.json(
        {
          error:
            "Only completing a booking is supported",
        },
        {
          status: 400,
        },
      );
    }

    const { db } = await getMongo();

    const { bookings } =
      exchangeCollections(db);

    const bookingId =
      new ObjectId(id);

    const userId =
      new ObjectId(session.user.id);

    /*
     * First make sure the booking actually belongs
     * to the currently logged-in user.
     */
    const booking = await bookings.findOne({
      _id: bookingId,

      $or: [
        {
          requesterId: userId,
        },
        {
          providerId: userId,
        },
      ],
    });

    if (!booking) {
      return NextResponse.json(
        {
          error:
            "Booking not found or you are not part of this booking",
        },
        {
          status: 404,
        },
      );
    }

    /*
     * Only an accepted booking can be finished.
     */
    if (booking.status !== "accepted") {
      return NextResponse.json(
        {
          error:
            `Booking cannot be completed because its current status is "${booking.status}"`,
        },
        {
          status: 409,
        },
      );
    }

    const now = new Date();

    /*
     * Repeat all important conditions in updateOne.
     *
     * This prevents a race condition where the booking
     * could change between findOne() and updateOne().
     */
    const result = await bookings.updateOne(
      {
        _id: bookingId,
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
        $set: {
          status: "completed",
          updatedAt: now,
        },
      },
    );

    if (result.modifiedCount !== 1) {
      return NextResponse.json(
        {
          error:
            "Booking could not be completed",
        },
        {
          status: 409,
        },
      );
    }

    const completedBooking =
      await bookings.findOne({
        _id: bookingId,
      });

    if (!completedBooking) {
      return NextResponse.json(
        {
          error:
            "Completed booking could not be retrieved",
        },
        {
          status: 500,
        },
      );
    }

    return NextResponse.json({
      booking: {
        id:
          completedBooking._id.toString(),

        serviceId:
          completedBooking.serviceId.toString(),

        providerId:
          completedBooking.providerId.toString(),

        requesterId:
          completedBooking.requesterId.toString(),

        serviceSnapshot:
          completedBooking.serviceSnapshot,

        durationMinutes:
          completedBooking.durationMinutes,

        totalCredits:
          completedBooking.totalCredits,

        scheduledAt:
          completedBooking.scheduledAt,

        status:
          completedBooking.status,

        createdAt:
          completedBooking.createdAt,

        updatedAt:
          completedBooking.updatedAt,
      },
    });
  } catch (error) {
    console.error(
      "Failed to complete booking:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to complete booking",
      },
      {
        status: 500,
      },
    );
  }
}