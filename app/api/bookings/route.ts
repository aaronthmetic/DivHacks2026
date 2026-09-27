import { logAuthFailure } from "@/lib/auth-errors";
import { getAuth } from "@/lib/auth";
import { createBookingRequest } from "@/lib/booking-requests";
import { getMongo } from "@/lib/mongodb";
import { photonMessenger } from "@/lib/photon-messenger";
import { apiError } from "@/lib/profile-service";
import { loggingMessenger } from "@/lib/text-log";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const auth = await getAuth();
    const { db, client } = await getMongo();
    return await createBookingRequest(request, auth, db, client, new URL(process.env.BETTER_AUTH_URL!).origin, loggingMessenger(db, photonMessenger));
  } catch (error) {
    logAuthFailure("Booking request initialization", error);
    return apiError(503, "UNAVAILABLE", "We could not send your request. Please try again.");
  }
}
