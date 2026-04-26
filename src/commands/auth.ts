import { Command } from "commander";
import open from "open";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
} from "../lib/pkce.js";
import { startCallbackServer } from "../lib/oauth-callback-server.js";
import {
  saveCredentials,
  clearCredentials,
  getAuthToken,
} from "../lib/auth-store.js";
import { ensureConfigFile, getApiBaseUrl } from "../lib/config.js";
import { printJson, printError, printSuccess } from "../lib/output.js";

/**
 * The Clerk OAuth Application client ID (public — safe to embed).
 * This is the public client registered for the Pointed CLI.
 * Defaults to production; override with CLERK_OAUTH_CLIENT_ID env var for dev.
 */
const CLERK_OAUTH_CLIENT_ID =
  process.env["CLERK_OAUTH_CLIENT_ID"] ?? "qxCPM9BP0iFSRK9D";
const DEFAULT_CLERK_FRONTEND_API_URL = "https://clerk.usepointed.ai";

/**
 * Port for the local OAuth callback server.
 * Must match a redirect URI registered in the Clerk OAuth Application.
 */
const CALLBACK_PORT = 3100;
const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}/callback`;

/**
 * Scopes to request from Clerk's OAuth server.
 */
const OAUTH_SCOPES = "openid profile email public_metadata";

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  id_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

interface OAuthServerMetadata {
  authorization_endpoint: string;
  token_endpoint: string;
  issuer: string;
}

async function discoverOAuthEndpoints(
  clerkDomain: string,
): Promise<OAuthServerMetadata> {
  const metadataUrl = `${clerkDomain}/.well-known/oauth-authorization-server`;
  const response = await fetch(metadataUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to discover OAuth endpoints from ${metadataUrl}: ${response.status}`,
    );
  }
  return (await response.json()) as OAuthServerMetadata;
}

async function exchangeCodeForTokens(
  tokenEndpoint: string,
  code: string,
  codeVerifier: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLERK_OAUTH_CLIENT_ID,
    code_verifier: codeVerifier,
  });

  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${text}`);
  }

  return (await response.json()) as TokenResponse;
}

export function createAuthCommand(): Command {
  const auth = new Command("auth").description(
    "Authenticate with the Pointed API",
  );

  auth
    .command("login")
    .description("Log in via browser (OAuth + PKCE)")
    .option(
      "--clerk-domain <url>",
      "Clerk Frontend API URL",
      process.env["CLERK_FRONTEND_API_URL"] ?? DEFAULT_CLERK_FRONTEND_API_URL,
    )
    .action(async (options: { clerkDomain?: string }) => {
      const clerkDomain = options.clerkDomain;
      if (!clerkDomain) {
        printError(
          "Clerk domain is required. Set CLERK_FRONTEND_API_URL or pass --clerk-domain.",
        );
        process.exit(1);
      }

      try {
        // 1. Discover OAuth endpoints
        console.log("Discovering OAuth endpoints...");
        const metadata = await discoverOAuthEndpoints(clerkDomain);

        // 2. Generate PKCE parameters
        const codeVerifier = generateCodeVerifier();
        const codeChallenge = generateCodeChallenge(codeVerifier);
        const state = generateState();

        // 3. Start local callback server
        const { server, result } = await startCallbackServer(CALLBACK_PORT);

        // 4. Build authorization URL
        const authUrl = new URL(metadata.authorization_endpoint);
        authUrl.searchParams.set("response_type", "code");
        authUrl.searchParams.set("client_id", CLERK_OAUTH_CLIENT_ID);
        authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
        authUrl.searchParams.set("scope", OAUTH_SCOPES);
        authUrl.searchParams.set("state", state);
        authUrl.searchParams.set("code_challenge", codeChallenge);
        authUrl.searchParams.set("code_challenge_method", "S256");

        // 5. Open browser
        console.log("Opening browser for authentication...");
        await open(authUrl.toString());
        console.log(
          "Waiting for authentication (press Ctrl+C to cancel)...\n",
        );
        console.log(
          `If the browser didn't open, visit:\n${authUrl.toString()}\n`,
        );

        // 6. Wait for callback
        const callback = await result;

        // 7. Verify state
        if (callback.state !== state) {
          throw new Error("State mismatch — possible CSRF attack");
        }

        // 8. Exchange code for tokens
        console.log("Exchanging authorization code for tokens...");
        const tokens = await exchangeCodeForTokens(
          metadata.token_endpoint,
          callback.code,
          codeVerifier,
        );

        // 9. Store credentials
        saveCredentials({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: Date.now() + tokens.expires_in * 1000,
          tokenType: "oauth",
        });
        ensureConfigFile();

        // 10. Shut down server
        server.close();

        printSuccess("Logged in successfully.");
      } catch (error) {
        printError(
          error instanceof Error ? error.message : "Login failed",
        );
        process.exit(1);
      }
    });

  auth
    .command("logout")
    .description("Clear stored credentials")
    .action(() => {
      clearCredentials();
      printSuccess("Logged out. Credentials cleared.");
    });

  auth
    .command("whoami")
    .description("Show current authentication status")
    .action(async () => {
      const token = getAuthToken();
      if (!token) {
        printError(
          "Not authenticated. Run `pointed auth login` or set POINTED_API_KEY.",
        );
        process.exit(1);
      }

      try {
        const baseUrl = getApiBaseUrl();
        const response = await fetch(`${baseUrl}/api/cli/v1/auth/whoami`, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
        });

        let json: { data?: unknown; error?: string };
        try {
          json = (await response.json()) as { data?: unknown; error?: string };
        } catch {
          if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}`);
          }
          throw new Error("Failed to parse response as JSON");
        }

        if (!response.ok) {
          throw new Error(json.error ?? `Request failed with status ${response.status}`);
        }

        if (json.error) {
          throw new Error(json.error);
        }

        printJson(json.data);
      } catch (error) {
        printError(
          error instanceof Error ? error.message : "Failed to verify auth",
        );
        process.exit(1);
      }
    });

  auth
    .command("refresh")
    .description("Refresh the OAuth access token")
    .option(
      "--clerk-domain <url>",
      "Clerk Frontend API URL",
      process.env["CLERK_FRONTEND_API_URL"] ?? DEFAULT_CLERK_FRONTEND_API_URL,
    )
    .action(async (options: { clerkDomain?: string }) => {
      const clerkDomain = options.clerkDomain;
      if (!clerkDomain) {
        printError(
          "Clerk domain is required. Set CLERK_FRONTEND_API_URL or pass --clerk-domain.",
        );
        process.exit(1);
      }

      const { loadCredentials } = await import("../lib/auth-store.js");
      const creds = loadCredentials();
      if (!creds || !creds.refreshToken) {
        printError("No stored credentials. Run `pointed auth login` first.");
        process.exit(1);
      }

      try {
        const metadata = await discoverOAuthEndpoints(clerkDomain);

        const body = new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: creds.refreshToken,
          client_id: CLERK_OAUTH_CLIENT_ID,
        });

        const response = await fetch(metadata.token_endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Token refresh failed (${response.status}): ${text}`);
        }

        const tokens = (await response.json()) as TokenResponse;
        saveCredentials({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || creds.refreshToken,
          expiresAt: Date.now() + tokens.expires_in * 1000,
          tokenType: "oauth",
        });

        printSuccess("Token refreshed successfully.");
      } catch (error) {
        printError(
          error instanceof Error ? error.message : "Token refresh failed",
        );
        process.exit(1);
      }
    });

  return auth;
}
