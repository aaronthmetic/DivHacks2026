import { ObjectId } from "mongodb";
import { getMongo } from "@/lib/mongodb";
import { getSession } from "@/lib/session";

type MongoNotification = {
  _id: ObjectId;
  userId: ObjectId;
  actorId?: ObjectId;

  type: string;
  message: string;

  href?: string;

  read: boolean;
  readAt?: Date;

  createdAt: Date;
};

export type UserNotification = {
  id: string;
  type: string;
  message: string;
  href?: string;
  read: boolean;
  createdAt: string;
};

export async function getCurrentUserNotifications(
  limit = 20,
): Promise<{
  notifications: UserNotification[];
  unreadCount: number;
}> {
  const session = await getSession();

  if (
    !session?.user?.id ||
    !ObjectId.isValid(session.user.id)
  ) {
    console.log(
      "[notifications] No valid logged-in user:",
      session?.user?.id,
    );

    return {
      notifications: [],
      unreadCount: 0,
    };
  }

  const { db } = await getMongo();

  // IMPORTANT: collection is "notification", singular
  const notificationsCollection =
    db.collection<MongoNotification>("notification");

  const userId = new ObjectId(session.user.id);

  console.log(
    "[notifications] Looking for notifications for:",
    userId.toHexString(),
  );

  const docs = await notificationsCollection
    .find({
      userId,
    })
    .sort({
      createdAt: -1,
    })
    .limit(limit)
    .toArray();

  console.log(
    "[notifications] Found:",
    docs.length,
  );

  console.log(
    "[notifications] Documents:",
    docs,
  );

  const unreadCount =
    await notificationsCollection.countDocuments({
      userId,
      read: false,
    });

  return {
    notifications: docs.map((notification) => ({
      id: notification._id.toHexString(),
      type: notification.type,
      message: notification.message,
      href: notification.href,
      read: notification.read,
      createdAt:
        notification.createdAt.toISOString(),
    })),

    unreadCount,
  };
}