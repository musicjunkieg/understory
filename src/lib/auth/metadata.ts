/**
 * Shared AT Protocol OAuth client metadata builder.
 *
 * Used by both the client-metadata.json route handler (serves the metadata
 * to PDS servers during the OAuth flow) and the NodeOAuthClient constructor
 * (uses the metadata locally for the authorization handshake). Defined once
 * here so the two can never drift — drift causes cryptic OAuth mismatch errors.
 */

export const CLIENT_METADATA_PATH = "/oauth/client-metadata.json";

/**
 * Granular OAuth scopes for Understory. Replaces the overpermissioned
 * `transition:generic` transitional scope with the minimum permissions
 * the app actually needs:
 *
 * - `atproto` — required for all AT Protocol OAuth sessions (identity)
 * - `rpc:app.bsky.actor.getProfile?aud=*` — resolve the user's display name + avatar
 * - `rpc:app.bsky.graph.getFollows?aud=*` — read the user's follows
 * - `rpc:app.bsky.feed.searchPosts?aud=*` — search for conference posts
 *
 * Understory never writes records, so no write scopes are requested.
 * The `?aud=*` suffix allows the call to be proxied to any AppView service.
 */
export const OAUTH_SCOPE = [
  "atproto",
  "rpc:app.bsky.actor.getProfile?aud=*",
  "rpc:app.bsky.graph.getFollows?aud=*",
  "rpc:app.bsky.feed.searchPosts?aud=*",
].join(" ");

// SDK-required literal union types for tuple-validated fields.
type GrantType =
  | "authorization_code"
  | "implicit"
  | "refresh_token"
  | "password"
  | "client_credentials"
  | "urn:ietf:params:oauth:grant-type:jwt-bearer"
  | "urn:ietf:params:oauth:grant-type:saml2-bearer";

type ResponseType =
  | "code"
  | "none"
  | "token"
  | "code id_token token"
  | "code id_token"
  | "code token"
  | "id_token token"
  | "id_token";

export function buildClientMetadata(appUrl: string) {
  const clientId = `${appUrl}${CLIENT_METADATA_PATH}`;
  return {
    client_id: clientId,
    client_name: "Understory",
    client_uri: appUrl,
    redirect_uris: [`${appUrl}/oauth/callback`] as [string, ...string[]],
    grant_types: ["authorization_code", "refresh_token"] as [
      GrantType,
      ...GrantType[],
    ],
    response_types: ["code"] as [ResponseType, ...ResponseType[]],
    scope: OAUTH_SCOPE,
    application_type: "web" as const,
    dpop_bound_access_tokens: true,
    token_endpoint_auth_method: "none" as const,
  };
}
