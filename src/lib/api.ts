/*
 * Account calls keep their relative paths on purpose (`/api/auth/…`): `netFetch`
 * resolves them against the account API origin and replays the session and
 * CSRF cookies from its own jar — the native stand-in for the browser sending
 * `credentials: "include"` through the web app's proxy. Calling the API host
 * with a bare `fetch` would carry no cookies at all, and every sign-in would
 * come back "Invalid or missing CSRF token".
 */

import { netFetch } from "./net";

export class ApiError extends Error {
  readonly status: number;
  readonly details?: { path: string; message: string }[];

  constructor(message: string, status = 0, details?: { path: string; message: string }[]) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export interface AuthUser {
  experience?: "standard" | "brown-burgundy";
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  createdAt?: string;
}

interface SessionPayload {
  user: AuthUser;
  accessToken: string;
}

function requireSession(session: SessionPayload): SessionPayload {
  if (
    !session ||
    typeof session.accessToken !== "string" ||
    !session.accessToken ||
    !session.user ||
    typeof session.user.id !== "string" ||
    !session.user.id
  ) {
    throw new ApiError(
      "The account server returned an incomplete session. Please try signing in again.",
      502
    );
  }
  return session;
}

/*
 * The access token lives in memory only — never the settings store — so a
 * dumped preference file cannot lift a long-lived credential. The durable part
 * is the httpOnly refresh cookie (kept in `net`'s jar), and CSRF is the
 * double-submit token below.
 */
let accessToken: string | null = null;
let csrfToken: string | null = null;
let csrfInFlight: Promise<string> | null = null;
let refreshInFlight: Promise<SessionPayload | null> | null = null;

/** One deadline covers both connection and body reads, including captive portals. */
async function accountResponse(path: string, init: RequestInit = {}) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await netFetch(path, { ...init, signal: controller.signal });
        const payload: unknown =
          response.status === 204 ? null : await response.json().catch(() => null);
        return { response, payload };
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new ApiError(
              "The account server took too long to respond. Check your connection and retry."
            )
          );
          controller.abort();
        }, 30000);
      }),
    ]);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("Cannot reach the account server. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
  }
}

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

async function requestCsrf(force = false): Promise<string> {
  if (!force && csrfToken) return csrfToken;
  if (!csrfInFlight) {
    /*
     * The web sent `credentials: "include"` and `cache: "no-store"`: `netFetch`
     * attaches the cookie jar itself, and RN has no HTTP cache to bypass.
     */
    csrfInFlight = accountResponse("/api/auth/csrf", { cache: "no-store" })
      .then(({ response, payload: data }) => {
        const payload = data as {
          csrfToken?: string;
          error?: string;
        } | null;
        if (!response.ok || typeof payload?.csrfToken !== "string" || !payload.csrfToken) {
          throw new ApiError(
            payload?.error ?? "Could not start a secure session.",
            response.status
          );
        }
        csrfToken = payload.csrfToken;
        return csrfToken;
      })
      .finally(() => {
        csrfInFlight = null;
      });
  }
  return csrfInFlight;
}

interface ApiOptions {
  method?: "GET" | "POST";
  body?: unknown;
  /** Send the bearer token; false for auth bootstrap calls. */
  auth?: boolean;
  /** Internal: prevents an infinite retry loop. */
  retried?: boolean;
}

export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };

  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (method === "POST") headers["X-CSRF-Token"] = await requestCsrf();
  if (options.auth !== false && accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const { response, payload: data } = await accountResponse(path, {
    method,
    headers,
    cache: "no-store",
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  // A stale CSRF cookie or an expired access token gets exactly one retry.
  if (!options.retried && (response.status === 403 || response.status === 401)) {
    if (response.status === 403 && method === "POST") {
      await requestCsrf(true);
      return apiFetch<T>(path, { ...options, retried: true });
    }
    if (response.status === 401 && options.auth !== false) {
      const refreshed = await refreshSession();
      if (refreshed) return apiFetch<T>(path, { ...options, retried: true });
    }
  }

  if (response.status === 204) return undefined as T;

  const payload = data as
    (T & { error?: string; details?: { path: string; message: string }[] }) | null;

  if (!response.ok) {
    throw new ApiError(
      payload?.error ?? "The request failed. Please try again.",
      response.status,
      payload?.details
    );
  }

  if (payload === null || typeof payload !== "object") {
    throw new ApiError(
      "The account server returned an invalid response. If this is public Wi-Fi, sign in to the network and retry.",
      502
    );
  }

  return payload as T;
}

/** One shared refresh so React StrictMode's double effect cannot rotate twice. */
export function refreshSession(): Promise<SessionPayload | null> {
  if (!refreshInFlight) {
    refreshInFlight = apiFetch<SessionPayload>("/api/auth/refresh", {
      method: "POST",
      auth: false,
    })
      .then((session) => {
        requireSession(session);
        setAccessToken(session.accessToken);
        return session;
      })
      .catch(() => {
        setAccessToken(null);
        return null;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

export interface LoginInput {
  identifier: string;
  password: string;
  remember: boolean;
}

export interface RegisterInput {
  name?: string;
  email?: string;
  phone?: string;
  password: string;
  remember: boolean;
}

export async function loginRequest(input: LoginInput): Promise<AuthUser> {
  const session = await apiFetch<SessionPayload>("/api/auth/login", {
    method: "POST",
    body: input,
    auth: false,
  });
  requireSession(session);
  setAccessToken(session.accessToken);
  return session.user;
}

export async function registerRequest(input: RegisterInput): Promise<AuthUser> {
  const session = await apiFetch<SessionPayload>("/api/auth/register", {
    method: "POST",
    body: input,
    auth: false,
  });
  requireSession(session);
  setAccessToken(session.accessToken);
  return session.user;
}

export async function logoutRequest(): Promise<void> {
  try {
    await apiFetch<void>("/api/auth/logout", { method: "POST" });
  } finally {
    setAccessToken(null);
  }
}
