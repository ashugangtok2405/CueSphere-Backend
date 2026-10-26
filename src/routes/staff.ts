import { Hono, type Context } from 'hono';

import { uploadClubCoverAction, uploadClubLogoAction } from '@/app/actions/club-logo-actions';
import {
  pairTvAction,
  moveTvAction,
  unpairTvAction,
  saveYoutubeLinkAction,
  saveOverlayOptionsAction,
  uploadSponsorLogoAction,
  removeSponsorLogoAction,
  saveAdOptionsAction,
  uploadAdImageAction,
  removeAdImageAction,
} from '@/app/actions/club-screen-actions';
import { updateClubSettingsAction } from '@/app/actions/club-settings-actions';
import {
  createClubTournamentAction,
  deleteClubTournamentAction,
  saveFixturesAction,
  updateClubTournamentAction,
  updateRegistrationPaymentStatusAction,
} from '@/app/actions/club-tournament-actions';
import { deleteGalleryImageAction, uploadGalleryImageAction } from '@/app/actions/gallery-actions';
import {
  collectDuesAction,
  markChargePaidAction,
  markNoShowAction,
  respondToBookingAction,
  saveTableAction,
  searchTablePlayersAction,
  sendDueReminderAction,
  settleBillAction,
  startTableAction,
  stopTableAction,
} from '@/app/actions/table-actions';
import { createTournamentScorekeeperAction, removeTournamentScorekeeperAction } from '@/app/actions/tournament-scorekeeper-actions';
import { uploadTournamentThumbnailAction } from '@/app/actions/tournament-thumbnail-actions';
import { getClubTournamentBySlug } from '@/services/club-tournament-service';
import { getProfileByUserIdForDisplay } from '@/services/profile-service';
import { getRegistrationsForClub } from '@/services/registration-service';
import { getStreamSettings } from '@/services/stream-settings-service';
import {
  getDaySummary,
  getIncomeReport,
  listClubTables,
  listDuesByPayer,
  listOpenSessions,
  listOutstanding,
  listUpcomingBookings,
} from '@/services/table-service';
import { listScorekeepersForTournament } from '@/services/tournament-scorekeeper-service';
import { listTvScreensForClub } from '@/services/tv-screen-service';

import { body, HttpError, ok, unwrap } from '../http';
import { clubBySlug, requireManager, tournamentOf } from '../lookups';

/** B4 — running the club: tables & billing, bookings, dues, income, tournaments, fixtures,
 * scorekeepers, gallery, settings, TV & stream. Writes are the website's own actions (staff
 * checks, the trial/billing lock, live signals); reads check the same club-manager rule. */
export const staff = new Hono();

/** The club for a staff read: must be someone who runs it. */
async function managedClub(c: Context) {
  const club = await clubBySlug(c.req.param('slug')!);
  await requireManager(club);
  return club;
}

const slugOf = async (c: Context) => (await clubBySlug(c.req.param('slug')!)).slug;

async function uploadForm(c: Context): Promise<FormData> {
  const form = await c.req.formData().catch(() => null);
  if (!form || !(form.get('file') instanceof File)) throw new HttpError(400, 'Choose a photo to upload.');
  return form;
}

// ── Tables & billing ─────────────────────────────────────────────────────────

/** The tables board: tables, open sessions, what's outstanding, upcoming bookings and today's money. */
staff.get('/clubs/:slug/table-overview', async (c) => {
  const club = await managedClub(c);
  const [tables, open, outstanding, bookings, summary] = await Promise.all([
    listClubTables(club.id, true),
    listOpenSessions(club.id),
    listOutstanding(club.id),
    listUpcomingBookings(club.id),
    getDaySummary(club.id),
  ]);
  return ok(c, { tables, open, outstanding, bookings, summary });
});

staff.get('/clubs/:slug/table-summary', async (c) => ok(c, await getDaySummary((await managedClub(c)).id)));
staff.get('/clubs/:slug/table-sessions/outstanding', async (c) => ok(c, await listOutstanding((await managedClub(c)).id)));

staff.get('/clubs/:slug/table-players/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  return ok(c, q.length < 2 ? [] : await searchTablePlayersAction(await slugOf(c), q));
});

staff.post('/clubs/:slug/tables', async (c) => {
  const b = await body<{ tableNumber?: number; name?: string; hourlyRate?: number; active?: boolean }>(c);
  unwrap(await saveTableAction(await slugOf(c), { tableNumber: Number(b.tableNumber), name: b.name ?? '', hourlyRate: Number(b.hourlyRate), active: b.active !== false }));
  return ok(c, null, 201);
});

staff.put('/clubs/:slug/tables/:id', async (c) => {
  const b = await body<{ tableNumber?: number; name?: string; hourlyRate?: number; active?: boolean }>(c);
  unwrap(
    await saveTableAction(await slugOf(c), { id: c.req.param('id'), tableNumber: Number(b.tableNumber), name: b.name ?? '', hourlyRate: Number(b.hourlyRate), active: b.active !== false })
  );
  return ok(c, null);
});

staff.post('/clubs/:slug/tables/:id/start', async (c) => {
  const b = await body<Parameters<typeof startTableAction>[2]>(c);
  unwrap(await startTableAction(await slugOf(c), c.req.param('id'), { lineup: b.lineup ?? [], playerId: b.playerId ?? null, bookingId: b.bookingId ?? null }));
  return ok(c, null, 201);
});

staff.post('/clubs/:slug/table-sessions/:id/stop', async (c) => {
  const { session } = unwrap(await stopTableAction(await slugOf(c), c.req.param('id')));
  return ok(c, session);
});

staff.post('/clubs/:slug/table-sessions/:id/settle', async (c) => {
  const b = await body<{ mode?: Parameters<typeof settleBillAction>[3]; shares?: Parameters<typeof settleBillAction>[2] }>(c);
  if (!b.mode) throw new HttpError(400, 'Choose how to split the bill.');
  unwrap(await settleBillAction(await slugOf(c), c.req.param('id'), b.shares ?? [], b.mode));
  return ok(c, null);
});

staff.post('/clubs/:slug/table-charges/:id/pay', async (c) => {
  const { method } = await body<{ method?: Parameters<typeof markChargePaidAction>[2] }>(c);
  if (!method) throw new HttpError(400, 'Choose cash, UPI or card.');
  unwrap(await markChargePaidAction(await slugOf(c), c.req.param('id'), method));
  return ok(c, null);
});

// ── Bookings ─────────────────────────────────────────────────────────────────

staff.post('/clubs/:slug/bookings/:id/respond', async (c) => {
  const { accept, tableId } = await body<{ accept?: boolean; tableId?: string | null }>(c);
  unwrap(await respondToBookingAction(await slugOf(c), c.req.param('id'), accept === true, tableId ?? null));
  return ok(c, null);
});

staff.post('/clubs/:slug/bookings/:id/no-show', async (c) => {
  unwrap(await markNoShowAction(await slugOf(c), c.req.param('id')));
  return ok(c, null);
});

// ── Dues & income ────────────────────────────────────────────────────────────

staff.get('/clubs/:slug/dues', async (c) => ok(c, await listDuesByPayer((await managedClub(c)).id)));

staff.post('/clubs/:slug/dues/collect', async (c) => {
  const b = await body<{ chargeIds?: string[]; method?: Parameters<typeof collectDuesAction>[2] }>(c);
  if (!b.method) throw new HttpError(400, 'Choose cash, UPI or card.');
  unwrap(await collectDuesAction(await slugOf(c), b.chargeIds ?? [], b.method));
  return ok(c, null);
});

staff.post('/clubs/:slug/dues/remind', async (c) => {
  const { payerKey } = await body<{ payerKey?: string }>(c);
  if (!payerKey) throw new HttpError(400, 'Choose who to remind.');
  unwrap(await sendDueReminderAction(await slugOf(c), payerKey));
  return ok(c, null);
});

staff.get('/clubs/:slug/reports/income', async (c) => {
  const club = await managedClub(c);
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!from || !to) throw new HttpError(400, 'Choose a date range.');
  return ok(c, await getIncomeReport(club.id, from, to));
});

// ── Registrations ────────────────────────────────────────────────────────────

staff.get('/clubs/:slug/registrations', async (c) => ok(c, await getRegistrationsForClub((await managedClub(c)).id)));

staff.patch('/clubs/:slug/registrations/:id/payment-status', async (c) => {
  const { paymentStatus } = await body<{ paymentStatus?: 'paid' | 'pending' }>(c);
  if (paymentStatus !== 'paid' && paymentStatus !== 'pending') throw new HttpError(400, 'Choose paid or pending.');
  unwrap(await updateRegistrationPaymentStatusAction(await slugOf(c), c.req.param('id'), paymentStatus));
  return ok(c, null);
});

// ── Tournaments ──────────────────────────────────────────────────────────────

staff.post('/clubs/:slug/tournaments', async (c) => {
  const club = await clubBySlug(c.req.param('slug'));
  const { slug } = unwrap(await createClubTournamentAction(club.slug, await body(c)));
  return ok(c, (await getClubTournamentBySlug(club.id, slug)) ?? { slug }, 201);
});

staff.patch('/clubs/:slug/tournaments/:tslug', async (c) => {
  const { club, t } = await tournamentOf(c.req.param('slug'), c.req.param('tslug'));
  unwrap(await updateClubTournamentAction(club.slug, t.id, await body(c)));
  return ok(c, null);
});

staff.delete('/clubs/:slug/tournaments/:tslug', async (c) => {
  const { club, t } = await tournamentOf(c.req.param('slug'), c.req.param('tslug'));
  unwrap(await deleteClubTournamentAction(club.slug, t.id));
  return ok(c, null);
});

/** Cover photo: the website's action takes it as a data URL. */
staff.post('/clubs/:slug/tournaments/:tslug/thumbnail', async (c) => {
  const { club, t } = await tournamentOf(c.req.param('slug'), c.req.param('tslug'));
  const file = (await uploadForm(c)).get('file') as File;
  const dataUrl = `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString('base64')}`;
  const { imageUrl } = unwrap(await uploadTournamentThumbnailAction(club.slug, t.slug, dataUrl));
  return ok(c, { imageUrl });
});

/** Saving a round's fixtures releases the draw to players (the website treats any fixtures as released). */
staff.put('/clubs/:slug/matches/tournaments/:id/fixtures', async (c) => {
  const club = await clubBySlug(c.req.param('slug'));
  const { round, pairs } = await body<{ round?: string; pairs?: Parameters<typeof saveFixturesAction>[3] }>(c);
  unwrap(await saveFixturesAction(club.slug, c.req.param('id'), round ?? '', pairs ?? []));
  return ok(c, null);
});

staff.get('/clubs/:slug/tournaments/:tslug/scorekeepers', async (c) => {
  const { club, t } = await tournamentOf(c.req.param('slug'), c.req.param('tslug'));
  await requireManager(club);
  const keepers = await listScorekeepersForTournament(t.id);
  const rows = await Promise.all(
    keepers.map(async (k) => {
      const p = await getProfileByUserIdForDisplay(k.userId);
      return { id: k.id, email: p?.email ?? '', fullName: p?.fullName ?? '' };
    })
  );
  return ok(c, rows);
});

staff.post('/clubs/:slug/tournaments/:tslug/scorekeepers', async (c) => {
  const { club, t } = await tournamentOf(c.req.param('slug'), c.req.param('tslug'));
  const b = await body<{ fullName?: string; email?: string; password?: string }>(c);
  const { email } = unwrap(await createTournamentScorekeeperAction(club.slug, t.id, { fullName: b.fullName ?? '', email: b.email ?? '', password: b.password ?? '' }));
  // The password isn't sent back — staff typed it and share it themselves.
  return ok(c, { email }, 201);
});

staff.delete('/clubs/:slug/tournaments/:tslug/scorekeepers/:id', async (c) => {
  const { club, t } = await tournamentOf(c.req.param('slug'), c.req.param('tslug'));
  unwrap(await removeTournamentScorekeeperAction(club.slug, t.id, c.req.param('id')));
  return ok(c, null);
});

// ── Gallery ──────────────────────────────────────────────────────────────────

staff.post('/clubs/:slug/gallery', async (c) => {
  unwrap(await uploadGalleryImageAction(await slugOf(c), await uploadForm(c)));
  return ok(c, null, 201);
});

staff.delete('/clubs/:slug/gallery/:id', async (c) => {
  unwrap(await deleteGalleryImageAction(await slugOf(c), c.req.param('id')));
  return ok(c, null);
});

// ── Club settings, logo & cover ──────────────────────────────────────────────

staff.patch('/clubs/:slug', async (c) => {
  unwrap(await updateClubSettingsAction(await slugOf(c), await body(c)));
  return ok(c, null);
});

staff.post('/clubs/:slug/logo', async (c) => {
  const { logoUrl } = unwrap(await uploadClubLogoAction(await slugOf(c), await uploadForm(c)));
  return ok(c, { logoUrl });
});

staff.post('/clubs/:slug/cover', async (c) => {
  const { heroBannerUrl } = unwrap(await uploadClubCoverAction(await slugOf(c), await uploadForm(c)));
  return ok(c, { heroBannerUrl });
});

// ── TV & stream ──────────────────────────────────────────────────────────────

staff.get('/clubs/:slug/tv-screens', async (c) => {
  const screens = await listTvScreensForClub((await managedClub(c)).id);
  return ok(c, screens.map(({ id, tableNumber, lastSeenAt, pairedAt }) => ({ id, tableNumber, lastSeenAt, pairedAt })));
});

staff.post('/clubs/:slug/tv-screens/pair', async (c) => {
  const { code, table } = await body<{ code?: string; table?: number }>(c);
  unwrap(await pairTvAction(await slugOf(c), code ?? '', Number(table)));
  return ok(c, null);
});

staff.patch('/clubs/:slug/tv-screens/:id', async (c) => {
  const { table } = await body<{ table?: number }>(c);
  unwrap(await moveTvAction(await slugOf(c), c.req.param('id'), Number(table)));
  return ok(c, null);
});

staff.delete('/clubs/:slug/tv-screens/:id', async (c) => {
  unwrap(await unpairTvAction(await slugOf(c), c.req.param('id')));
  return ok(c, null);
});

/** Stream settings. Anyone may read a table's YouTube link (the match centre embeds it);
 * staff get everything (overlay, sponsors, ads). */
staff.get('/clubs/:slug/stream-settings', async (c) => {
  const club = await clubBySlug(c.req.param('slug'));
  const settings = await getStreamSettings(club.id);
  try {
    await requireManager(club);
    return ok(c, settings);
  } catch {
    return ok(c, { youtubeUrls: settings.youtubeUrls });
  }
});

staff.put('/clubs/:slug/stream-settings/youtube/:table', async (c) => {
  const { url } = await body<{ url?: string }>(c);
  unwrap(await saveYoutubeLinkAction(await slugOf(c), Number(c.req.param('table')), url ?? ''));
  return ok(c, null);
});

staff.put('/clubs/:slug/stream-settings/overlay', async (c) => {
  unwrap(await saveOverlayOptionsAction(await slugOf(c), await body(c)));
  return ok(c, null);
});

staff.put('/clubs/:slug/stream-settings/ads', async (c) => {
  unwrap(await saveAdOptionsAction(await slugOf(c), await body(c)));
  return ok(c, null);
});

// Sponsor logos and ad images: upload one (multipart "file") or remove one by its url.
const IMAGE_LISTS = [
  { path: 'sponsor-logos', add: uploadSponsorLogoAction, remove: removeSponsorLogoAction },
  { path: 'ads/images', add: uploadAdImageAction, remove: removeAdImageAction },
] as const;

for (const list of IMAGE_LISTS) {
  staff.post(`/clubs/:slug/stream-settings/${list.path}`, async (c) => {
    unwrap(await list.add(await slugOf(c), await uploadForm(c)));
    return ok(c, null, 201);
  });
  staff.delete(`/clubs/:slug/stream-settings/${list.path}`, async (c) => {
    const { url } = await body<{ url?: string }>(c);
    if (!url) throw new HttpError(400, 'Choose an image to remove.');
    unwrap(await list.remove(await slugOf(c), url));
    return ok(c, null);
  });
}
