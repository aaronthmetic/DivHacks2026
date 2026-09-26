# DivHacks2026
divhacks divhacks fahhhhh

## Stack

- [Next.js 16](https://nextjs.org/docs) (App Router, Turbopack), React 19, TypeScript
- [Tailwind CSS v4](https://tailwindcss.com/docs)
- [shadcn/ui](https://ui.shadcn.com/docs) components on [Base UI](https://base-ui.com) primitives, with [Lucide](https://lucide.dev/icons) icons

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

## Project layout

```
app/             routes, layouts, global styles (App Router)
components/ui/   shadcn/ui components
lib/utils.ts     cn() class-name helper
public/          static files served from /
```

## Environment variables

Put secrets in `.env.local`, which is git-ignored. Only variables prefixed with `NEXT_PUBLIC_` reach the browser.
