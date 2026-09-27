import { getAuth } from "@/lib/auth";
import { getMongo } from "@/lib/mongodb";
import { updateBooking } from "@/lib/booking-actions";
import { apiError } from "@/lib/profile-service";
import { logAuthFailure } from "@/lib/auth-errors";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await getAuth();
    const { db, client } = await getMongo();
    return await updateBooking(request, id, auth, db, client, new URL(process.env.BETTER_AUTH_URL!).origin);
  } catch (error) {
    logAuthFailure("Booking initialization", error);
    return apiError(503, "UNAVAILABLE", "We could not update this booking. Please try again.");
  }
}
