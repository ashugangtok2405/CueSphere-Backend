import { Hono } from 'hono';

import { getClubViewer } from '@/lib/auth/get-club-viewer';
import { getSession } from '@/lib/auth/session';
import { getClubBoard } from '@/features/table-display/table-board';
import { getClubById, isPlatformAdmin, listClubs, listMembershipsForClub, listMembershipsForUser } from '@/services/club-service';
import { listClubTournaments } from '@/services/club-tournament-service';
import { listGalleryImages } from '@/services/gallery-service';
import { listActiveStates, listCities, listCitiesForState, listStates } from '@/services/location-service';
import { getPlayerDues, getPlayerDueTotal, getPublicTableStatus, listClubTables, listPlayerBookings } from '@/services/table-service';
import type { Club } from '@/types/club';

import { HttpError, ok, requireUser } from '../http';
import { clubBySlug, idList, requireProfile } from '../lookups';

export const clubs = new Hono();

// ── Locations ────────────────────────────────────────────────────────────────

clubs.get('/locations/states', async (c) => ok(c, c.req.query('active') === 'true' ? await listActiveStates() : await listStates()));

clubs.get('/locations/cities', async (c) => {
  const state = c.req.query('state');
  return ok(c, state ? await listCitiesForState(state) : await listCities());
});

// ── Clubs ────────────────────────────────────────────────────────────────────

async function withCounts(club: Club) {
  const [tournaments, members] = await Promise.all([listClubTournaments(club.id), listMembershipsForClub(club.id)]);
  return { ...club, tournamentCount: tournaments.length, memberCount: members.length };
}

/** GET /clubs — approved clubs (as on the website), or `?ids=` (any status, e.g. your own
 * pending club), or `?status=pending|approved` for platform admins. `include=counts` adds
 * tournament and member counts. */
clubs.get('/clubs', async (c) => {
  const ids = idList(c.req.query('ids'));
  const status = c.req.query('status');
  let list: Club[];
  if (ids.length) {
    list = (await Promise.all(ids.map((id) => getClubById(id)))).filter((club): club is Club => !!club);
  } else if (status && status !== 'approved') {
    const user = await requireUser();
    if (!(await isPlatformAdmin(user.id))) throw new HttpError(403, 'Only platform admins can see these clubs.');
    list = (await listClubs()).filter((club) => club.status === status);
  } else {
    list = (await listClubs()).filter((club) => club.status === 'approved');
  }
  return ok(c, c.req.query('include') === 'counts' ? await Promise.all(list.map(withCounts)) : list);
});

clubs.get('/clubs/memberships/by-user/:userId', async (c) => ok(c, await listMembershipsForUser(c.req.param('userId'))));

/** A club with its tournament and member counts (one request for the club screens, not two). */
clubs.get('/clubs/:slug', async (c) => ok(c, await withCounts(await clubBySlug(c.req.param('slug')))));

/** GET /viewer/clubs/:slug — the website's getClubViewer: your membership, unread
 * notifications, active registration and current match at this club. */
clubs.get('/viewer/clubs/:slug', async (c) => {
  const viewer = await getClubViewer(c.req.param('slug'));
  if (!viewer) throw new HttpError(404, 'Club not found.');
  const { club: _club, ...standing } = viewer;
  return ok(c, standing);
});

clubs.get('/clubs/:slug/gallery', async (c) => {
  const club = await clubBySlug(c.req.param('slug'));
  return ok(c, await listGalleryImages(club.id));
});

/** Free / playing / booked-soon for every active table (the club page's "Tables right now"). */
clubs.get('/clubs/:slug/table-status', async (c) => {
  const club = await clubBySlug(c.req.param('slug'));
  return ok(c, await getPublicTableStatus(club.id));
});

/** Tables players can book. Staff get inactive ones too with `includeInactive=true`. */
clubs.get('/clubs/:slug/tables', async (c) => {
  const club = await clubBySlug(c.req.param('slug'));
  const includeInactive = c.req.query('includeInactive') === 'true';
  if (includeInactive) {
    const user = await requireUser();
    const viewer = await getClubViewer(club.slug);
    if (!viewer?.isStaff) throw new HttpError(403, 'Only club staff can see inactive tables.');
    void user;
  }
  const tables = await listClubTables(club.id, includeInactive);
  return ok(c, tables.map(({ id, tableNumber, name, hourlyRate, active }) => ({ id, tableNumber, name, hourlyRate, active })));
});

/** Live and next match on every table — the club's Live tab (the website's club board). */
clubs.get('/boards/:slug', async (c) => {
  const club = await clubBySlug(c.req.param('slug'));
  const board = await getClubBoard(club);
  return ok(c, { live: board.live, next: board.next });
});

// ── The caller's own things at a club ────────────────────────────────────────

clubs.get('/clubs/:slug/my/dues/total', async (c) => {
  const [club, profile] = await Promise.all([clubBySlug(c.req.param('slug')), requireProfile()]);
  return ok(c, { total: await getPlayerDueTotal(club.id, profile.id) });
});

clubs.get('/clubs/:slug/my/dues', async (c) => {
  const [club, profile] = await Promise.all([clubBySlug(c.req.param('slug')), requireProfile()]);
  return ok(c, await getPlayerDues(club.id, profile.id));
});

clubs.get('/clubs/:slug/my/bookings', async (c) => {
  const [club, profile] = await Promise.all([clubBySlug(c.req.param('slug')), requireProfile()]);
  return ok(c, await listPlayerBookings(club.id, profile.id));
});

/** GET /club-enquiries/me — where the viewer is in "open a club". The website has no
 * separate enquiry step: a new club waits as a pending club until a platform admin approves it. */
clubs.get('/club-enquiries/me', async (c) => {
  const user = await getSession();
  if (!user) return ok(c, { stage: 'none', enquiry: null });
  const owned = (await listMembershipsForUser(user.id)).filter((m) => m.role === 'club_admin');
  const ownedClubs = (await Promise.all(owned.map((m) => getClubById(m.clubId)))).filter((club): club is Club => !!club);
  const stage = ownedClubs.some((club) => club.status === 'approved') ? 'club_live' : ownedClubs.length ? 'club_pending' : 'none';
  return ok(c, { stage, enquiry: null });
});
