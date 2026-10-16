import { type AuthorProfile, type FetchLike, fetchAuthorProfile } from './author-profile';

export type AuthSession = { user: { email: string }; mode: 'local' | 'access' };

export type AdminSession = AuthSession & {
  user: AuthSession['user'] & { name: string | null; avatar: string | null };
};

export async function enrichSession(session: AuthSession, fetchFn?: FetchLike): Promise<AdminSession> {
  const profile: AuthorProfile = await fetchAuthorProfile(session.user.email, fetchFn);
  return {
    ...session,
    user: {
      ...session.user,
      name: profile.name,
      avatar: profile.avatar,
    },
  };
}
