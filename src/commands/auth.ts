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
import {
  discoverEndpoints,
  resolveClient,
  type OAuthClient,
  type OAuthOptions,
} from "../lib/oauth-client.js";

const CALLBACK_PORT = 3100;
const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}/callback`;

const OAUTH_SCOPES = "openid profile email offline_access user:org:read pointed:read pointed:write pointed:evidence pointed:setup";

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  id_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

async function exchangeCodeForTokens(
  tokenEndpoint: string,
  code: string,
  codeVerifier: string,
  client: OAuthClient,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: client.clientId,
    code_verifier: codeVerifier,
    resource: client.resource,
  });

  const response = await fetch(tokenEndpoint, {
    method: "POST",
    redirect: "error",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed (${response.status}).`);
  }

  return (await response.json()) as TokenResponse;
}

export function createAuthCommand(openBrowser: typeof open = open): Command {
  const auth = new Command("auth").description(
    "Authenticate with the Pointed API",
  );

  auth
    .command("login")
    .description("Log in via browser (OAuth + PKCE)")
    .option("--admin", "Request platform administrator permissions")
    .option("--issuer <url>", "Override the Pointed OAuth issuer", process.env.POINTED_OAUTH_ISSUER)
    .option("--clerk-domain <url>", "Use a legacy Clerk issuer", process.env.CLERK_FRONTEND_API_URL)
    .action(async (options: OAuthOptions & { admin?: boolean }) => {
      let closeCallbackServer: (() => void) | undefined;
      try {
        console.log("Discovering OAuth endpoints...");
        const client = await resolveClient(options);
        const endpoints = await discoverEndpoints(client.issuer);

        // 2. Generate PKCE parameters
        const codeVerifier = generateCodeVerifier();
        const codeChallenge = generateCodeChallenge(codeVerifier);
        const state = generateState();

        // 3. Start local callback server
        const { server, result } = await startCallbackServer(CALLBACK_PORT, state);
        closeCallbackServer = () => {
          try {
            server.close();
          } catch {
            // The callback server may already be closed after errors or timeouts.
          }
        };

        // 4. Build authorization URL
        const authUrl = new URL(endpoints.authorization);
        authUrl.searchParams.set("response_type", "code");
        authUrl.searchParams.set("client_id", client.clientId);
        authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
        authUrl.searchParams.set("scope", options.admin ? `${OAUTH_SCOPES} pointed:admin` : OAUTH_SCOPES);
        authUrl.searchParams.set("resource", client.resource);
        authUrl.searchParams.set("state", state);
        authUrl.searchParams.set("code_challenge", codeChallenge);
        authUrl.searchParams.set("code_challenge_method", "S256");

        // 5. Open browser
        console.log("Opening browser for authentication...");
        await openBrowser(authUrl.toString());
        console.log(
          "Waiting for authentication (press Ctrl+C to cancel)...\n",
        );
        printSuccess(`If the browser didn't open, visit: ${authUrl.toString()}`);

        // 6. Wait for callback
        const callback = await result;

        // 7. Verify state
        if (callback.state !== state) {
          throw new Error("State mismatch — possible CSRF attack");
        }

        // 8. Exchange code for tokens
        console.log("Exchanging authorization code for tokens...");
        const tokens = await exchangeCodeForTokens(
          endpoints.token,
          callback.code,
          codeVerifier,
          client,
        );

        // 9. Store credentials
        saveCredentials({
          ...client,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: Date.now() + tokens.expires_in * 1000,
          tokenType: "oauth",
        });
        ensureConfigFile();

        // 10. Shut down server
        closeCallbackServer();
        closeCallbackServer = undefined;

        printSuccess("Logged in successfully.");
      } catch (error) {
        closeCallbackServer?.();
        closeCallbackServer = undefined;
        printError(
          error instanceof Error ? error.message : "Login failed",
        );
        process.exit(1);
      } finally {
        closeCallbackServer?.();
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
    .option("--issuer <url>", "Override the Pointed OAuth issuer", process.env.POINTED_OAUTH_ISSUER)
    .option("--clerk-domain <url>", "Use a legacy Clerk issuer", process.env.CLERK_FRONTEND_API_URL)
    .action(async (options: OAuthOptions) => {
      const { loadCredentials } = await import("../lib/auth-store.js");
      const creds = loadCredentials();
      if (!creds || !creds.refreshToken) {
        printError("No stored credentials. Run `pointed auth login` first.");
        process.exit(1);
      }

      try {
        const client = await resolveClient(options);
        if (
          creds.issuer !== client.issuer ||
          creds.clientId !== client.clientId ||
          creds.resource !== client.resource
        ) {
          throw new Error("Run pointed auth login to reconnect your account to this Pointed environment.");
        }
        const endpoints = await discoverEndpoints(client.issuer);

        const body = new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: creds.refreshToken,
          resource: client.resource,
          client_id: client.clientId,
        });

        const response = await fetch(endpoints.token, {
          method: "POST",
          redirect: "error",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        });

        if (!response.ok) {
          throw new Error(`Token refresh failed (${response.status}). Run pointed auth login again.`);
        }

        const tokens = (await response.json()) as TokenResponse;
        saveCredentials({
          ...client,
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
