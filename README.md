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

**B2 (done): player actions** — `POST /clubs/:slug/join`, `POST /clubs/:slug/tournaments/:tslug/register`,
`PUT /profiles/me`, `PUT /profiles/me/primary-club`, `POST /profiles/me/photo` (multipart `file`),
`POST|DELETE /follows/:playerId`, `POST /friendships`, `POST /friendships/:id/respond`, `DELETE /friendships/:id`,
`POST /clubs/:slug/bookings`, `POST /clubs/:slug/bookings/:id/cancel`.

**B3 (done): friendlies & live scoring** — `POST /friendlies`, `POST /friendlies/:id/{respond,cancel,start,confirm,dispute}`,
`PATCH /matches/:id/{status,live,progress}`, `POST /matches/:id/{finish,result}`. Live updates: the website’s
actions broadcast on Supabase Realtime (`live:match:<id>`, `live:club:<clubId>`); the app listens there
directly with the public key (the signals carry no data).

**B4 (done): staff** — tables board (`GET /clubs/:slug/table-overview`, `table-summary`, `table-sessions/outstanding`,
`table-players/search`), `POST|PUT /clubs/:slug/tables[/:id]`, `POST /tables/:id/start`, `/table-sessions/:id/{stop,settle}`,
`/table-charges/:id/pay`, `/bookings/:id/{respond,no-show}`, dues (`GET /dues`, `POST /dues/{collect,remind}`),
`GET /reports/income`, `GET /registrations`, `PATCH /registrations/:id/payment-status`, tournaments
(`POST /clubs/:slug/tournaments`, `PATCH|DELETE …/:tslug`, `POST …/thumbnail`, scorekeepers), fixtures
(`PUT /clubs/:slug/matches/tournaments/:id/fixtures` — saving fixtures releases the draw, as on the website),
gallery, `PATCH /clubs/:slug`, `POST /clubs/:slug/{logo,cover}`, TV screens and stream settings.

**B5 (done): opening a club & platform admin** — `POST /clubs` (the website’s Create Your Club: a pending club
with you as its admin), `POST /platform/clubs/:id/{approve,reject}`, `GET /platform/clubs/:id/owner`.
The website has no club-enquiry step, so `/club-enquiries` and `/platform/club-enquiries` return empty lists and
the app sends “Create your club” straight to the club form.

Privacy: other players' profiles never include email, mobile, date of birth or emergency contact.
