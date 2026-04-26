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
    Accept: "application/json",
  };
  const requestBody = body === undefined ? undefined : JSON.stringify(body);
  if (requestBody !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    method,
    headers,
    body: requestBody,
  });

  const json = await parseApiResponse<T>(response);

  if (!response.ok) {
    throw new ApiError(response.status, json);
  }

  return json;
}

async function parseApiResponse<T>(response: Response): Promise<ApiResponse<T>> {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text) as ApiResponse<T>;
  } catch {
    if (!response.ok) {
      return {
        error: text || `API request failed with status ${response.status}`,
      };
    }

    throw new Error(
      `Expected JSON response from API but received non-JSON status ${response.status}`,
    );
  }
}
