import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import { createAuth, googleProfile, type Auth } from "../lib/auth-config";
import { ensureAuthIndexes } from "../lib/auth-indexes";
import { handleAuthRequest } from "../lib/auth-handler";
import { updateProfile } from "../lib/profile-service";
import { isProfileComplete, normalizeEmail, normalizePhone, registration } from "../lib/auth-validation";

const origin = "http://localhost:3000";
const env = { baseURL: origin, secret: "test-secret-at-least-thirty-two-characters-long", googleClientId: "test-google-client", googleClientSecret: "test-google-secret" };
let server: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;
let auth: Auth;
let ip = 0;
let identity = 0;

before(async () => {
  server = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "8.0.5" } });
  client = await new MongoClient(server.getUri()).connect();
  db = client.db("auth_test");
  await ensureAuthIndexes(db);
  auth = createAuth(db, client, env);
});
after(async () => { await client?.close(); await server?.stop(); });

function account(overrides: Record<string, unknown> = {}) {
  identity++;
  return { firstName: "  Zoë ", lastName: " 王 ", name: "Do not trust this name", email: `person${identity}@example.com`, phoneNumber: `+1202555${String(1000 + identity)}`, password: "a good test password!", ...overrides };
}
function cookie(response: Response) {
  return response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
}
async function request(path: string, body?: unknown, cookies = "", instance = auth, address?: string) {
  return handleAuthRequest(new Request(`${origin}/api/auth${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { origin, "content-type": "application/json", cookie: cookies, "x-forwarded-for": address ?? `192.0.${Math.floor(++ip / 250)}.${ip % 250 + 1}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), instance);
}
async function register(overrides: Record<string, unknown> = {}) {
  const data = account(overrides);
  const response = await request("/sign-up/email", data);
  assert.equal(response.status, 200, await response.clone().text());
  return { data, cookie: cookie(response), user: (await response.json()).user };
}
function profileRequest(body: unknown, cookies = "", complete = false, requestOrigin = origin) {
  return new Request(`${origin}/api/profile${complete ? "/complete" : ""}`, { method: complete ? "POST" : "PATCH", headers: { origin: requestOrigin, cookie: cookies, "content-type": "application/json" }, body: JSON.stringify(body) });
}

test("validation accepts Unicode names and normalizes identifiers", () => {
  assert.equal(normalizeEmail(" Person@EXAMPLE.COM "), "person@example.com");
  assert.equal(normalizePhone("(202) 555-0123", "US"), "+12025550123");
  assert.equal(registration(account()).name, "Zoë 王");
  for (const overrides of [{ firstName: " " }, { lastName: "" }, { email: "broken" }, { phoneNumber: "123" }, { password: "short" }, { password: "x".repeat(129) }, { phoneNumberVerified: true }, { emailVerified: true }, { profileCompletedAt: new Date() }]) {
    assert.throws(() => registration(account(overrides)));
  }
});

test("registration stores a complete profile and hashed password; both identifiers log in", async () => {
  const registered = await register({ email: " MixedCase@example.com " });
  assert.equal(registered.user.email, "mixedcase@example.com");
  assert.equal(registered.user.name, "Zoë 王");
  assert.ok(isProfileComplete(registered.user));
  assert.equal(registered.user.phoneNumberVerified, false);
  assert.match(registered.cookie, /session_token=/);
  const record = await db.collection("user").findOne({ email: "mixedcase@example.com" });
  assert.equal(record?.password, undefined);
  const credential = await db.collection("account").findOne({ userId: record!._id });
  assert.ok(credential?.password);
  assert.notEqual(credential.password, registered.data.password);
  for (const [path, body] of [["/sign-in/email", { email: "MIXEDCASE@example.com", password: registered.data.password }], ["/sign-in/phone-number", { phoneNumber: registered.data.phoneNumber, password: registered.data.password }]] as const) {
    const result = await request(path, body);
    assert.equal(result.status, 200, await result.clone().text());
    assert.equal((await result.json()).user.id, registered.user.id);
  }
});

test("direct registration rejects omitted fields and forged server fields", async () => {
  for (const overrides of [{ firstName: "" }, { lastName: "" }, { phoneNumber: undefined }, { emailVerified: true }, { phoneNumberVerified: true }, { profileCompletedAt: "2026-01-01" }]) {
    const result = await request("/sign-up/email", account(overrides));
    assert.equal(result.status, 400, await result.clone().text());
  }
});

test("normalized duplicate email and phone are rejected; concurrent registration creates one account", async () => {
  const original = await register();
  for (const overrides of [{ email: original.data.email.toUpperCase() }, { phoneNumber: original.data.phoneNumber }]) {
    assert.equal((await request("/sign-up/email", account(overrides))).status, 409);
  }
  const data = account();
  const responses = await Promise.all([request("/sign-up/email", data), request("/sign-up/email", data)]);
  assert.equal(responses.filter((response) => response.ok).length, 1);
  assert.equal(await db.collection("user").countDocuments({ email: data.email }), 1);
  const user = await db.collection("user").findOne({ email: data.email });
  assert.equal(await db.collection("account").countDocuments({ userId: user!._id }), 1);
});

test("invalid credentials return the same generic error", async () => {
  const user = await register();
  const results = await Promise.all([
    request("/sign-in/email", { email: user.data.email, password: "incorrect password" }),
    request("/sign-in/phone-number", { phoneNumber: user.data.phoneNumber, password: "incorrect password" }),
    request("/sign-in/email", { email: "absent@example.com", password: "incorrect password" }),
  ]);
  for (const response of results) {
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, "INVALID_CREDENTIALS");
  }
});

test("sessions expire after seven days and logout revokes them", async () => {
  const user = await register();
  const session = await auth.api.getSession({ headers: new Headers({ cookie: user.cookie }) });
  assert.ok(session);
  assert.ok(Math.abs(new Date(session.session.expiresAt).getTime() - Date.now() - 7 * 86400000) < 10000);
  assert.equal((await request("/sign-out", {}, user.cookie)).status, 200);
  assert.equal(await auth.api.getSession({ headers: new Headers({ cookie: user.cookie }) }), null);
  const expired = await register();
  await db.collection("session").updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal(await auth.api.getSession({ headers: new Headers({ cookie: expired.cookie }) }), null);
});

test("profile edits are authenticated, same-origin, name-only, and scoped to the current user", async () => {
  const user = await register();
  const other = await register();
  const body = { firstName: "Updated", lastName: "Name" };
  assert.equal((await updateProfile(profileRequest(body), auth, db, origin, false)).status, 401);
  assert.equal((await updateProfile(profileRequest(body, user.cookie, false, "https://evil.example"), auth, db, origin, false)).status, 403);
  for (const extra of [{ phoneNumber: "+12025550000" }, { email: "changed@example.com" }, { profileCompletedAt: new Date() }, { userId: other.user.id }, { phoneNumberVerified: true }]) {
    assert.equal((await updateProfile(profileRequest({ ...body, ...extra }, user.cookie), auth, db, origin, false)).status, 400);
  }
  assert.equal((await updateProfile(profileRequest(body, user.cookie), auth, db, origin, false)).status, 200);
  const session = await auth.api.getSession({ headers: new Headers({ cookie: user.cookie }) });
  assert.equal(session?.user.name, "Updated Name");
  assert.equal((await db.collection("user").findOne({ email: other.data.email }))?.name, "Zoë 王");
  assert.equal((await request("/update-user", { name: "Bypass" }, user.cookie)).status, 403);
});

async function googleLogin(email: string, givenName = "Google", familyName = "Person") {
  // Stub only Google's remote token/profile boundary. Exercise real OAuth state,
  // callback, account creation, cookies, and MongoDB session persistence.
  const ctx = await auth.$context;
  const provider = ctx.socialProviders.find((provider) => provider.id === "google");
  assert.ok(provider);
  provider.validateAuthorizationCode = async () => ({ accessToken: "test-access-token" });
  provider.getUserInfo = async () => ({ user: { email, emailVerified: true, ...googleProfile({ given_name: givenName, family_name: familyName }) }, data: { sub: `google-${email}` } });
  const start = await request("/sign-in/social", { provider: "google" });
  assert.equal(start.status, 200, await start.clone().text());
  const url = new URL((await start.json()).url);
  return request(`/callback/google?state=${encodeURIComponent(url.searchParams.get("state")!)}&code=test-code`, undefined, cookie(start));
}

test("Google onboarding requires names and phone, completes once, and preserves edited names", async () => {
  const email = "google-new@example.com";
  const result = await googleLogin(email, "Google", "");
  assert.equal(result.status, 302, await result.clone().text());
  assert.match(result.headers.get("location")!, /complete-profile/);
  const cookies = cookie(result);
  let session = await auth.api.getSession({ headers: new Headers({ cookie: cookies }) });
  assert.ok(session);
  assert.equal(session.user.firstName, "Google");
  assert.equal(session.user.lastName, "");
  assert.equal(isProfileComplete(session.user), false);
  assert.equal((await updateProfile(profileRequest({ firstName: "A", lastName: "B" }, cookies), auth, db, origin, false)).status, 403);
  const body = { firstName: "Chosen", lastName: "Name", phoneNumber: "+12025550999" };
  assert.equal((await updateProfile(profileRequest({ ...body, lastName: "" }, cookies, true), auth, db, origin, true)).status, 400);
  assert.equal((await updateProfile(profileRequest(body, cookies, true), auth, db, origin, true)).status, 200);
  assert.equal((await updateProfile(profileRequest(body, cookies, true), auth, db, origin, true)).status, 409);
  session = await auth.api.getSession({ headers: new Headers({ cookie: cookies }) });
  assert.ok(session && isProfileComplete(session.user));
  assert.equal((await request("/sign-in/phone-number", { phoneNumber: body.phoneNumber, password: "not a password" })).status, 401);
  const returning = await googleLogin(email, "Original", "GoogleName");
  assert.equal(returning.status, 302);
  const updated = await auth.api.getSession({ headers: new Headers({ cookie: cookie(returning) }) });
  assert.equal(updated?.user.name, "Chosen Name");
});

test("Google cannot link by email or claim another account's phone", async () => {
  const existing = await register();
  const collision = await googleLogin(existing.data.email);
  assert.equal(collision.status, 302);
  assert.match(collision.headers.get("location")!, /error=/);
  const fresh = await googleLogin("google-conflict@example.com");
  const response = await updateProfile(profileRequest({ firstName: "A", lastName: "B", phoneNumber: existing.data.phoneNumber }, cookie(fresh), true), auth, db, origin, true);
  assert.equal(response.status, 409);
});

test("disabled auth endpoints and invalid OAuth state cannot create sessions", async () => {
  for (const [path, body] of [["/phone-number/send-otp", { phoneNumber: "+12025550123" }], ["/phone-number/verify", { phoneNumber: "+12025550123", code: "123456" }], ["/request-password-reset", { email: "person@example.com" }], ["/link-social", { provider: "google" }]] as const) {
    assert.equal((await request(path, body)).status, 403);
  }
  const invalid = await request("/callback/google?code=fake&state=invalid");
  assert.equal(invalid.status, 302);
  assert.doesNotMatch(cookie(invalid), /session_token=/);
});

test("database-backed rate limiting applies across auth instances", async () => {
  const second = createAuth(db, client, env);
  const address = "198.51.100.99";
  for (let attempt = 0; attempt < 10; attempt++) {
    const result = await request("/sign-in/phone-number", { phoneNumber: "+12025550888", password: "wrong-password" }, "", attempt % 2 ? second : auth, address);
    assert.equal(result.status, 401);
  }
  assert.equal((await request("/sign-in/phone-number", { phoneNumber: "+12025550888", password: "wrong-password" }, "", second, address)).status, 429);
});

test("profile changes have a shared per-user rate limit", async () => {
  const user = await register();
  const body = { firstName: "Rate", lastName: "Limit" };
  for (let attempt = 0; attempt < 20; attempt++) {
    assert.equal((await updateProfile(profileRequest(body, user.cookie), auth, db, origin, false)).status, 200);
  }
  assert.equal((await updateProfile(profileRequest(body, user.cookie), auth, db, origin, false)).status, 429);
});

test("cross-origin auth requests and external redirects are rejected", async () => {
  const crossOrigin = new Request(`${origin}/api/auth/sign-up/email`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify(account()) });
  assert.equal((await handleAuthRequest(crossOrigin, auth)).status, 403);
  const external = await request("/sign-in/social", { provider: "google", callbackURL: "https://evil.example" });
  // The auth library rejects untrusted origins before our fixed local redirects.
  if (external.ok) assert.equal(new URL((await external.json()).url).origin, "https://accounts.google.com");
  else assert.equal(external.status, 403);
  assert.equal((await request("/sign-in/social", { provider: "google", idToken: { token: "forged" } })).status, 400);
});

test("provider token failures redirect safely without a session", async () => {
  const ctx = await auth.$context;
  const provider = ctx.socialProviders.find((provider) => provider.id === "google")!;
  provider.validateAuthorizationCode = async () => { throw new Error("Simulated provider outage"); };
  const start = await request("/sign-in/social", { provider: "google" });
  const state = new URL((await start.json()).url).searchParams.get("state")!;
  const result = await request(`/callback/google?state=${encodeURIComponent(state)}&code=bad-code`, undefined, cookie(start));
  assert.equal(result.status, 302);
  const redirect = new URL(result.headers.get("location")!, origin);
  assert.equal(redirect.origin, origin);
  assert.equal(redirect.pathname, "/login");
  assert.equal(redirect.searchParams.get("error"), "invalid_code");
  assert.doesNotMatch(cookie(result), /session_token=/);
});

test("database failures return a safe retryable response", async () => {
  const failedClient = await new MongoClient(server.getUri()).connect();
  const failedDb = failedClient.db("auth_test");
  const failedAuth = createAuth(failedDb, failedClient, env);
  await failedAuth.$context;
  await failedClient.close();
  const result = await request("/sign-in/email", { email: "person@example.com", password: "test-password" }, "", failedAuth);
  assert.equal(result.status, 503);
  assert.equal((await result.json()).error.code, "UNAVAILABLE");
  const user = await register();
  assert.equal((await updateProfile(profileRequest({ firstName: "A", lastName: "B" }, user.cookie), auth, failedDb, origin, false)).status, 503);
});
