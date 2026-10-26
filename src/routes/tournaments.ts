import { Hono } from 'hono';

import { getClubViewer } from '@/lib/auth/get-club-viewer';
import { getSession } from '@/lib/auth/session';
import { computeTournamentResults, type TournamentResults } from '@/lib/tournament-results';
import { getClubById, listClubs } from '@/services/club-service';
import { countRegisteredForClubTournament, getClubTournamentById, getClubTournamentBySlug, listClubTournaments } from '@/services/club-tournament-service';
import { countFriendsRegistered, listFriendUserIds } from '@/services/friendship-service';
import { getMatchesForTournament, isDrawReleased } from '@/services/match-service';
import { getProfileById } from '@/services/profile-service';
import { getRegistrationForPlayer, getRegistrationsForPlayer, getRegistrationsForTournament } from '@/services/registration-service';
import type { Club } from '@/types/club';
import type { ClubTournament } from '@/types/club-tournament';

import { HttpError, ok, requireUser } from '../http';
import { clubBySlug, idList, myProfile, requireProfile, tournamentOf } from '../lookups';

export const tournaments = new Hono();

/** A tournament as the app lists it: registered count, whether you're in, its club. */
async function forList(t: ClubTournament, club: Club | undefined, profileId: string | null) {
  const [registeredCount, mine] = await Promise.all([
    countRegisteredForClubTournament(t.id),
    profileId ? getRegistrationForPlayer(t.id, profileId) : Promise.resolve(undefined),
  ]);
  return {
    ...t,
    registeredCount,
    isRegistered: !!mine,
    club: club ? { id: club.id, slug: club.slug, name: club.name, logoUrl: club.logoUrl } : null,
  };
}

/** GET /tournaments — every approved club's tournaments (the website's /tournaments),
 * filtered by `status`, or `?ids=`. `limit` caps the list. */
tournaments.get('/tournaments', async (c) => {
  const profile = await myProfile();
  const ids = idList(c.req.query('ids'));
  const status = c.req.query('status');
  const limit = Number(c.req.query('limit') ?? 0);

  let pairs: { t: ClubTournament; club: Club | undefined }[];
  if (ids.length) {
    const found = (await Promise.all(ids.map((id) => getClubTournamentById(id)))).filter((t): t is ClubTournament => !!t);
    pairs = await Promise.all(found.map(async (t) => ({ t, club: await getClubById(t.clubId) })));
  } else {
    const approved = (await listClubs()).filter((club) => club.status === 'approved');
    pairs = (await Promise.all(approved.map(async (club) => (await listClubTournaments(club.id)).map((t) => ({ t, club }))))).flat();
    if (status) pairs = pairs.filter(({ t }) => t.status === status);
    // Soonest first for upcoming / live, most recent first for completed.
    const at = (t: ClubTournament) => (t.startDate ? Date.parse(t.startDate) : Number.MAX_SAFE_INTEGER);
    pairs.sort((a, b) => (status === 'completed' ? at(b.t) - at(a.t) : at(a.t) - at(b.t)));
    if (limit > 0) pairs = pairs.slice(0, limit);
  }
  return ok(c, await Promise.all(pairs.map(({ t, club }) => forList(t, club, profile?.id ?? null))));
});

tournaments.get('/clubs/:slug/tournaments', async (c) => {
  const [club, profile] = await Promise.all([clubBySlug(c.req.param('slug')), myProfile()]);
  const list = await listClubTournaments(club.id);
  return ok(c, await Promise.all(list.map((t) => forList(t, club, profile?.id ?? null))));
});


tournaments.get('/clubs/:slug/tournaments/:tslug', async (c) => {
  const [{ club, t }, profile] = await Promise.all([tournamentOf(c.req.param('slug'), c.req.param('tslug')), myProfile()]);
  return ok(c, await forList(t, club, profile?.id ?? null));
});

/** Registered players: names and photos for everyone; payment status only for staff (as on the website). */
tournaments.get('/clubs/:slug/tournaments/:tslug/registrations', async (c) => {
  const { club, t } = await tournamentOf(c.req.param('slug'), c.req.param('tslug'));
  const [registrations, viewer] = await Promise.all([getRegistrationsForTournament(t.id), getClubViewer(club.slug)]);
  const staff = !!viewer?.isStaff;
  const rows = await Promise.all(
    registrations.map(async (r) => {
      const p = await getProfileById(r.playerId);
      return {
        id: r.id,
        playerId: r.playerId,
        status: r.status,
        ...(staff ? { paymentStatus: r.paymentStatus, registrationNumber: r.registrationNumber } : {}),
        player: p ? { id: p.id, fullName: p.fullName, profilePhotoUrl: p.profilePhotoUrl } : undefined,
      };
    })
  );
  return ok(c, rows);
});

/** Whether you can register: open, not already in, not full (the checks registerForClubTournamentAction makes). */
tournaments.get('/clubs/:slug/tournaments/:tslug/eligibility', async (c) => {
  const [{ t }, profile] = await Promise.all([tournamentOf(c.req.param('slug'), c.req.param('tslug')), requireProfile()]);
  if (!t.registrationOpen || t.status !== 'upcoming') return ok(c, { ok: false, reason: 'closed' });
  if (await getRegistrationForPlayer(t.id, profile.id)) return ok(c, { ok: false, reason: 'already_registered' });
  if ((await countRegisteredForClubTournament(t.id)) >= t.maxPlayers) return ok(c, { ok: false, reason: 'full' });
  return ok(c, { ok: true });
});

tournaments.get('/clubs/:slug/tournaments/:tslug/friends-registered', async (c) => {
  const [{ t }, user] = await Promise.all([tournamentOf(c.req.param('slug'), c.req.param('tslug')), requireUser()]);
  return ok(c, { count: await countFriendsRegistered(t.id, await listFriendUserIds(user.id)) });
});

/** Your registrations at this club (dashboard, "Registered" badges). */
tournaments.get('/clubs/:slug/registrations/mine', async (c) => {
  const [club, profile] = await Promise.all([clubBySlug(c.req.param('slug')), requireProfile()]);
  const regs = await getRegistrationsForPlayer(profile.id, club.id);
  return ok(
    c,
    regs.map(({ id, tournamentId, registrationNumber, status, paymentStatus }) => ({ id, tournamentId, registrationNumber, status, paymentStatus }))
  );
});

/** Champion / runner-up: the admin's declared result first, else what the finished rounds show. */
async function resultsFor(t: ClubTournament, matches: Awaited<ReturnType<typeof getMatchesForTournament>>): Promise<TournamentResults> {
  if (t.championId) {
    const [champ, runner] = await Promise.all([getProfileById(t.championId), t.runnerUpId ? getProfileById(t.runnerUpId) : Promise.resolve(undefined)]);
    if (champ) {
      return {
        champion: { id: champ.id, name: champ.fullName },
        runnerUp: runner ? { id: runner.id, name: runner.fullName } : null,
        semifinalists: [],
      };
    }
  }
  return computeTournamentResults(matches);
}

/** GET /matches/tournaments/:id — the draw (hidden from players until it's published) and results. */
tournaments.get('/matches/tournaments/results', async (c) => {
  const ids = idList(c.req.query('ids'));
  const entries = await Promise.all(
    ids.map(async (id) => {
      const t = await getClubTournamentById(id);
      if (!t) return null;
      const r = await resultsFor(t, await getMatchesForTournament(id));
      return [id, { champion: r.champion, runnerUp: r.runnerUp }] as const;
    })
  );
  return ok(c, Object.fromEntries(entries.filter((e) => !!e)));
});

tournaments.get('/matches/tournaments/:id', async (c) => {
  const t = await getClubTournamentById(c.req.param('id'));
  if (!t) throw new HttpError(404, 'Tournament not found.');
  const [matches, released, user] = await Promise.all([getMatchesForTournament(t.id), isDrawReleased(t.id), getSession()]);
  let staff = false;
  if (user && !released) {
    const club = await getClubById(t.clubId);
    staff = !!club && !!(await getClubViewer(club.slug))?.isStaff;
  }
  const visible = released || staff ? matches.map((m) => ({ ...m, bestOf: m.bestOf ?? t.bestOf })) : [];
  return ok(c, { drawReleased: released, matches: visible, results: await resultsFor(t, matches) });
});
