/**
 * The API client.
 *
 * One place that knows how to talk to the server: it attaches the access token, refreshes
 * it transparently when it expires, and turns an error body into a typed `ApiError` so the
 * UI can react to a specific code rather than matching on a message.
 *
 * The refresh token lives in an httpOnly cookie; this module never sees it. The access
 * token is kept in memory only, so a cross-site script cannot read it out of storage.
 */
import type { ApiErrorBody, ErrorCode, LoginResponse } from '@ekavist/shared';

const BASE_URL = `${(import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '')}/api/v1`;

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: { path: string; message: string }[];
  readonly requestId: string | null;

  constructor(
    code: ErrorCode,
    message: string,
    status: number,
    details: { path: string; message: string }[] = [],
    requestId: string | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.requestId = requestId;
  }

  /** The message for a specific field, so a form can show it next to the input. */
  fieldError(path: string): string | undefined {
    return this.details.find((detail) => detail.path === path)?.message;
  }
}

let accessToken: string | null = null;
let onUnauthenticated: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Called when the session cannot be recovered, so the app can return to the login screen. */
export function setUnauthenticatedHandler(handler: () => void): void {
  onUnauthenticated = handler;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null | string[]>;
  signal?: AbortSignal;
  /** Internal: prevents a refresh loop when the refresh call itself fails. */
  skipRefresh?: boolean;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(`${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`);
  if (query != null) {
    for (const [key, value] of Object.entries(query)) {
      if (value == null || value === '') continue;
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, item);
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

/**
 * A single in-flight refresh is shared by every request that hits a 401 at the same time,
 * so a page with six panels does not fire six refreshes and invalidate its own token.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const response = await fetch(buildUrl('/auth/refresh'), {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) return false;
      const data = (await response.json()) as LoginResponse;
      accessToken = data.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      // Cleared on the next tick so concurrent callers all observe the same result.
      queueMicrotask(() => {
        refreshInFlight = null;
      });
    }
  })();

  return refreshInFlight;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, signal, skipRefresh } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken != null) headers.Authorization = `Bearer ${accessToken}`;

  const response = await fetch(buildUrl(path, query), {
    method,
    headers,
    credentials: 'include',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...(signal != null ? { signal } : {}),
  });

  if (response.status === 401 && !skipRefresh) {
    const recovered = await refreshSession();
    if (recovered) {
      return request<T>(path, { ...options, skipRefresh: true });
    }
    accessToken = null;
    onUnauthenticated?.();
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const payload: unknown = text.length > 0 ? safeParse(text) : undefined;

  if (!response.ok) {
    throw toApiError(payload, response.status);
  }

  return payload as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function toApiError(payload: unknown, status: number): ApiError {
  const body = payload as ApiErrorBody | undefined;
  if (body?.error?.code != null) {
    return new ApiError(
      body.error.code,
      body.error.message,
      status,
      body.error.details ?? [],
      body.requestId ?? null,
    );
  }
  return new ApiError(
    'INTERNAL_ERROR',
    status === 0
      ? 'Could not reach the server. Check your connection and try again.'
      : 'Something went wrong. Please try again.',
    status,
  );
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query'], signal?: AbortSignal) =>
    request<T>(path, { method: 'GET', ...(query ? { query } : {}), ...(signal ? { signal } : {}) }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', body }),
};

/** Sends a multipart form, such as a workbook for the Excel importer. */
export async function upload<T>(path: string, form: FormData): Promise<T> {
  const send = () =>
    fetch(buildUrl(path), {
      method: 'POST',
      headers: accessToken != null ? { Authorization: `Bearer ${accessToken}` } : {},
      credentials: 'include',
      body: form,
    });

  let response = await send();
  if (response.status === 401 && (await refreshSession())) response = await send();
  const text = await response.text();
  const payload: unknown = text.length > 0 ? safeParse(text) : undefined;
  if (!response.ok) throw toApiError(payload, response.status);
  return payload as T;
}

/**
 * Downloads a file the API generates, such as a CSV export.
 *
 * A plain link cannot carry the access token, so the file is fetched with it and handed
 * to the browser as a blob. The server's file name is used when it sends one.
 */
export async function download(
  path: string,
  query?: RequestOptions['query'],
  fallbackName = 'export.csv',
): Promise<void> {
  const fetchOnce = () =>
    fetch(buildUrl(path, query), {
      headers: accessToken != null ? { Authorization: `Bearer ${accessToken}` } : {},
      credentials: 'include',
    });

  let response = await fetchOnce();
  if (response.status === 401 && (await refreshSession())) response = await fetchOnce();
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => undefined);
    throw toApiError(payload, response.status);
  }

  const disposition = response.headers.get('Content-Disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Login and refresh bypass the token plumbing above, so they are separate. */
export async function login(
  email: string,
  password: string,
  code?: string,
): Promise<LoginResponse> {
  const response = await fetch(buildUrl('/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email, password, ...(code != null && code !== '' ? { code } : {}) }),
  });

  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw toApiError(payload, response.status);

  const data = payload as LoginResponse;
  accessToken = data.accessToken;
  return data;
}

export async function restoreSession(): Promise<LoginResponse | null> {
  try {
    const response = await fetch(buildUrl('/auth/refresh'), {
      method: 'POST',
      credentials: 'include',
    });
    if (!response.ok) return null;
    const data = (await response.json()) as LoginResponse;
    accessToken = data.accessToken;
    return data;
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch(buildUrl('/auth/logout'), { method: 'POST', credentials: 'include' });
  } finally {
    accessToken = null;
  }
}
