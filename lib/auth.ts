import "server-only";
import { AuthConfigurationError } from "./auth-errors";
import { createAuth, type Auth } from "./auth-config";
import { getMongo } from "./mongodb";

let authPromise: Promise<Auth> | undefined;
export function getAuth() {
  if (!authPromise) {
    authPromise = (async () => {
      const baseURL = process.env.BETTER_AUTH_URL;
      const secret = process.env.BETTER_AUTH_SECRET;
      if (!baseURL || !secret || secret.length < 32) throw new AuthConfigurationError("Set BETTER_AUTH_URL and a BETTER_AUTH_SECRET of at least 32 characters.");
      if (process.env.NODE_ENV === "production" && new URL(baseURL).protocol !== "https:") throw new AuthConfigurationError("Production authentication requires an HTTPS BETTER_AUTH_URL, including when using npm run start locally.");
      const { db, client } = await getMongo();
      return createAuth(db, client, { baseURL, secret, ipAddressHeaders: process.env.AUTH_IP_ADDRESS_HEADERS?.split(",").map((value) => value.trim()).filter(Boolean), trustedProxies: process.env.AUTH_TRUSTED_PROXIES?.split(",").map((value) => value.trim()).filter(Boolean), googleClientId: process.env.GOOGLE_CLIENT_ID, googleClientSecret: process.env.GOOGLE_CLIENT_SECRET });
    })().catch((error) => { authPromise = undefined; throw error; });
  }
  return authPromise;
}

export function googleEnabled() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}
