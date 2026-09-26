# DivHacks2026
divhacks divhacks fahhhhh

## Stack

- [Next.js 16](https://nextjs.org/docs) (App Router, Turbopack), React 19, TypeScript
- [Tailwind CSS v4](https://tailwindcss.com/docs)
- [shadcn/ui](https://ui.shadcn.com/docs) components on [Base UI](https://base-ui.com) primitives, with [Lucide](https://lucide.dev/icons) icons
- [Google Maps](https://developers.google.com/maps/documentation/javascript) via [@vis.gl/react-google-maps](https://visgl.github.io/react-google-maps/)

## Getting started

Requires Node.js 22.12 or newer.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Edit `app/page.tsx` and the page hot-reloads.

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on port 3000 |
| `npm run build` | Production build (also type-checks) |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |

## Adding UI components

```bash
npx shadcn add card dialog input
```

Components are copied into `components/ui/`, so you can edit them freely. Browse the catalog at [ui.shadcn.com](https://ui.shadcn.com/docs/components).

They're built on Base UI, not Radix. Where older shadcn examples use `asChild`, use the `render` prop instead:

```tsx
<Button render={<Link href="/about" />} nativeButton={false}>About</Button>
```

## Photon (iMessage)

`lib/photon.ts` wraps Photon's [Spectrum SDK](https://photon.codes/docs/spectrum-ts/introduction): `sendDirectMessage()` texts one person, and `createGroupChat()` starts a group with two people.

1. Fill in `SPECTRUM_PROJECT_ID` and `SPECTRUM_PROJECT_SECRET` in `.env.local` (copy `.env.example` if you don't have one). They're in your project's Settings at [app.photon.codes](https://app.photon.codes).
2. On Free or Pro (shared Photon numbers), each person you text must first:
   - be added under **Users** in your Photon project, in `+15551234567` format, and
   - text their assigned Photon number once. Until they do, sends fail with "Target not allowed for this project". To find the assigned number, run `npx -y @photon-ai/cli@latest login`, then `npx -y @photon-ai/cli@latest spectrum users list -p <project-id>`, and check `assignedPhoneNumber`.
3. With `npm run dev` running, send yourself a DM:

   ```bash
   curl -X POST localhost:3000/api/dev/photon \
     -H 'Content-Type: application/json' \
     -d '{"phones": ["+15551234567"], "text": "hello from DivHacks"}'
   ```

   Put two numbers in `phones` to create a group chat instead.

Group chats need a dedicated Photon line (Business plan). On Free or Pro, a group request returns a 403 that says so. `/api/dev/photon` only works in development and returns 404 in production.

## Relay (two-way messaging test)

`npm run relay` passes texts between two people through Photon. Whatever one person texts their Photon number arrives for the other as "Name: message".

1. Set `RELAY_A_PHONE`, `RELAY_A_NAME`, `RELAY_B_PHONE` and `RELAY_B_NAME` in `.env.local`. Both people need the Photon setup above: added as users, and each has texted their assigned number once.
2. Run `npm run relay`. Add `-- --intro` to first text each person who they're connected with.
3. Text your Photon number. Ctrl+C stops the relay.

Only text is passed along. For photos and other content, the other person gets a short note instead.

## Project layout

```
app/             routes, layouts, global styles (App Router)
app/api/dev/     dev-only API routes (Photon test endpoint)
components/ui/   shadcn/ui components
lib/             Photon client, relay pairing, cn() helper
public/          static files served from /
scripts/         standalone scripts (npm run relay)
```

## Environment variables

Put secrets in `.env.local`, which is git-ignored. Variables prefixed with `NEXT_PUBLIC_` are bundled for the browser. The Maps key is also explicitly sent to the browser by the home page and its API route; it is not a server secret.

## Authentication setup

Authentication uses Better Auth, the native MongoDB adapter, and database sessions. Start with Node.js 22.12+ (also required by the MongoDB test server).

1. Copy `.env.example` to `.env.local` and fill in the values. Generate `BETTER_AUTH_SECRET` with `openssl rand -base64 32`.
2. Use MongoDB Atlas or a local MongoDB **replica set**. Transactions keep users, credential accounts, and sessions consistent; a standalone MongoDB server is not supported. Set both `MONGODB_URI` and `MONGODB_DB`.
3. Run `npm run db:indexes`. The app also ensures indexes on its first database connection. The database user needs permission to create indexes. Existing duplicate identifiers cause setup to fail rather than silently accepting duplicates.
4. In Google Cloud Console, configure the OAuth consent screen and a **Web application** OAuth client. Add test users while the consent screen is in testing mode. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
5. Add `http://localhost:3000` as an authorized JavaScript origin and `http://localhost:3000/api/auth/callback/google` as the redirect URI. Add the corresponding HTTPS origin and callback for deployment; set `BETTER_AUTH_URL` to that origin. Production requires HTTPS.
6. Run `npm run dev`. Without Google credentials, password authentication still works and the Google button is hidden. No database or OAuth connection is required for a production build.

`npm run start` runs in production mode and requires an HTTPS `BETTER_AUTH_URL`, even locally. Use `npm run dev` for HTTP localhost, or terminate HTTPS at a local reverse proxy. Keep the browser origin, OAuth redirect URI, and `BETTER_AUTH_URL` consistent (including the port); origin mismatches are rejected.

Set `GOOGLE_MAPS_API_KEY` for the home-page map. In Google Cloud, restrict this browser key to your website HTTP referrers and the Maps JavaScript API, and set quotas. Never reuse a server API key for this endpoint. Advanced markers also require a JavaScript map ID: set `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` for deployment (the component uses Google’s `DEMO_MAP_ID` when unset). Restart the dev server after changing environment variables.

Deploy behind a trusted proxy that overwrites client IP headers (such as the hosting platform's standard proxy). Better Auth uses these headers for shared database-backed authentication rate limits; do not expose an origin that accepts arbitrary forwarded IPs from clients. Set `AUTH_IP_ADDRESS_HEADERS` to the header(s) your ingress overwrites (default `x-forwarded-for`). For a multi-hop forwarded chain, set `AUTH_TRUSTED_PROXIES` to the actual proxy IPs/CIDRs; the library walks the chain from right to left. Do not trust all addresses or choose a header clients can supply. Without trusted proxy configuration, multi-hop chains share a fallback rate-limit bucket: verify distinct client IPs produce distinct buckets in staging. These values depend on your deployment and cannot be guessed safely.

All application instances must share the MongoDB database, auth secret, and public URL.

### Account behavior

- `/register`: first name, last name, email, phone number, and a 12–128 character password are required. Passwords are hashed by Better Auth. Email is trimmed and lowercased; phone numbers use E.164 with an explicit country selector (US initially selected).
- `/login`: email/password, phone/password, or Google OAuth. Email and phone are unique. Google accounts do not have passwords. Accounts are never automatically linked by matching email or phone.
- `/complete-profile`: first-time Google users confirm their imported names and enter a phone number. Both names and phone are required before protected application access. Returning Google logins preserve edited names.
- `/`: authenticated service explorer; signed-out visitors are redirected to `/login`. Successful login and completed onboarding return here.
- `/profile`: authenticated account page with name editing, read-only email/phone, and logout. New protected server pages should use `requireSession()` from `lib/session.ts`; incomplete accounts are redirected to onboarding.
- Sessions expire after seven days and renew after a day of use via a browser session request on navigation, focus, and every five visible minutes. Server-only session reads do not extend expiry. Logout deletes the current database session. Session data is not cached in client-readable cookies.
- Phone numbers are **unverified identifiers**, not proof of ownership. They are not used for recovery or linking. SMS, OTP login, email verification, password recovery, email/phone changes, adding passwords to Google accounts, and account linking are deferred and their auth endpoints are blocked.

### Profile API

Both endpoints require a valid session cookie, an `Origin` matching `BETTER_AUTH_URL`, and JSON. They update only the current user and allow at most 20 requests per minute per user.

| Endpoint | Body | Behavior |
| --- | --- | --- |
| `PATCH /api/profile` | `{ firstName, lastName }` | Requires a completed profile; derives display name server-side. |
| `POST /api/profile/complete` | `{ firstName, lastName, phoneNumber }` | Completes an incomplete profile once; phone must include `+` and country code. |

Success returns `{ success: true }`. Errors return `{ error: { code, message } }` with 400 (validation), 401 (missing session), 403 (origin/incomplete profile), 409 (conflict), 429 (rate limit), or 503 (unavailable). Verification flags, completion timestamps, and user IDs cannot be set by the client. The library's general `/update-user` endpoint is disabled so these restrictions also apply to direct API calls.

Indexes enforce unique email, populated phone number, provider/account identity, session token, and rate-limit key. Session and verification expiration indexes support cleanup; session expiry is checked by the auth library without waiting for cleanup. New OAuth tokens are encrypted with the auth secret. Existing plaintext OAuth tokens are not retroactively encrypted; before deploying over an existing installation, inventory and migrate those tokens or revoke them and require a fresh Google login. Keep the auth secret stable and backed up. There is no existing-user migration.

### Verification

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Tests start an isolated, temporary MongoDB replica set and do not touch `.env.local` or your application database. The first run downloads a MongoDB binary and needs network access; subsequent runs use the cached binary. OAuth tests simulate Google's remote token/profile responses while exercising the real state, callback, session, and account flow.

For a live smoke test, register an account, log out, log in once with email and once with phone, edit names, and log out again. Then use a new Google account: confirm names, add a unique phone, and verify that later Google logins preserve name edits. Check that signing in through Google with an existing password account's email returns an error rather than linking accounts. Live Google testing requires your configured credentials and consent-screen test user.
