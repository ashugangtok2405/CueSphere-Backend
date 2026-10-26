import { Hono } from 'hono';

import { updateMatchStatusAction } from '@/app/actions/club-tournament-actions';
import {
  cancelFriendlyAction,
  confirmFriendlyAction,
  createFriendlyAction,
  disputeFriendlyAction,
  respondToFriendlyAction,
  startFriendlyAction,
} from '@/app/actions/friendly-actions';
import { finishMatchAction, saveMatchProgressAction, saveMatchResultAction, updateLiveProgressAction } from '@/app/actions/match-scoring-actions';
import { getClubById } from '@/services/club-service';
import { getMatchById } from '@/services/match-service';
import type { MatchStatus } from '@/types/match';

import { body, HttpError, ok, unwrap } from '../http';

/** B3 — friendlies (challenge → accept → play → confirm) and live scoring. Every route is
 * the website's own action: the friendlies state machine, who may score, stats updates and
 * the live signals the website's screens and TVs listen to all stay in one place. */
export const scoring = new Hono();

// ── Friendlies ───────────────────────────────────────────────────────────────

scoring.post('/friendlies', async (c) => {
  const b = await body<{ opponentId?: string; bestOf?: number; venueClubId?: string | null; tableNumber?: number }>(c);
  const result = unwrap(
    await createFriendlyAction({
      opponentId: b.opponentId ?? '',
      bestOf: Number(b.bestOf ?? 0),
      venueClubId: b.venueClubId ?? null,
      tableNumber: b.tableNumber,
    })
  );
  return ok(c, result, 201);
});

scoring.post('/friendlies/:id/respond', async (c) => {
  const { accept } = await body<{ accept?: boolean }>(c);
  unwrap(await respondToFriendlyAction(c.req.param('id'), accept === true));
  return ok(c, null);
});

const FRIENDLY_STEPS = {
  cancel: cancelFriendlyAction,
  start: startFriendlyAction,
  confirm: confirmFriendlyAction,
  dispute: disputeFriendlyAction,
} as const;

scoring.post('/friendlies/:id/:step', async (c) => {
  const step = FRIENDLY_STEPS[c.req.param('step') as keyof typeof FRIENDLY_STEPS];
  if (!step) throw new HttpError(404, 'No such friendly action.');
  unwrap(await step(c.req.param('id')));
  return ok(c, null);
});

// ── Scoring ──────────────────────────────────────────────────────────────────

/** Mark a tournament match live / scheduled / completed (club staff and scorekeepers). */
scoring.patch('/matches/:id/status', async (c) => {
  const { status } = await body<{ status?: MatchStatus }>(c);
  if (!status) throw new HttpError(400, 'Choose a status.');
  const match = await getMatchById(c.req.param('id'));
  if (!match) throw new HttpError(404, 'Match not found.');
  const club = match.clubId ? await getClubById(match.clubId) : undefined;
  if (!club) throw new HttpError(400, 'Friendlies are started from the friendly itself.');
  unwrap(await updateMatchStatusAction(club.slug, match.id, status));
  return ok(c, null);
});

/** Ball-by-ball state after every tap (the app coalesces: one request in flight at a time). */
scoring.patch('/matches/:id/live', async (c) => {
  unwrap(await updateLiveProgressAction(c.req.param('id'), await body(c)));
  return ok(c, null);
});

/** Frame tally after a frame ends. */
scoring.patch('/matches/:id/progress', async (c) => {
  const b = await body<{ framesWonPlayer1?: number; framesWonPlayer2?: number; frameScores?: Parameters<typeof saveMatchProgressAction>[1]['frameScores'] }>(c);
  unwrap(
    await saveMatchProgressAction(c.req.param('id'), {
      framesWonPlayer1: Number(b.framesWonPlayer1 ?? 0),
      framesWonPlayer2: Number(b.framesWonPlayer2 ?? 0),
      frameScores: b.frameScores,
    })
  );
  return ok(c, null);
});

/** Finish from the frame tally (Live Score / Frame-by-Frame). Friendlies then wait for the opponent to confirm. */
scoring.post('/matches/:id/finish', async (c) => {
  unwrap(await finishMatchAction(c.req.param('id'), await body(c)));
  return ok(c, null);
});

/** Result only (no frame detail). */
scoring.post('/matches/:id/result', async (c) => {
  unwrap(await saveMatchResultAction(c.req.param('id'), await body(c)));
  return ok(c, null);
});
