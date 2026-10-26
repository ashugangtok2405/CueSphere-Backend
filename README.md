# CueSphere Backend

The API the CueSphere mobile app (`../CueSphere-App (Mohit)`) talks to, at `/api/v1`.

It is **the website's backend, served to the app**: same Supabase project (same database,
same accounts — log in on the app with your website login), and it runs the website's own
code from `../snooker/src` — its services (`services/*.ts`) and server actions
(`app/actions/*.ts`) — so business rules, validation and error messages live in one place.

## Run

```bash
npm install
npm run dev        # http://localhost:5100/api/v1  (also on your LAN IP for a phone)
```

Needs `../snooker` checked out with its `node_modules` and `.env.local` — the Supabase
URL and keys are read from there (`NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`). Put backend-only settings
(e.g. `PORT=5100`) in a local `.env`.

In the app, set `EXPO_PUBLIC_API_URL=http://<your computer's LAN IP>:5100` and restart Expo.
If a phone can't reach it, allow Node through Windows Firewall for private networks.

## How the website's code runs here

The website's code expects a Next.js request around it. `tsconfig.json` maps `@/*` to
`src/shims/*` first and `../snooker/src/*` second, so a handful of Next-only modules are
replaced and everything else is the website's file:

| Website module | Here |
|---|---|
| `@/lib/supabase/server` | Supabase client authenticated with the caller's Bearer token (RLS applies as on the website) |
| `@/lib/auth/session` | `getSession()` from that token |
| `next/cache` | `revalidatePath` is a no-op (the website's pages read fresh data) |
| `next/server` | `after()` runs once the reply is sent (live signals, push notifications) |
| `next/headers`, `next/navigation` | minimal stand-ins |

Each request runs in an `AsyncLocalStorage` context (`src/context.ts`) holding the token,
the verified user, sign-in session storage and `after()` work.

## Responses

`{ success: true, data }`, or `{ success: false, message }` with a 4xx/5xx status. A website
action's `{ success: false, error }` becomes `message` unchanged — those are user-facing.

## Endpoints

Built in phases. **B1 (done): log in and browse.**

- Auth: `POST /auth/signin`, `/auth/signup`, `/auth/refresh`, `/auth/signout`, `GET /viewer`
- Clubs: `GET /clubs`, `/clubs/:slug`, `/viewer/clubs/:slug`, `/clubs/:slug/{gallery,table-status,tables}`, `/boards/:slug`, `/clubs/memberships/by-user/:userId`, `/club-enquiries/me`
- Your things at a club: `GET /clubs/:slug/my/{dues,dues/total,bookings}`, `/clubs/:slug/registrations/mine`
- Tournaments: `GET /tournaments`, `/clubs/:slug/tournaments[/:tslug[/registrations|/eligibility|/friends-registered]]`, `/matches/tournaments/:id`, `/matches/tournaments/results`
- Players: `GET /profiles`, `/profiles/me`, `/profiles/:id`, `/profiles/batch`, `/stats/players/:id[/ranks]`, `/stats/rankings`
- Social: `GET /follows`, `/follows/:playerId`, `/friendships`, `/friendships/friend-ids`, `/friendlies/mine`, `/friendlies/players/search`, `/friendlies/players/:id/stats`
- Matches: `GET /matches/:id`, `/matches/open`, `/matches/:id/{head-to-head,friendly-stats}`, `/clubs/:slug/matches/{live,scorable}`
- Photos: `GET /api/player-photo/:playerId/:version` (same address as the website)

Next: **B2** player actions (join, register, profile & photo, follow, friends, bookings) ·
**B3** friendlies, live scoring, live updates · **B4** staff (tables & billing, dues, income,
tournaments, fixtures, gallery, settings, TV & stream) · **B5** platform admin.

Privacy: other players' profiles never include email, mobile, date of birth or emergency contact.
