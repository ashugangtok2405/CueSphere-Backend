import { Hono } from 'hono';

import { listMembershipsForClub } from '@/services/club-service';
import { getClubTournamentById } from '@/services/club-tournament-service';
import { getPlayerMatchHistory } from '@/services/match-service';
import { listForUser, markAllRead } from '@/services/notification-service';
import { getProfileByUserIdForDisplay } from '@/services/profile-service';
import { getAchievementsForPlayer, getStatsForPlayerAllClubs } from '@/services/stats-service';
import { isStaffRole } from '@/types/club';

import { ok, requireUser } from '../http';
import { clubBySlug } from '../lookups';

/** The club pages the website has beyond the basics — Members and Notifications — and the
 * player profile's match history and achievements. */
export const clubPages = new Hono();

/** Everyone in the club, by name, with their role (the website's Members page). */
clubPages.get('/clubs/:slug/members', async (c) => {
  const club = await clubBySlug(c.req.param('slug'));
  const memberships = await listMembershipsForClub(club.id);
  const rows = await Promise.all(
    memberships.map(async (m) => {
      const p = await getProfileByUserIdForDisplay(m.userId);
      return {
        membershipId: m.id,
        role: m.role,
        isStaff: isStaffRole(m.role),
        profileId: p?.id ?? null,
        name: p?.fullName || 'Unnamed Member',
        photoUrl: p?.profilePhotoUrl || null,
      };
    })
  );
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return ok(c, rows);
});

/** Your notifications at this club, newest first. */
clubPages.get('/clubs/:slug/notifications', async (c) => {
  const [club, user] = await Promise.all([clubBySlug(c.req.param('slug')), requireUser()]);
  return ok(c, await listForUser(user.id, club.id));
});

/** Opening Notifications marks them read, as on the website. */
clubPages.post('/clubs/:slug/notifications/read-all', async (c) => {
  const [club, user] = await Promise.all([clubBySlug(c.req.param('slug')), requireUser()]);
  await markAllRead(user.id, club.id);
  return ok(c, null);
});

const HISTORY_LIMIT = 20;

/** Finished matches, newest first: tournament matches carry their tournament's name. */
clubPages.get('/stats/players/:id/history', async (c) => {
  const playerId = c.req.param('id');
  const matches = (await getPlayerMatchHistory(playerId)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, HISTORY_LIMIT);
  const ids = [...new Set(matches.map((m) => m.tournamentId).filter(Boolean))];
  const names = new Map((await Promise.all(ids.map(async (id) => [id, (await getClubTournamentById(id))?.name ?? ''] as const))).map(([id, name]) => [id, name]));
  return ok(c, matches.map((m) => ({ ...m, tournamentName: m.tournamentId ? (names.get(m.tournamentId) ?? '') : '' })));
});

/** Achievements from every club the player has played at. */
clubPages.get('/stats/players/:id/achievements', async (c) => {
  const playerId = c.req.param('id');
  const clubIds = [...new Set((await getStatsForPlayerAllClubs(playerId)).map((s) => s.clubId))];
  const all = (await Promise.all(clubIds.map((clubId) => getAchievementsForPlayer(playerId, clubId)))).flat();
  return ok(c, all);
});
