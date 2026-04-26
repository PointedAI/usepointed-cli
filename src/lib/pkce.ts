import * as crypto from "node:crypto";

/**
 * Generates a cryptographically random code verifier for PKCE (RFC 7636).
 * 32 random bytes encoded as base64url produces a 43-character verifier.
 */
export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Computes the S256 code challenge from a code verifier.
 * challenge = BASE64URL(SHA256(verifier))
 */
export function generateCodeChallenge(verifier: string): string {
  const hash = crypto.createHash("sha256").update(verifier).digest();
  return hash.toString("base64url");
}

/**
 * Generates a cryptographically random state parameter.
 */
export function generateState(): string {
  return crypto.randomBytes(16).toString("base64url");
}
