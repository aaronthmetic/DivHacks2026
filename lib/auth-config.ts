import { ObjectId } from "mongodb";
import { createExchangeService } from "./exchange-service";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { phoneNumber } from "better-auth/plugins";
import type { Db, MongoClient } from "mongodb";
import { conflictMessage, InputError, normalizeEmail, normalizePhone, objectBody, onlyFields, registration } from "./auth-validation";

export type AuthEnvironment = {
  baseURL: string;
  secret: string;
  ipAddressHeaders?: string[];
  trustedProxies?: string[];
  googleClientId?: string;
  googleClientSecret?: string;
};

export function googleProfile(profile: { given_name?: string; family_name?: string }) {
  const firstName = profile.given_name?.trim().slice(0, 100) ?? "";
  const lastName = profile.family_name?.trim().slice(0, 100) ?? "";
  return { firstName, lastName, name: `${firstName} ${lastName}`.trim(), profileCompletedAt: null };
}

export function createAuth(db: Db, client: MongoClient, env: AuthEnvironment) {
  return betterAuth({
    appName: "DivHacks 2026",
    baseURL: env.baseURL,
    secret: env.secret,
    trustedOrigins: [new URL(env.baseURL).origin],
    database: mongodbAdapter(db, { client, transaction: true }),
    emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128 },
    socialProviders: env.googleClientId && env.googleClientSecret ? {
      google: {
        clientId: env.googleClientId,
        clientSecret: env.googleClientSecret,
        overrideUserInfoOnSignIn: false,
        mapProfileToUser: googleProfile,
      },
    } : {},
    account: { accountLinking: { enabled: false }, encryptOAuthTokens: true },
    onAPIError: { errorURL: "/login" },
    advanced: { ipAddress: { ipAddressHeaders: env.ipAddressHeaders ?? ["x-forwarded-for"], trustedProxies: env.trustedProxies } },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    user: {
      additionalFields: {
        rating: { type: "number", required: false, input: false, defaultValue: 0 },
        numberOfReviews: { type: "number", required: false, input: false, defaultValue: 0 },
        reviews: { type: "string[]", required: false, input: false, defaultValue: [] },
        bio: { type: "string", required: false, input: false },
        zipCode: { type: "string", required: false, input: false },
        countryCode: { type: "string", required: false, input: false },
        firstName: { type: "string", required: false },
        lastName: { type: "string", required: false },
        profileCompletedAt: { type: "date", required: false, input: false },
      },
    },
    plugins: [phoneNumber({ requireVerification: false, sendOTP: () => { throw new Error("Phone verification is not enabled."); } })],
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-in/phone-number": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 5 },
        "/sign-in/social": { window: 60, max: 10 },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const allowed = ["/sign-up/email", "/sign-in/email", "/sign-in/phone-number", "/sign-in/social", "/get-session", "/sign-out", "/callback/google", "/error"];
        const googleCallback = ctx.path === "/callback/:id" && ctx.params?.id === "google";
        if (!allowed.includes(ctx.path) && !googleCallback) {
          throw new APIError("FORBIDDEN", { message: "This account operation is not enabled." });
        }
        try {
          if (["/sign-up/email", "/sign-in/email", "/sign-in/phone-number", "/sign-in/social"].includes(ctx.path)) {
            ctx.body = objectBody(ctx.body);
          }
          if (ctx.path === "/sign-up/email") {
            const data = registration(ctx.body);
            const existing = await db.collection("user").findOne({ $or: [{ email: data.email }, { phoneNumber: data.phoneNumber }] });
            if (existing) throw new APIError("CONFLICT", { message: conflictMessage });
            return { context: { ...ctx, body: { ...data, callbackURL: "/" } } };
          }
          if (ctx.path === "/sign-in/email") {
            return { context: { ...ctx, body: { ...ctx.body, email: normalizeEmail(ctx.body.email), callbackURL: "/", rememberMe: true } } };
          }
          if (ctx.path === "/sign-in/phone-number") {
            return { context: { ...ctx, body: { ...ctx.body, phoneNumber: normalizePhone(ctx.body.phoneNumber), rememberMe: true } } };
          }
          if (ctx.path === "/sign-in/social") {
            // Only the OAuth authorization-code flow is exposed, with fixed local redirects.
            onlyFields(ctx.body, ["provider"]);
            if (ctx.body.provider !== "google") {
              throw new InputError("Use the Google sign-in button to continue.");
            }
            return { context: { ...ctx, body: { provider: "google", callbackURL: "/", newUserCallbackURL: "/complete-profile", errorCallbackURL: "/login" } } };
          }
        } catch (error) {
          if (error instanceof InputError) throw new APIError("BAD_REQUEST", { message: error.message });
          throw error;
        }
      }),
    },
    databaseHooks: {
      session: { create: { after: async (session) => {
        const record = await db.collection("user").findOne({ _id: new ObjectId(session.userId) });
        if (record?.profileCompletedAt) await createExchangeService(db, client).grantWelcome(new ObjectId(session.userId));
      } } },
      user: {
        create: {
          after: async (user) => {
            const record = await db.collection("user").findOne({ _id: new ObjectId(user.id) });
            if (record?.profileCompletedAt) await createExchangeService(db, client).grantWelcome(new ObjectId(user.id));
          },
          before: async (user, ctx) => {
            if (ctx?.path === "/sign-up/email") {
              const { password: _password, ...data } = registration(ctx.body);
              void _password;
              return { data: { ...user, ...data, emailVerified: false, phoneNumberVerified: false, profileCompletedAt: new Date() } };
            }
            return { data: { ...user, email: normalizeEmail(user.email), phoneNumberVerified: false, profileCompletedAt: null } };
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
