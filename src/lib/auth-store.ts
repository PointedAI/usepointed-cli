import * as fs from "node:fs";
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

function ensureDir(): void {
  if (!fs.existsSync(CREDENTIALS_DIR)) {
    fs.mkdirSync(CREDENTIALS_DIR, { recursive: true, mode: 0o700 });
  }
}

export function loadCredentials(): StoredCredentials | null {
  try {
    if (fs.existsSync(CREDENTIALS_FILE)) {
      const raw = fs.readFileSync(CREDENTIALS_FILE, "utf-8");
      return JSON.parse(raw) as StoredCredentials;
    }
  } catch {
    // Corrupt or unreadable file
  }
  return null;
}

export function saveCredentials(credentials: StoredCredentials): void {
  ensureDir();
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2), {
    mode: 0o600,
  });
}

export function clearCredentials(): void {
  try {
    if (fs.existsSync(CREDENTIALS_FILE)) {
      fs.unlinkSync(CREDENTIALS_FILE);
    }
  } catch {
    // Ignore errors during cleanup
  }
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
