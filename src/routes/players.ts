import { Hono } from 'hono';

import { getClubViewer } from '@/lib/auth/get-club-viewer';
import { getClubTournamentById } from '@/services/club-tournament-service';
import { listFollowedPlayerIds, isFollowingPlayer } from '@/services/follow-service';
import { getFriendlyHeadToHead, getFriendlyStats, listFriendliesForPlayer, searchPlayers } from '@/services/friendly-service';
import { listAllPlayerProfiles, listFriendshipsForUser, listFriendUserIds } from '@/services/friendship-service';
import { getLiveMatchForClub, getMatchById, getHeadToHead, getOpenMatchesForPlayers, getScorableMatchesForClub } from '@/services/match-service';
import { getProfileById, getProfileByUserIdForDisplay } from '@/services/profile-service';
import { getCityRankings, getPlayerRanks, getRankedCityIds, getStateRankings } from '@/services/ranking-service';
import { getStatsForPlayer, getStatsForPlayerAllClubs } from '@/services/stats-service';
import type { DrawMatch } from '@/types/match';
import type { PlayerProfile } from '@/types/player-profile';

import { HttpError, ok, requireUser } from '../http';
import { clubBySlug, idList, myProfile, publicProfile, requireProfile } from '../lookups';

export const players = new Hono();

// ── Profiles ─────────────────────────────────────────────────────────────────

/** Your own profile, in full (the only place email, mobile, DOB and emergency contact go out). */
players.get('/profiles/me', async (c) => ok(c, await requireProfile()));

/** Player directory: everyone with a name, public fields only. */
players.get('/profiles', async (c) => {
  await requireUser();
  const all = await listAllPlayerProfiles();
  return ok(c, all.filter((p) => p.fullName?.trim()).map(publicProfile));
});

players.get('/profiles/batch', async (c) => {
  const ids = idList(c.req.query('ids'));
  const userIds = idList(c.req.query('userIds'));
  const found = await Promise.all([...ids.map((id) => getProfileById(id)), ...userIds.map((id) => getProfileByUserIdForDisplay(id))]);
  return ok(c, found.filter((p): p is PlayerProfile => !!p).map(publicProfile));
});

players.get('/profiles/:id', async (c) => {
  const p = await getProfileById(c.req.param('id'));
  if (!p) throw new HttpError(404, 'Player not found.');
  const me = await myProfile();
  return ok(c, me?.id === p.id ? p : publicProfile(p));
});

// ── Stats & rankings ─────────────────────────────────────────────────────────

/** Tournament stats per club (all clubs), or one club's with `?clubId=`. */
players.get('/stats/players/:id', async (c) => {
  const id = c.req.param('id');
  const clubId = c.req.query('clubId');
  return ok(c, clubId ? ((await getStatsForPlayer(id, clubId)) ?? null) : await getStatsForPlayerAllClubs(id));
});

players.get('/stats/players/:id/ranks', async (c) => ok(c, await getPlayerRanks(c.req.param('id'))));

/** State rankings, or one city's within the state (friendlies never count). */
players.get('/stats/rankings', async (c) => {
  const state = c.req.query('state');
  const city = c.req.query('city') || null;
  if (!state) throw new HttpError(400, 'Choose a state.');
  const [entries, ranked] = await Promise.all([city ? getCityRankings(city) : getStateRankings(state), getRankedCityIds(state)]);
  return ok(c, { state, city, rankedCityIds: [...ranked], entries });
});

// ── Follows & friends ────────────────────────────────────────────────────────

players.get('/follows', async (c) => {
  const user = await requireUser();
  return ok(c, await listFollowedPlayerIds(user.id));
});

players.get('/follows/:playerId', async (c) => {
  const user = await requireUser();
  return ok(c, { following: await isFollowingPlayer(user.id, c.req.param('playerId')) });
});

players.get('/friendships', async (c) => {
  const user = await requireUser();
  return ok(c, await listFriendshipsForUser(user.id));
});

players.get('/friendships/friend-ids', async (c) => {
  const user = await requireUser();
  return ok(c, await listFriendUserIds(user.id));
});

// ── Friendlies (reads) ───────────────────────────────────────────────────────

players.get('/friendlies/mine', async (c) => {
  const profile = await requireProfile();
  return ok(c, await listFriendliesForPlayer(profile.id));
});

players.get('/friendlies/players/search', async (c) => {
  const profile = await requireProfile();
  const q = (c.req.query('q') ?? '').trim();
  return ok(c, q.length < 2 ? [] : await searchPlayers(q, profile.id));
});

players.get('/friendlies/players/:id/stats', async (c) => ok(c, await getFriendlyStats(c.req.param('id'))));

// ── Matches (reads) ──────────────────────────────────────────────────────────

/** Tournament matches carry their tournament's best-of (friendlies have their own). */
async function withBestOf(m: DrawMatch): Promise<DrawMatch> {
  if (m.bestOf != null || !m.tournamentId) return m;
  const t = await getClubTournamentById(m.tournamentId);
  return { ...m, bestOf: t?.bestOf ?? null };
}

players.get('/matches/open', async (c) => {
  const ids = idList(c.req.query('playerIds'));
  return ok(c, ids.length ? await Promise.all((await getOpenMatchesForPlayers(ids)).map(withBestOf)) : []);
});

players.get('/matches/:id', async (c) => {
  const m = await getMatchById(c.req.param('id'));
  if (!m) throw new HttpError(404, 'Match not found.');
  return ok(c, await withBestOf(m));
});

/** Head to head: tournament meetings at this club, or friendlies for a friendly. */
players.get('/matches/:id/head-to-head', async (c) => {
  const m = await getMatchById(c.req.param('id'));
  if (!m) throw new HttpError(404, 'Match not found.');
  return ok(c, m.kind === 'friendly' ? await getFriendlyHeadToHead(m.player1Id, m.player2Id) : await getHeadToHead(m.clubId, m.player1Id, m.player2Id));
});

players.get('/matches/:id/friendly-stats', async (c) => {
  const m = await getMatchById(c.req.param('id'));
  if (!m) throw new HttpError(404, 'Match not found.');
  const [player1, player2] = await Promise.all([getFriendlyStats(m.player1Id), getFriendlyStats(m.player2Id)]);
  return ok(c, { player1, player2 });
});

players.get('/clubs/:slug/matches/live', async (c) => {
  const club = await clubBySlug(c.req.param('slug'));
  const m = await getLiveMatchForClub(club.id);
  return ok(c, m ? await withBestOf(m) : null);
});

/** Matches staff can score now / next (club admin and scorekeepers). */
players.get('/clubs/:slug/matches/scorable', async (c) => {
  const club = await clubBySlug(c.req.param('slug'));
  await requireUser();
  const viewer = await getClubViewer(club.slug);
  if (!viewer?.isStaff) throw new HttpError(403, 'Only club staff can score matches.');
  const list = await getScorableMatchesForClub(club.id);
  return ok(c, await Promise.all(list.map(withBestOf)));
});

