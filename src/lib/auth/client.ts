import { NodeOAuthClient } from "@atproto/oauth-client-node";
import type {
  NodeSavedState,
  NodeSavedSession,
} from "@atproto/oauth-client-node";
import { buildClientMetadata } from "./metadata";

const stateStore = new Map<string, NodeSavedState>();
const sessionStore = new Map<string, NodeSavedSession>();

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
