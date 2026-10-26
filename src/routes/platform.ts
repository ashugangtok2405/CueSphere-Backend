import { Hono } from 'hono';

import {
  approveClubAction,
  createClubAccountAction,
  markClubPaidAction,
  rejectClubAction,
  setClubPausedAction,
  setClubTrialAction,
} from '@/app/actions/platform-actions';
import { isPlatformAdmin, listClubPayments, listClubs, listMembershipsForClub } from '@/services/club-service';
import { listCities, listStates } from '@/services/location-service';
import { getProfileByUserIdForDisplay } from '@/services/profile-service';
import { getClubAccess, GRACE_DAYS, TRIAL_DAYS } from '@/types/club';

import { body, HttpError, ok, requireUser, unwrap } from '../http';

/** Clubs and the platform admin, the website's way: owners get in touch, and the platform
 * admin creates their club account (their login + the club, approved with its trial
 * running). There's no self sign-up, so the old create-club routes point owners to us. */
export const platform = new Hono();

async function requirePlatformAdmin() {
  const user = await requireUser();
  if (!(await isPlatformAdmin(user.id))) throw new HttpError(403, 'You are not authorized to do this.');
  return user;
}

const CONTACT_US = 'Clubs are set up by the CueSphere team. Message us on WhatsApp at +91 79045 51660 and we’ll create your club.';

platform.post('/clubs', () => {
  throw new HttpError(403, CONTACT_US);
});
platform.post('/club-enquiries', () => {
  throw new HttpError(403, CONTACT_US);
});

/** POST /platform/club-accounts — the website's createClubAccountAction (platform admins only). */
platform.post('/platform/club-accounts', async (c) => {
  const result = unwrap(await createClubAccountAction(await body(c)));
  return ok(c, result, 201);
});

platform.get('/club-enquiries', async (c) => {
  await requireUser();
  return ok(c, []);
});

platform.get('/platform/club-enquiries', async (c) => {
  await requirePlatformAdmin();
  return ok(c, []);
});

for (const step of ['approve', 'reject'] as const) {
  platform.post(`/platform/club-enquiries/:id/${step}`, async () => {
    await requirePlatformAdmin();
    throw new HttpError(404, 'Club requests are reviewed as pending clubs now — approve the club itself.');
  });
}

platform.post('/platform/clubs/:id/approve', async (c) => {
  unwrap(await approveClubAction(c.req.param('id')));
  return ok(c, null);
});

platform.post('/platform/clubs/:id/reject', async (c) => {
  unwrap(await rejectClubAction(c.req.param('id')));
  return ok(c, null);
});

/** GET /platform/clubs/live — every live club with its trial / paid status, owner and last
 * payment (the website's Platform Admin "Live Clubs" list), in the website's order: locked
 * and due first, then soonest to end. */
platform.get('/platform/clubs/live', async (c) => {
  await requirePlatformAdmin();
  const [clubs, payments, states, cities] = await Promise.all([listClubs(), listClubPayments(), listStates(), listCities()]);
  const place = (stateCode: string | null, cityId: string | null) =>
    [cities.find((ci) => ci.id === cityId)?.name, states.find((st) => st.code === stateCode)?.name].filter(Boolean).join(', ') || null;
  const rows = await Promise.all(
    clubs
      .filter((club) => club.status === 'approved')
      .map(async (club) => {
        const owner = (await listMembershipsForClub(club.id)).find((m) => m.role === 'club_admin');
        const profile = owner ? await getProfileByUserIdForDisplay(owner.userId) : undefined;
        const last = payments.find((p) => p.clubId === club.id);
        return {
          id: club.id,
          name: club.name,
          slug: club.slug,
          place: place(club.stateCode, club.cityId),
          ownerEmail: profile?.email || null,
          phone: club.phone || null,
          access: getClubAccess(club),
          lastPayment: last ? { amount: last.amount, months: last.months, createdAt: last.createdAt } : null,
        };
      })
  );
  const order = (r: (typeof rows)[number]) => ({ expired: 0, grace: 1, paused: 2, trial: 3, paid: 4, unlimited: 5 })[r.access.state] * 10_000 + r.access.daysLeft;
  rows.sort((a, b) => order(a) - order(b));
  return ok(c, { clubs: rows, trialDays: TRIAL_DAYS, graceDays: GRACE_DAYS });
});

/** Mark as paid: 1, 3, 6 or 12 months on top of any paid time left (the website's markClubPaidAction). */
platform.post('/platform/clubs/:id/paid', async (c) => {
  const b = await body<{ months?: number; amount?: number; note?: string }>(c);
  const result = unwrap(await markClubPaidAction(c.req.param('id'), { months: Number(b.months), amount: Number(b.amount ?? 0), note: b.note ?? '' }));
  return ok(c, { paidUntil: result.paidUntil });
});

/** Set the free trial to N days from today (0 ends it now). */
platform.post('/platform/clubs/:id/trial', async (c) => {
  const { days } = await body<{ days?: number }>(c);
  unwrap(await setClubTrialAction(c.req.param('id'), Number(days)));
  return ok(c, null);
});

/** Pause or resume a club's access. */
platform.post('/platform/clubs/:id/pause', async (c) => {
  const { paused } = await body<{ paused?: boolean }>(c);
  unwrap(await setClubPausedAction(c.req.param('id'), paused === true));
  return ok(c, null);
});

/** Who's behind a club waiting for review (platform admins only). */
platform.get('/platform/clubs/:id/owner', async (c) => {
  await requirePlatformAdmin();
  const owner = (await listMembershipsForClub(c.req.param('id'))).find((m) => m.role === 'club_admin');
  const profile = owner ? await getProfileByUserIdForDisplay(owner.userId) : undefined;
  return ok(c, { email: profile?.email || null, name: profile?.fullName || null });
});
