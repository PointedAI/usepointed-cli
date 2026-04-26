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
  return new Promise((resolveServer, rejectServer) => {
    let resolveResult: (value: CallbackResult) => void;
    let rejectResult: (reason: Error) => void;
    let serverStarted = false;
    let resultSettled = false;

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
        settleResult(
          () =>
            rejectResult(
              new Error(
                `OAuth error: ${error} - ${parsed.query["error_description"] ?? ""}`,
              ),
            ),
          true,
        );
        return;
      }

      if (typeof code !== "string" || typeof state !== "string") {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end(ERROR_HTML);
        settleResult(
          () => rejectResult(new Error("Missing code or state in callback")),
          true,
        );
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(CALLBACK_HTML);
      settleResult(() => resolveResult({ code, state }), true);
    });

    // Timeout after 2 minutes
    const timeout = setTimeout(() => {
      settleResult(
        () => rejectResult(new Error("Login timed out after 2 minutes")),
        true,
      );
    }, 120_000);
    timeout.unref();

    function settleResult(settle: () => void, closeAfterSettling = false): void {
      if (resultSettled) return;
      resultSettled = true;
      clearTimeout(timeout);
      settle();
      if (closeAfterSettling) {
        closeServer();
      }
    }

    function closeServer(): void {
      try {
        server.close();
      } catch {
        // The caller may also close the server after a successful callback.
      }
    }

    server.on("error", (error) => {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));
      if (!serverStarted) {
        resultSettled = true;
        clearTimeout(timeout);
        rejectServer(normalizedError);
        return;
      }

      settleResult(() => rejectResult(normalizedError), true);
    });

    server.listen(port, "127.0.0.1", () => {
      serverStarted = true;
      resolveServer({ server, result });
    });
  });
}
