import { getApiBaseUrl } from "./config.js";

const legacyIssuer = "https://clerk.usepointed.ai";
const legacyClientId = "qxCPM9BP0iFSRK9D";
const productionOrigin = "https://app.usepointed.ai";

export type OAuthOptions = { issuer?: string; clerkDomain?: string };
export type OAuthClient = { issuer: string; clientId: string; resource: string };

function issuerOrigin(value: unknown): string {
  if (typeof value !== "string") throw new Error("Missing OAuth issuer.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== value.replace(/\/$/, "")) {
    throw new Error("The OAuth issuer must be an HTTPS origin.");
  }
  return url.origin;
}

export async function resolveClient(options: OAuthOptions): Promise<OAuthClient> {
  const api = new URL(getApiBaseUrl());
  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(api.hostname);
  const secureTransport = api.protocol === "https:" || (isLoopback && api.protocol === "http:");
  if (!secureTransport || api.username || api.password) {
    throw new Error("Use an HTTPS Pointed API or a local development server.");
  }

  const resource = new URL("/api/cli", api).href;
  if (options.issuer) {
    const clientId = process.env.POINTED_CLI_OAUTH_CLIENT_ID?.trim();
    if (!clientId) throw new Error("Set POINTED_CLI_OAUTH_CLIENT_ID for the selected issuer.");
    return { issuer: issuerOrigin(options.issuer), clientId, resource };
  }

  const clerkClientId = process.env.CLERK_OAUTH_CLIENT_ID || legacyClientId;
  if (options.clerkDomain) {
    return { issuer: issuerOrigin(options.clerkDomain), clientId: clerkClientId, resource };
  }

  const response = await fetch(new URL("/api/cli/v1/auth/config", api), { redirect: "error" });
  // The original production deployment used this public Clerk client before it
  // served discovery. Any other missing or unavailable configuration is an error.
  if (response.status === 404 && api.origin === productionOrigin) {
    return { issuer: legacyIssuer, clientId: clerkClientId, resource };
  }
  if (!response.ok) {
    throw new Error(`Pointed login configuration is unavailable (${response.status}).`);
  }

  const config = await response.json() as { issuer?: unknown; clientId?: unknown };
  if (typeof config.clientId !== "string" || !config.clientId.trim()) {
    throw new Error("Missing Pointed OAuth client ID.");
  }
  return { issuer: issuerOrigin(config.issuer), clientId: config.clientId.trim(), resource };
}

export async function discoverEndpoints(issuer: string) {
  const url = new URL("/.well-known/oauth-authorization-server", issuer);
  const response = await fetch(url, { redirect: "error" });
  if (!response.ok) throw new Error(`OAuth discovery failed (${response.status}).`);

  const metadata = await response.json() as {
    issuer?: unknown;
    authorization_endpoint?: unknown;
    token_endpoint?: unknown;
  };
  if (metadata.issuer !== issuer) throw new Error("OAuth discovery returned a different issuer.");

  function endpoint(value: unknown): string {
    if (typeof value !== "string") throw new Error("Missing OAuth endpoint.");
    const url = new URL(value);
    if (url.origin !== issuer || url.username || url.password || url.hash) {
      throw new Error("Invalid OAuth endpoint for the configured issuer.");
    }
    return url.href;
  }

  return {
    authorization: endpoint(metadata.authorization_endpoint),
    token: endpoint(metadata.token_endpoint),
  };
}
