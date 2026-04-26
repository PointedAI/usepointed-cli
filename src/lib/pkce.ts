import * as crypto from "node:crypto";

/**
 * Generates a cryptographically random code verifier for PKCE (RFC 7636).
 * Length: 43-128 characters from the unreserved character set.
 */
export function generateCodeVerifier(): string {
  const buffer = crypto.randomBytes(32);
  return buffer
    .toString("base64url")
    .replace(/[^a-zA-Z0-9\-._~]/g, "")
    .slice(0, 64);
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
