# PR #3 security assessment

Reviewed the 15 comments on PR #3 against the application and installed Better Auth 1.7.6 / Next.js 16.3.6 code. Ratings describe the original behavior, not evidence of exploitation. No production logs, cloud key restrictions, or proxy configuration were inspected.

| Comment | Security assessment | Resolution |
| --- | --- | --- |
| 1 — Native GET forms | **High:** plaintext passwords can enter history and request logs before hydration. Requires submitting the unhydrated form. | All auth/profile forms explicitly use POST; server-rendered markup has regression coverage. |
| 2 — Session renewal | **Low security / medium reliability:** database expiry outlives the browser cookie. Does not bypass authentication or prevent logout revocation. | Server reads disable refresh; visible clients renew through the cookie-writing session endpoint. Tested database and cookie renewal. |
| 3 — Silent configuration failures | **Medium availability:** bad environment settings disable authentication with little diagnostic evidence. Requiring HTTPS is a safeguard, not a vulnerability. | Safe configuration diagnostics and operation logs; documented HTTPS for production/local production previews. HTTPS enforcement retained. |
| 4 — Lockfile | **Release blocker**, not a demonstrated security vulnerability. | Regenerated lockfile; isolated clean install succeeds. |
| 5 — Marker image | **Low:** broken map display; no credential exposure or authorization bypass. | Uses the imported image URL and removes nonexistent gallery assets. |
| 6 — Error remapping | **Low:** hides origin/validation failures but does not bypass origin validation. | Only credential error codes become the generic credential response. |
| 7 — Proxy rate-limit bucket | **Medium, deployment-dependent:** shared buckets can cause site-wide login denial. Blindly trusting client headers would instead enable rate-limit evasion. | Configurable header names and trusted proxy CIDRs; tests cover separate clients and spoofed leading XFF. Actual ingress values and origin isolation remain deployment work. |
| 8 — OAuth body merge | **Medium hardening issue:** caller can broaden consent/scopes in their own flow; no demonstrated cross-user takeover. Plaintext tokens increase damage from a separate database compromise. | Provider-only allowlist and encryption of newly stored OAuth tokens; tested both. Existing plaintext tokens need migration or revocation separately. |
| 9 — Maps key setup | Missing variable is **low availability** risk. An unrestricted browser key is a separate **medium quota/billing** risk. Browser Maps keys are necessarily public. | Documented key and required referrer/API restrictions; explicit service allowlist. Cloud restrictions cannot be applied locally. |
| 10 — Duplicate submissions | **Low:** duplicate sessions or confusing errors, not an auth bypass. | Keep forms busy through successful navigation; allow retries on failure. |
| 11 — Null bodies | **Low:** unauthenticated clients can trigger server errors/log noise; no demonstrated data access. | Validate object bodies before field access; malformed bodies return 400. |
| 12 — Duplicate Maps loading | **Low:** primarily development correctness/resource use. | Shared script-load promise and cancelled-effect guard. |
| 13 — OAuth failure UI | **Low:** poor recovery, not acceptance of invalid state. | State failures return to login; callback server errors use a fixed relative redirect. |
| 14 — Phone whitespace | **Low:** input usability only. | Trim input and distinguish invalid numbers from extensions. |
| 15 — Profile rate limit | **Low:** bounded bursts by an already authenticated user editing their own profile. | Atomic, bounded sliding window; tested concurrency, minute boundaries, and recovery. |

Deployment follow-up:

- Set the trusted ingress headers/proxy CIDRs and verify the origin cannot be reached around that ingress. Do not use arbitrary broad trusted ranges.
- Apply website referrer and Maps JavaScript API restrictions to the browser Maps key in Google Cloud.
- If OAuth accounts already exist, migrate or revoke existing plaintext tokens; enabling encryption only protects subsequent writes. Preserve the authentication secret.
- If the vulnerable forms were previously used in a live deployment, investigate credential-bearing URLs in access logs/history and handle any confirmed exposure. This review did not establish that exposure occurred.

Follow-up (PR #4 review): the home page now renders the XCHG explorer, whose map loads through `@vis.gl/react-google-maps` with the key passed from the server page. The `GoogleMap` component and `/api/api-key` route that comments 5, 9 and 12 refer to were removed as unused.

Validation: 24 regression tests (including MongoDB-backed auth/OAuth flows), TypeScript, ESLint, and a Webpack production build. An isolated `npm ci --ignore-scripts` confirms lockfile consistency. The default Turbopack build could not complete in this environment because its CSS worker failed to bind a local port, including on an elevated retry. Live Google consent and Maps rendering were not browser-tested.

References: [PR review](https://github.com/aaronthmetic/DivHacks2026/pull/3#pullrequestreview-5326928249), [Better Auth sessions](https://better-auth.com/docs/concepts/session-management), [Better Auth rate limiting](https://better-auth.com/docs/concepts/rate-limit), [Google Maps key restrictions](https://developers.google.com/maps/api-security-best-practices).
