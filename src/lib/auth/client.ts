import { NodeOAuthClient } from "@atproto/oauth-client-node";
import type {
  NodeSavedState,
  NodeSavedSession,
} from "@atproto/oauth-client-node";

const stateStore = new Map<string, NodeSavedState>();
const sessionStore = new Map<string, NodeSavedSession>();

function createClient(): NodeOAuthClient {
  const clientId = process.env.OAUTH_CLIENT_ID;
  const appUrl = process.env.APP_URL;

  if (!clientId || !appUrl) {
    throw new Error(
      "Missing OAUTH_CLIENT_ID or APP_URL environment variables. " +
        "See docs/superpowers/specs/2026-04-06-oauth.md for setup instructions.",
    );
  }

  return new NodeOAuthClient({
    clientMetadata: {
      client_id: clientId,
      client_name: "Understory (Development)",
      client_uri: appUrl,
      redirect_uris: [`${appUrl}/oauth/callback`],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "atproto transition:generic",
      application_type: "web",
      dpop_bound_access_tokens: true,
      token_endpoint_auth_method: "none",
    },
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
