import { getSession } from '@/lib/auth/session';
import { getClubBySlug } from '@/services/club-service';
import { getProfileByUserId } from '@/services/profile-service';
import type { Club } from '@/types/club';
import type { PlayerProfile } from '@/types/player-profile';

import { HttpError, requireUser } from './http';

export async function clubBySlug(slug: string): Promise<Club> {
  const club = await getClubBySlug(slug);
  if (!club) throw new HttpError(404, 'Club not found.');
  return club;
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
