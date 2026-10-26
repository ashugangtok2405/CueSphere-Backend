import { Hono } from 'hono';

import { approveClubAction, createClubAccountAction, rejectClubAction } from '@/app/actions/platform-actions';
import { isPlatformAdmin, listMembershipsForClub } from '@/services/club-service';
import { getProfileByUserIdForDisplay } from '@/services/profile-service';

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

/** Who's behind a club waiting for review (platform admins only). */
platform.get('/platform/clubs/:id/owner', async (c) => {
  await requirePlatformAdmin();
  const owner = (await listMembershipsForClub(c.req.param('id'))).find((m) => m.role === 'club_admin');
  const profile = owner ? await getProfileByUserIdForDisplay(owner.userId) : undefined;
  return ok(c, { email: profile?.email || null, name: profile?.fullName || null });
});
