import * as http from "node:http";
import * as url from "node:url";

export interface CallbackResult {
  code: string;
  state: string;
}

const CALLBACK_HTML = `<!DOCTYPE html>
<html>
<head><title>Pointed CLI</title></head>
<body style="font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
  <div style="text-align: center;">
    <h2>Authentication successful</h2>
    <p>You can close this tab and return to the terminal.</p>
  </div>
</body>
</html>`;

const ERROR_HTML = `<!DOCTYPE html>
<html>
<head><title>Pointed CLI</title></head>
<body style="font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
  <div style="text-align: center;">
    <h2>Authentication failed</h2>
    <p>Please try again from the terminal.</p>
  </div>
</body>
</html>`;

/**
 * Starts a local HTTP server to receive the OAuth callback.
 * Returns a promise that resolves with the authorization code and state.
 */
export function startCallbackServer(
  port: number,
): Promise<{ server: http.Server; result: Promise<CallbackResult> }> {
  return new Promise((resolveServer) => {
    let resolveResult: (value: CallbackResult) => void;
    let rejectResult: (reason: Error) => void;

    const result = new Promise<CallbackResult>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });

    const server = http.createServer((req, res) => {
      if (!req.url?.startsWith("/callback")) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const parsed = url.parse(req.url, true);
      const code = parsed.query["code"];
      const state = parsed.query["state"];
      const error = parsed.query["error"];

      if (error) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(ERROR_HTML);
        rejectResult(
          new Error(
            `OAuth error: ${error} - ${parsed.query["error_description"] ?? ""}`,
          ),
        );
        return;
      }

      if (typeof code !== "string" || typeof state !== "string") {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(ERROR_HTML);
        rejectResult(new Error("Missing code or state in callback"));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(CALLBACK_HTML);
      resolveResult({ code, state });
    });

    server.listen(port, "127.0.0.1", () => {
      resolveServer({ server, result });
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      rejectResult(new Error("Login timed out after 2 minutes"));
      server.close();
    }, 120_000);
  });
}
