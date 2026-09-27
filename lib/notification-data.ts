import { ObjectId, type Db } from "mongodb";
import type { Auth } from "./auth-config";
import { logAuthFailure } from "./auth-errors";
import { exchangeCollections } from "./exchange-schema";
import type { Notification } from "./barter/data";
import { apiError } from "./profile-service";

const NOTIFICATION_LIMIT = 20;

/** The newest notifications for the header's menu. Call only from authenticated server pages. */
export async function getNotifications(db: Db, userId: string): Promise<Notification[]> {
  const docs = await exchangeCollections(db).notifications
    .find({ userId: new ObjectId(userId) })
    .sort({ createdAt: -1, _id: -1 })
    .limit(NOTIFICATION_LIMIT)
    .toArray();
  return docs.map((doc) => ({
    id: doc._id.toHexString(), message: doc.message, read: doc.read, createdAt: doc.createdAt.toISOString(),
    ...(doc.href ? { href: doc.href } : {}),
  }));
}

/** `PATCH /api/notifications/[id]`: marks one of the signed-in person's notifications read. */
export async function markNotificationRead(request: Request, id: string, auth: Auth, db: Db, origin: string) {
  try {
    if (request.headers.get("origin") !== origin) return apiError(403, "INVALID_ORIGIN", "This request is not allowed.");
    const session = await auth.api.getSession({ headers: request.headers, query: { disableRefresh: true } });
    if (!session) return apiError(401, "UNAUTHENTICATED", "Sign in to continue.");
    if (!/^[a-f\d]{24}$/i.test(id)) return apiError(400, "INVALID_INPUT", "Invalid notification ID.");
    // Filtering on the owner means nobody can change another person's notifications.
    const result = await exchangeCollections(db).notifications.updateOne(
      { _id: new ObjectId(id), userId: new ObjectId(session.user.id) },
      { $set: { read: true, readAt: new Date() } },
    );
    if (!result.matchedCount) return apiError(404, "NOT_FOUND", "Notification not found.");
    return Response.json({ success: true });
  } catch (error) {
    logAuthFailure("Notification update", error);
    return apiError(503, "UNAVAILABLE", "We could not update your notifications. Please try again.");
  }
}
