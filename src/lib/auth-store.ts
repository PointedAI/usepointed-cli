import { readPrivateState, writePrivateState, removePrivateState } from "./private-files.js";
import * as path from "node:path";
import * as os from "node:os";

export interface StoredCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType: "oauth";
}

const CREDENTIALS_DIR = path.join(os.homedir(), ".pointed");
const CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, "credentials.json");

export function loadCredentials(): StoredCredentials | null {
  const raw = readPrivateState(CREDENTIALS_FILE);
  if (raw === null) return null;
  try { return JSON.parse(raw) as StoredCredentials; }
  catch { return null; }
}

export function saveCredentials(credentials: StoredCredentials): void {
  writePrivateState(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2));
}

export function clearCredentials(): void {
  removePrivateState(CREDENTIALS_FILE);
}

/**
 * Returns a valid Bearer token for API requests.
 * Checks for POINTED_API_KEY env var first (agent mode),
 * then falls back to stored OAuth credentials.
 */
export function getAuthToken(): string | null {
  const apiKey = process.env["POINTED_API_KEY"];
  if (apiKey) return apiKey;

  const creds = loadCredentials();
  if (!creds) return null;

  // Check if token is expired (with 60s buffer)
  if (Date.now() >= creds.expiresAt - 60_000) {
    return null;
  }

  return creds.accessToken;
}

export function isTokenExpired(): boolean {
  const creds = loadCredentials();
  if (!creds) return true;
  return Date.now() >= creds.expiresAt - 60_000;
}
