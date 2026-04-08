import { getSession } from "./session";

export interface AuthUser {
  did: string;
  handle: string;
  avatar?: string;
}

export async function getAuthUser(): Promise<AuthUser | null> {
  const session = await getSession();
  if (!session) return null;

  try {
    const profile = await session.agent.getProfile({
      actor: session.did,
    });
    return {
      did: session.did,
      handle: profile.data.handle,
      avatar: profile.data.avatar,
    };
  } catch {
    return { did: session.did, handle: session.did };
  }
}
