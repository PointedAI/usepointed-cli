import { getAuthToken } from "./auth-store.js";
import { getApiBaseUrl } from "./config.js";

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  meta?: Record<string, unknown>;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiResponse<unknown>,
  ) {
    super(body.error ?? `API request failed with status ${status}`);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  queryParams?: Record<string, string>,
): Promise<ApiResponse<T>> {
  const token = getAuthToken();
  if (!token) {
    throw new Error(
      "Not authenticated. Run `pointed auth login` or set POINTED_API_KEY.",
    );
  }

  const baseUrl = getApiBaseUrl();
  const url = new URL(`${baseUrl}/api/cli/v1${path}`);
  if (queryParams) {
    for (const [key, value] of Object.entries(queryParams)) {
      url.searchParams.set(key, value);
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = (await response.json()) as ApiResponse<T>;

  if (!response.ok) {
    throw new ApiError(response.status, json);
  }

  return json;
}
