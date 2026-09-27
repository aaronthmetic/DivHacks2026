import { getAuth } from "@/lib/auth";
import { getMongo } from "@/lib/mongodb";
import { createListing } from "@/lib/listing-service";
import { apiError } from "@/lib/profile-service";
import { logAuthFailure } from "@/lib/auth-errors";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const auth = await getAuth();
    const { db, client } = await getMongo();
    return await createListing(request, auth, db, client, new URL(process.env.BETTER_AUTH_URL!).origin);
  } catch (error) {
    logAuthFailure("Listing initialization", error);
    return apiError(503, "UNAVAILABLE", "We could not publish your listing. Please try again.");
  }
}
