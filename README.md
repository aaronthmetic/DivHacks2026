# DivHacks2026
divhacks divhacks fahhhhh

## Stack

- [Next.js 16](https://nextjs.org/docs) (App Router, Turbopack), React 19, TypeScript
- [Tailwind CSS v4](https://tailwindcss.com/docs)
- [shadcn/ui](https://ui.shadcn.com/docs) components on [Base UI](https://base-ui.com) primitives, with [Lucide](https://lucide.dev/icons) icons
- [Google Maps](https://developers.google.com/maps/documentation/javascript) via [@vis.gl/react-google-maps](https://visgl.github.io/react-google-maps/)

## Getting started

Requires Node.js 20.9 or newer.

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

## Map

The map shows one card per zip code, with up to three cards fanned out when a zip has several services. Cards that would overlap merge into one stack ("2 areas"); click it to zoom in. Hovering a card or a zip's area highlights the area, and clicking selects it.

- `GOOGLE_MAPS_API_KEY`: your Maps JavaScript API key.
- `GOOGLE_MAPS_MAP_ID` (optional): sets the map style. To hide businesses and transit, create a map style in Google Cloud with points of interest and transit turned off, create a JavaScript Map ID under Map Management, attach the style to it, and put the ID here. Without it, the map uses Google's demo Map ID.
- Zip outlines come from NYC Open Data. After adding zip codes to `lib/xchg/data.ts`, run `node scripts/zip-boundaries.mjs <zip> [zip...]` to regenerate `lib/xchg/zip-boundaries.json`. It also prints each zip's official center point.

## Project layout

```
app/             routes, layouts, global styles (App Router)
app/api/dev/     dev-only API routes (Photon test endpoint)
components/ui/   shadcn/ui components
lib/             Photon client, relay pairing, cn() helper
public/          static files served from /
scripts/         standalone scripts (relay, zip boundaries)
```

## Environment variables

Put secrets in `.env.local`, which is git-ignored. `.env.example` lists the variables the app expects.

Only variables prefixed with `NEXT_PUBLIC_` are bundled for the browser automatically. The one exception here is `GOOGLE_MAPS_API_KEY`: the page hands it to the map, because Google's Maps JavaScript API runs in the browser. Restrict that key to your domains in Google Cloud.
