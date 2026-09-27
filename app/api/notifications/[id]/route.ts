import { getAuth } from "@/lib/auth";
import { getMongo } from "@/lib/mongodb";
import { markNotificationRead } from "@/lib/notification-data";
import { apiError } from "@/lib/profile-service";
import { logAuthFailure } from "@/lib/auth-errors";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await getAuth();
    const { db } = await getMongo();
    return await markNotificationRead(request, id, auth, db, new URL(process.env.BETTER_AUTH_URL!).origin);
  } catch (error) {
    logAuthFailure("Notification initialization", error);
    return apiError(503, "UNAVAILABLE", "We could not update your notifications. Please try again.");
  }
}
