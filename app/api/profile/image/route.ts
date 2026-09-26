import { getAuth } from "@/lib/auth";
import { getMongo } from "@/lib/mongodb";
import { updateProfileImage } from "@/lib/profile-image";
import { apiError } from "@/lib/profile-service";
import { logAuthFailure } from "@/lib/auth-errors";
export const runtime = "nodejs";
async function handle(request: Request) {
  try {
    const auth = await getAuth();
    const { db } = await getMongo();
    return await updateProfileImage(request, auth, db, new URL(process.env.BETTER_AUTH_URL!).origin);
  } catch (error) {
    logAuthFailure("Profile image initialization", error);
    return apiError(503, "UNAVAILABLE", "We could not save your photo. Please try again.");
  }
}
export const POST = handle;
export const DELETE = handle;
