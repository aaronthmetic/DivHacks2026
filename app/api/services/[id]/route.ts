import { getAuth } from "@/lib/auth";
import { getMongo } from "@/lib/mongodb";
import { modifyListing } from "@/lib/listing-service";
import { apiError } from "@/lib/profile-service";
import { logAuthFailure } from "@/lib/auth-errors";

export const runtime = "nodejs";
async function modify(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await getAuth();
    const { db } = await getMongo();
    return await modifyListing(request, id, auth, db, new URL(process.env.BETTER_AUTH_URL!).origin);
  } catch (error) {
    logAuthFailure("Listing initialization", error);
    return apiError(503, "UNAVAILABLE", "We could not change your listing. Please try again.");
  }
}
export { modify as PATCH, modify as DELETE };
