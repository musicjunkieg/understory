import { NodeOAuthClient } from "@atproto/oauth-client-node";
import type {
  NodeSavedState,
  NodeSavedSession,
} from "@atproto/oauth-client-node";
import { buildClientMetadata } from "./metadata";

const stateStore = new Map<string, NodeSavedState>();
const sessionStore = new Map<string, NodeSavedSession>();

// Single-process request lock: serializes access to a given key (e.g. a
// session DID) so concurrent token refreshes never race. Without this,
// @atproto/oauth-client-node prints
//   "No lock mechanism provided. Credentials might get revoked."
// and two in-flight requests for the same user can both try to rotate the
// refresh token — the losing request has its credentials invalidated and
// the next AppView call returns 500 through the PDS proxy. (That was the
// original root cause of the network-attention regression on staging.)
//
// Implementation per @atproto/oauth-client-node docs: a Map of per-key
// promise chains. `fn` runs only after the previous holder releases, and
// `releaseLock` is always called in finally so a thrown `fn` doesn't wedge
// the chain for subsequent waiters.
const locks = new Map<string, Promise<void>>();
async function requestLock<T>(
  key: string,
  fn: () => T | PromiseLike<T>,
): Promise<T> {
  const prevLock = locks.get(key) ?? Promise.resolve();
  let releaseLock!: () => void;
  const currentLock = prevLock.then(
    () =>
      new Promise<void>((resolve) => {
        releaseLock = resolve;
      }),
  );
  locks.set(key, currentLock);
  try {
    await currentLock;
    return await fn();
  } finally {
    releaseLock();
    // If this was the last waiter, drop the map entry so it doesn't leak
    // across long-running processes. Comparing by reference is safe: a new
    // waiter would have replaced the entry before we got here.
    if (locks.get(key) === currentLock) {
      locks.delete(key);
    }
  }
}

function createClient(): NodeOAuthClient {
  const appUrl = process.env.APP_URL;

  if (!appUrl) {
    throw new Error(
      "Missing APP_URL environment variable. " +
        "Set to your app's public URL (e.g., https://understory.watch).",
    );
  }

  return new NodeOAuthClient({
    clientMetadata: buildClientMetadata(appUrl),
    requestLock,
    stateStore: {
      async get(key: string) {
        return stateStore.get(key);
      },
      async set(key: string, value: NodeSavedState) {
        stateStore.set(key, value);
      },
      async del(key: string) {
        stateStore.delete(key);
      },
    },
    sessionStore: {
      async get(sub: string) {
        return sessionStore.get(sub);
      },
      async set(sub: string, value: NodeSavedSession) {
        sessionStore.set(sub, value);
      },
      async del(sub: string) {
        sessionStore.delete(sub);
      },
    },
  });
}

// Cache on globalThis to survive Next.js hot reload
declare global {
  var __oauthClient: NodeOAuthClient | undefined;
}

export function getOAuthClient(): NodeOAuthClient {
  if (!globalThis.__oauthClient) {
    globalThis.__oauthClient = createClient();
  }
  return globalThis.__oauthClient;
}
