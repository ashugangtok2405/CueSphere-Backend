import { getSession } from '@/lib/auth/session';
import { getClubById, getClubBySlug, getMembership } from '@/services/club-service';
import { getClubTournamentById, getClubTournamentBySlug } from '@/services/club-tournament-service';
import { getProfileByUserId } from '@/services/profile-service';
import { isScorekeeperOnly, isStaffRole, type Club } from '@/types/club';
import type { PlayerProfile } from '@/types/player-profile';

import { HttpError, requireUser } from './http';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string) => UUID.test(value);

/** A club by its slug — or by its id, which some screens have to hand (e.g. a match's clubId). */
export async function clubBySlug(slugOrId: string): Promise<Club> {
  const club = (await getClubBySlug(slugOrId)) ?? (isUuid(slugOrId) ? await getClubById(slugOrId) : undefined);
  if (!club) throw new HttpError(404, 'Club not found.');
  return club;
}

/** A club's tournament by its slug, or by id (staff screens open tournaments by id). */
export async function tournamentOf(clubSlug: string, slugOrId: string) {
  const club = await clubBySlug(clubSlug);
  let t = await getClubTournamentBySlug(club.id, slugOrId);
  if (!t && isUuid(slugOrId)) {
    const byId = await getClubTournamentById(slugOrId);
    if (byId?.clubId === club.id) t = byId;
  }
  if (!t) throw new HttpError(404, 'Tournament not found.');
  return { club, t };
}

/** Club staff who run the club (not scorekeeper-only accounts) — the website's requireClubManager. */
export async function requireManager(club: Club) {
  const user = await requireUser();
  const membership = await getMembership(club.id, user.id);
  if (!isStaffRole(membership?.role) || isScorekeeperOnly(membership?.role)) {
    throw new HttpError(403, "You don't have permission to manage this club.");
  }
  return user;
}

/** The caller's own player profile (created at first sign-in), or null when signed out. */
export async function myProfile(): Promise<PlayerProfile | null> {
  const user = await getSession();
  return user ? ((await getProfileByUserId(user.id)) ?? null) : null;
}

export async function requireProfile(): Promise<PlayerProfile> {
  const user = await requireUser();
  const profile = await getProfileByUserId(user.id);
  if (!profile) throw new HttpError(404, 'Player profile not found.');
  return profile;
}

/** What anyone may see of another player: no email, mobile, date of birth or emergency contact. */
export function publicProfile(p: PlayerProfile) {
  return {
    id: p.id,
    userId: p.userId,
    memberId: p.memberId,
    fullName: p.fullName,
    email: '',
    mobile: '',
    city: p.city,
    profilePhotoUrl: p.profilePhotoUrl,
    preferredCue: p.preferredCue,
    primaryClubId: p.primaryClubId,
  };
}

/** "a,b,c" query value → ids (blank entries dropped). */
export function idList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
