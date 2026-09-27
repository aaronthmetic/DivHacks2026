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
    const session =
      await getSession();

    if (
      !session?.user?.id ||
      !ObjectId.isValid(
        session.user.id,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "You must be signed in.",
        },
        {
          status: 401,
        },
      );
    }

    const { id } =
      await params;

    if (
      !ObjectId.isValid(id)
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid notification ID.",
        },
        {
          status: 400,
        },
      );
    }

    const body =
      await request.json();

    if (
      body?.read !== true
    ) {
      return NextResponse.json(
        {
          error:
            "read must be true.",
        },
        {
          status: 400,
        },
      );
    }

    const { db } =
      await getMongo();

    const {
      notifications,
    } =
      exchangeCollections(db);

    const notificationId =
      new ObjectId(id);

    const userId =
      new ObjectId(
        session.user.id,
      );

    /*
     * userId is included in the filter so a user can only modify
     * notifications belonging to their own account.
     */
    const result =
      await notifications.updateOne(
        {
          _id: notificationId,
          userId,
        },
        {
          $set: {
            read: true,
          },
        },
      );

    if (
      result.matchedCount ===
      0
    ) {
      return NextResponse.json(
        {
          error:
            "Notification not found.",
        },
        {
          status: 404,
        },
      );
    }

    return NextResponse.json({
      success: true,
      notification: {
        id,
        read: true,
      },
    });
  } catch (error) {
    console.error(
      "PATCH /api/notifications/[id] failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to mark notification as read.",
      },
      {
        status: 500,
      },
    );
  }
}