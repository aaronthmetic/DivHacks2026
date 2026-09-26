# DivHacks2026
divhacks divhacks fahhhhh

## Stack

- [Next.js 16](https://nextjs.org/docs) (App Router, Turbopack), React 19, TypeScript
- [Tailwind CSS v4](https://tailwindcss.com/docs)
- [shadcn/ui](https://ui.shadcn.com/docs) components on [Base UI](https://base-ui.com) primitives, with [Lucide](https://lucide.dev/icons) icons

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

## Project layout

```
app/             routes, layouts, global styles (App Router)
components/ui/   shadcn/ui components
lib/utils.ts     cn() class-name helper
public/          static files served from /
```

## Environment variables

Put secrets in `.env.local`, which is git-ignored. Only variables prefixed with `NEXT_PUBLIC_` reach the browser.

## Authentication setup

Authentication uses Better Auth, the native MongoDB adapter, and database sessions. Start with Node.js 22.12+ (also required by the MongoDB test server).

1. Copy `.env.example` to `.env.local` and fill in the values. Generate `BETTER_AUTH_SECRET` with `openssl rand -base64 32`.
2. Use MongoDB Atlas or a local MongoDB **replica set**. Transactions keep users, credential accounts, and sessions consistent; a standalone MongoDB server is not supported. Set both `MONGODB_URI` and `MONGODB_DB`.
3. Run `npm run db:indexes`. The app also ensures indexes on its first database connection. The database user needs permission to create indexes. Existing duplicate identifiers cause setup to fail rather than silently accepting duplicates.
4. In Google Cloud Console, configure the OAuth consent screen and a **Web application** OAuth client. Add test users while the consent screen is in testing mode. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
5. Add `http://localhost:3000` as an authorized JavaScript origin and `http://localhost:3000/api/auth/callback/google` as the redirect URI. Add the corresponding HTTPS origin and callback for deployment; set `BETTER_AUTH_URL` to that origin. Production requires HTTPS.
6. Run `npm run dev`. Without Google credentials, password authentication still works and the Google button is hidden. No database or OAuth connection is required for a production build.

Deploy behind a trusted proxy that overwrites client IP headers (such as the hosting platform's standard proxy). Better Auth uses these headers for shared database-backed authentication rate limits; do not expose an origin that accepts arbitrary forwarded IPs from clients. All application instances must share the MongoDB database, auth secret, and public URL.

### Account behavior

- `/register`: first name, last name, email, phone number, and a 12–128 character password are required. Passwords are hashed by Better Auth. Email is trimmed and lowercased; phone numbers use E.164 with an explicit country selector (US initially selected).
- `/login`: email/password, phone/password, or Google OAuth. Email and phone are unique. Google accounts do not have passwords. Accounts are never automatically linked by matching email or phone.
- `/complete-profile`: first-time Google users confirm their imported names and enter a phone number. Both names and phone are required before protected application access. Returning Google logins preserve edited names.
- `/profile`: authenticated landing page with name editing, read-only email/phone, and logout. New protected server pages should use `requireSession()` from `lib/session.ts`; incomplete accounts are redirected to onboarding.
- Sessions expire after seven days and renew after a day of use. Logout deletes the current database session. Session data is not cached in client-readable cookies.
- Phone numbers are **unverified identifiers**, not proof of ownership. They are not used for recovery or linking. SMS, OTP login, email verification, password recovery, email/phone changes, adding passwords to Google accounts, and account linking are deferred and their auth endpoints are blocked.

### Profile API

Both endpoints require a valid session cookie, an `Origin` matching `BETTER_AUTH_URL`, and JSON. They update only the current user and allow at most 20 requests per minute per user.

| Endpoint | Body | Behavior |
| --- | --- | --- |
| `PATCH /api/profile` | `{ firstName, lastName }` | Requires a completed profile; derives display name server-side. |
| `POST /api/profile/complete` | `{ firstName, lastName, phoneNumber }` | Completes an incomplete profile once; phone must include `+` and country code. |

Success returns `{ success: true }`. Errors return `{ error: { code, message } }` with 400 (validation), 401 (missing session), 403 (origin/incomplete profile), 409 (conflict), 429 (rate limit), or 503 (unavailable). Verification flags, completion timestamps, and user IDs cannot be set by the client. The library's general `/update-user` endpoint is disabled so these restrictions also apply to direct API calls.

Indexes enforce unique email, populated phone number, provider/account identity, session token, and rate-limit key. Session and verification expiration indexes support cleanup; session expiry is checked by the auth library without waiting for cleanup. There is no existing-user migration.

### Verification

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Tests start an isolated, temporary MongoDB replica set and do not touch `.env.local` or your application database. The first run downloads a MongoDB binary and needs network access; subsequent runs use the cached binary. OAuth tests simulate Google's remote token/profile responses while exercising the real state, callback, session, and account flow.

For a live smoke test, register an account, log out, log in once with email and once with phone, edit names, and log out again. Then use a new Google account: confirm names, add a unique phone, and verify that later Google logins preserve name edits. Check that signing in through Google with an existing password account's email returns an error rather than linking accounts. Live Google testing requires your configured credentials and consent-screen test user.
