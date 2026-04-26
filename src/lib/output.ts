import { getOutputFormat } from "./config.js";

/**
 * Prints data to stdout. In JSON mode (default), outputs
 * machine-readable JSON. Table mode is intended for interactive use.
 */
export function printJson(data: unknown): void {
  if (getOutputFormat() === "table") {
    if (Array.isArray(data)) {
      console.table(data);
      return;
    }
    if (data && typeof data === "object") {
      console.table([data]);
      return;
    }
    console.log(String(data));
    return;
  }

  console.log(JSON.stringify(data, null, 2));
}

export function printError(message: string): void {
  console.error(`Error: ${message}`);
}

export function printSuccess(message: string): void {
  console.log(message);
}
