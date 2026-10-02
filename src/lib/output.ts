import { getOutputFormat } from "./config.js";

/** Human-readable text cannot control the terminal or forge another line. */
export function terminalText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
    character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function terminalData(value: unknown): unknown {
  if (typeof value === "string") return terminalText(value);
  if (Array.isArray(value)) return value.map(terminalData);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [terminalText(key), terminalData(entry)]));
  return value;
}

/** JSON values remain unchanged; unsafe Unicode controls use JSON escapes. */
export function printJson(data: unknown): void {
  if (getOutputFormat() === "table") {
    const safe = terminalData(data);
    if (Array.isArray(safe)) console.table(safe);
    else if (safe && typeof safe === "object") console.table([safe]);
    else console.log(terminalText(String(safe)));
    return;
  }
  const serialized = JSON.stringify(data, null, 2);
  console.log(serialized?.replace(/[\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
    character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`));
}

export function printError(message: string): void {
  console.error(`Error: ${terminalText(message)}`);
}

export function printWarning(message: string): void {
  console.error(terminalText(message));
}

export function printSuccess(message: string): void {
  console.log(terminalText(message));
}
