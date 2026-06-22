import { collection, doc, getDoc, setDoc, serverTimestamp, Timestamp } from 'firebase/firestore'
import type { User } from 'firebase/auth'
import { TRIAL_DAYS, isReservedSlug } from '@linyup/shared'
import { db } from './firebase'

/**
 * Account/team provisioning shared by the signup wizard and the social-auth
 * flow. Sign-in (email, social, or magic link) only authenticates the user;
 * these helpers create the Firestore profile + team documents.
 */

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
}

/** Whether the user already has a team (i.e. has finished signup before). */
export async function userHasTeam(uid: string): Promise<boolean> {
  const snap = await getDoc(doc(db, 'users', uid))
  return snap.exists() && !!snap.data()?.currentTeam
}

/**
 * Create a team, the owner membership, and the user profile, then point the
 * user's `currentTeam` at it. Safe for users who authenticated via any method
 * (social sign-ins carry displayName/photoURL; email signups don't).
 */
export async function provisionTeam(
  user: Pick<User, 'uid' | 'email' | 'displayName' | 'photoURL'>,
  teamName: string,
  sportType: string | undefined
): Promise<string> {
  const teamRef = doc(collection(db, 'teams'))
  const teamId = teamRef.id
  const rawSlug = slugify(teamName)
  const slug = isReservedSlug(rawSlug) ? `${rawSlug}-team` : rawSlug
  const now = serverTimestamp()
  const { uid } = user

  // New teams start on a full-access Studio trial so they experience the marquee
  // features; Coach + add-ons becomes the downgrade path at trial end.
  const trialEndsAt = Timestamp.fromDate(new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000))

  const defaultLinks = [
    {
      label: 'Book Now',
      description: 'Reserve your spot in a session',
      url: '',
      showInBioLink: true,
      target: 'booking',
    },
    {
      label: 'Membership Signup',
      description: 'Join our community and become a member',
      url: '',
      showInBioLink: true,
      target: 'signup',
    },
  ]

  // Team document
  await setDoc(teamRef, {
    name: teamName.trim(),
    slug,
    description: '',
    sport_type: sportType || '',
    links: defaultLinks,
    settings: {},
    plan: 'studio',
    plan_status: 'trial',
    trial_ends_at: trialEndsAt,
    created: now,
    createdBy: uid,
    primaryContact: uid,
  })

  // Owner membership
  await setDoc(doc(db, 'teams', teamId, 'team_members', uid), {
    userId: uid,
    teamId,
    role: 'owner',
    joined: now,
    addedBy: uid,
  })

  // User profile — merge so we keep created_at on a profile that already exists
  // (e.g. a social user who signed in earlier but hadn't created a team yet).
  const existing = await getDoc(doc(db, 'users', uid))
  await setDoc(
    doc(db, 'users', uid),
    {
      email: user.email ?? '',
      ...(user.displayName ? { displayName: user.displayName } : {}),
      ...(user.photoURL ? { photoURL: user.photoURL } : {}),
      currentTeam: teamId,
      ...(existing.exists() ? {} : { created_at: now }),
    },
    { merge: true }
  )

  return teamId
}
