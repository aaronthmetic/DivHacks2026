import { logAuthFailure } from "@/lib/auth-errors";
import { getAuth } from "@/lib/auth";
import { getMongo } from "@/lib/mongodb";
import { photonConfigured, registerPhotonUser } from "@/lib/photon-users";
import { apiError, updateProfile } from "@/lib/profile-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const auth = await getAuth();
    const { db } = await getMongo();
    return await updateProfile(request, auth, db, new URL(process.env.BETTER_AUTH_URL!).origin, true, photonConfigured() ? registerPhotonUser : undefined);
  } catch (error) {
    logAuthFailure("Profile initialization", error);
    return apiError(503, "UNAVAILABLE", "We could not save your profile. Please try again.");
  }
}
