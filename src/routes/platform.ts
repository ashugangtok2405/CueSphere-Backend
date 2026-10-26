import { Hono } from 'hono';

import { createClubAction } from '@/app/actions/club-actions';
import { approveClubAction, rejectClubAction } from '@/app/actions/platform-actions';
import { getClubBySlug, isPlatformAdmin, listMembershipsForClub } from '@/services/club-service';
import { getProfileByUserIdForDisplay } from '@/services/profile-service';

import { body, HttpError, ok, requireUser, unwrap } from '../http';

/** B5 — opening a club and the platform admin's review, the website's way: "Create Your
 * Club" makes a pending club (you become its admin) and a platform admin approves or
 * rejects it. The website has no separate enquiry step, so the app's enquiry lists are empty. */
export const platform = new Hono();

async function requirePlatformAdmin() {
  const user = await requireUser();
  if (!(await isPlatformAdmin(user.id))) throw new HttpError(403, 'You are not authorized to do this.');
  return user;
}

type NewClub = { name?: string; tagline?: string; stateCode?: string; cityId?: string; newCity?: string };

async function createClub(input: NewClub) {
  await requireUser();
  const { slug } = unwrap(
    await createClubAction({ name: input.name ?? '', tagline: input.tagline, stateCode: input.stateCode ?? '', cityId: input.cityId ?? '', newCity: input.newCity })
  );
  return getClubBySlug(slug);
}

/** POST /clubs — the website's Create Your Club: the club starts pending, you're its admin. */
platform.post('/clubs', async (c) => ok(c, await createClub(await body<NewClub>(c)), 201));

/** The app's old two-step request maps onto the same thing: the request is the pending club. */
platform.post('/club-enquiries', async (c) => {
  const b = await body<{ clubName?: string; stateCode?: string; cityId?: string }>(c);
  const club = await createClub({ name: b.clubName, stateCode: b.stateCode, cityId: b.cityId });
  return ok(c, club, 201);
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

/** Who's behind a club waiting for review (platform admins only). */
platform.get('/platform/clubs/:id/owner', async (c) => {
  await requirePlatformAdmin();
  const owner = (await listMembershipsForClub(c.req.param('id'))).find((m) => m.role === 'club_admin');
  const profile = owner ? await getProfileByUserIdForDisplay(owner.userId) : undefined;
  return ok(c, { email: profile?.email || null, name: profile?.fullName || null });
});
