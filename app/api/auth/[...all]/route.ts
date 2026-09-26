import { getAuth } from "@/lib/auth";
import { handleAuthRequest } from "@/lib/auth-handler";
import { authUnavailable, logAuthFailure } from "@/lib/auth-errors";

export const runtime = "nodejs";

async function handler(request: Request) {
  try {
    return await handleAuthRequest(request, await getAuth());
  } catch (error) {
    logAuthFailure("Auth initialization", error);
    return authUnavailable(request);
  }
}

export { handler as GET, handler as POST };
