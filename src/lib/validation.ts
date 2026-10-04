import { InvalidArgumentError } from "commander";

/** Keep an opaque ID within one URL segment, including after URL normalization. */
export function encodeId(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(
      "Invalid ID: use only letters, numbers, underscores, and hyphens",
    );
  }
  return encodeURIComponent(value);
}

export function parseContractValue(value: string): number {
  const input = value.trim();
  const parsed = Number(input);
  if (
    !/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(input) ||
    !Number.isFinite(parsed) ||
    parsed < 0
  ) {
    throw new InvalidArgumentError(
      "Expected a finite, non-negative number without separators",
    );
  }
  return parsed;
}

export function parsePositiveInteger(value: string): number {
  const input = value.trim();
  const parsed = Number(input);
  if (!/^\d+$/.test(input) || !Number.isSafeInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError("Expected a positive safe integer");
  }
  return parsed;
}

export function parseContactSelector(value: string, option: string): string[] {
  const items = value.split(",").map((item) => item.trim());
  if (items.some((item) => item.length === 0)) {
    throw new Error(
      `${option} must contain a non-empty comma-separated list without empty entries`,
    );
  }
  return items;
}
