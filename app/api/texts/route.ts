import { logAuthFailure } from "@/lib/auth-errors";
import { getAuth } from "@/lib/auth";
import { getMongo } from "@/lib/mongodb";
import { photonConfigured, registerPhotonUser } from "@/lib/photon-users";
import { apiError } from "@/lib/profile-service";
import { turnOnTexts } from "@/lib/texts-setup";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const auth = await getAuth();
    const { db } = await getMongo();
    return await turnOnTexts(request, auth, db, new URL(process.env.BETTER_AUTH_URL!).origin, photonConfigured() ? registerPhotonUser : undefined);
  } catch (error) {
    logAuthFailure("Texts initialization", error);
    return apiError(503, "UNAVAILABLE", "We couldn't reach our texting service. Please try again.");
  }
}
