import { Hono } from 'hono';

import { joinClubAction } from '@/app/actions/club-membership-actions';
import { registerForClubTournamentAction } from '@/app/actions/club-tournament-actions';
import { followPlayerAction, unfollowPlayerAction } from '@/app/actions/follow-actions';
import { removeFriendshipAction, respondToFriendRequestAction, sendFriendRequestAction } from '@/app/actions/friendship-actions';
import { setPrimaryClubAction, updateProfileAction } from '@/app/actions/profile-actions';
import { cancelMyBookingAction, requestBookingAction } from '@/app/actions/table-actions';
import { getProfileByUserId, updateProfile } from '@/services/profile-service';

import { body, HttpError, ok, requireUser, unwrap } from '../http';

/** B2 — what a player does: join, register, profile & photo, follow, friends, bookings.
 * Each route is the website's own server action, so rules and messages match the website. */
export const playerActions = new Hono();

playerActions.post('/clubs/:slug/join', async (c) => {
  unwrap(await joinClubAction(c.req.param('slug')));
  return ok(c, null);
});

playerActions.post('/clubs/:slug/tournaments/:tslug/register', async (c) => {
  const result = unwrap(await registerForClubTournamentAction(c.req.param('slug'), c.req.param('tslug')));
  return ok(c, result, 201);
});

// ── Profile ──────────────────────────────────────────────────────────────────

playerActions.put('/profiles/me', async (c) => {
  const input = await body<Parameters<typeof updateProfileAction>[0]>(c);
  const { profile } = unwrap(await updateProfileAction(input));
  return ok(c, profile);
});

playerActions.put('/profiles/me/primary-club', async (c) => {
  const { clubId } = await body<{ clubId?: string | null }>(c);
  unwrap(await setPrimaryClubAction(clubId ?? null));
  return ok(c, null);
});

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** Profile photo upload. Stored the way the website's AvatarUpload stores it: as a data URL
 * in profile_photo_url (served back at /api/player-photo/<id>/<version>). */
playerActions.post('/profiles/me/photo', async (c) => {
  const user = await requireUser();
  const form = await c.req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'Choose a photo to upload.');
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new HttpError(400, 'Use a JPG, PNG or WebP photo.');
  if (file.size > MAX_PHOTO_BYTES) throw new HttpError(400, 'That photo is too big — up to 5 MB.');
  const dataUrl = `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString('base64')}`;
  if (!(await getProfileByUserId(user.id))) throw new HttpError(404, 'Player profile not found.');
  return ok(c, await updateProfile(user.id, { profilePhotoUrl: dataUrl }));
});

// ── Follows & friends ────────────────────────────────────────────────────────

playerActions.post('/follows/:playerId', async (c) => {
  unwrap(await followPlayerAction(c.req.param('playerId')));
  return ok(c, { following: true });
});

playerActions.delete('/follows/:playerId', async (c) => {
  unwrap(await unfollowPlayerAction(c.req.param('playerId')));
  return ok(c, { following: false });
});

playerActions.post('/friendships', async (c) => {
  const { recipientUserId } = await body<{ recipientUserId?: string }>(c);
  if (!recipientUserId) throw new HttpError(400, 'Choose a player.');
  unwrap(await sendFriendRequestAction(recipientUserId));
  return ok(c, null, 201);
});

playerActions.post('/friendships/:id/respond', async (c) => {
  const { accept } = await body<{ accept?: boolean }>(c);
  unwrap(await respondToFriendRequestAction(c.req.param('id'), accept === true));
  return ok(c, null);
});

playerActions.delete('/friendships/:id', async (c) => {
  unwrap(await removeFriendshipAction(c.req.param('id')));
  return ok(c, null);
});

// ── Table bookings ───────────────────────────────────────────────────────────

playerActions.post('/clubs/:slug/bookings', async (c) => {
  const b = await body<{ date?: string; time?: string; durationMinutes?: number; tableNumber?: number | null; note?: string }>(c);
  unwrap(
    await requestBookingAction(c.req.param('slug'), {
      date: b.date ?? '',
      time: b.time ?? '',
      durationMinutes: Number(b.durationMinutes ?? 0),
      tableNumber: b.tableNumber ?? null,
      note: b.note ?? '',
    })
  );
  return ok(c, null, 201);
});

playerActions.post('/clubs/:slug/bookings/:id/cancel', async (c) => {
  unwrap(await cancelMyBookingAction(c.req.param('slug'), c.req.param('id')));
  return ok(c, null);
});
