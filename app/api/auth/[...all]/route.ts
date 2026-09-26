import { getAuth } from "@/lib/auth";
import { handleAuthRequest } from "@/lib/auth-handler";
import { apiError } from "@/lib/profile-service";

export const runtime = "nodejs";

async function handler(request: Request) {
  try {
    return await handleAuthRequest(request, await getAuth());
  } catch {
    return apiError(503, "UNAVAILABLE", "Authentication is temporarily unavailable. Please try again.");
  }
}

export { handler as GET, handler as POST };
