import "server-only";
import { createAuth, type Auth } from "./auth-config";
import { getMongo } from "./mongodb";

let authPromise: Promise<Auth> | undefined;
export function getAuth() {
  if (!authPromise) {
    authPromise = (async () => {
      const baseURL = process.env.BETTER_AUTH_URL;
      const secret = process.env.BETTER_AUTH_SECRET;
      if (!baseURL || !secret || secret.length < 32) throw new Error("Authentication is not configured.");
      if (process.env.NODE_ENV === "production" && new URL(baseURL).protocol !== "https:") throw new Error("Production authentication requires HTTPS.");
      const { db, client } = await getMongo();
      return createAuth(db, client, { baseURL, secret, googleClientId: process.env.GOOGLE_CLIENT_ID, googleClientSecret: process.env.GOOGLE_CLIENT_SECRET });
    })().catch((error) => { authPromise = undefined; throw error; });
  }
  return authPromise;
}

export function googleEnabled() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}
