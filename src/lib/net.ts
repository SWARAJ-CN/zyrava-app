/**
 * Native fetch wrapper with a manual cookie jar — the mobile stand-in for
 * the browser's `credentials: "include"` behaviour, so the account API's
 * session + CSRF cookie flow works identically (see PORTING_CONVENTIONS §9).
 * Relative `/api/...` paths resolve against the account API origin.
 */
import { API_URL } from "./env";
import { getItem, setItem } from "./store";

const JAR_KEY = "zyrava:cookies";

type Jar = Record<string, string>;

function readJar(): Jar {
  try {
    return JSON.parse(getItem(JAR_KEY) ?? "{}") as Jar;
  } catch {
    return {};
  }
}

function writeJar(jar: Jar): void {
  setItem(JAR_KEY, JSON.stringify(jar));
}

/**
 * RN exposes `set-cookie` (comma-joined when several). Split on commas that
 * start a new `name=` pair so base64url values never break apart.
 */
function absorbSetCookies(headers: Headers): void {
  const raw = headers.get("set-cookie") ?? headers.get("Set-Cookie");
  if (!raw) return;
  const jar = readJar();
  for (const entry of raw.split(/,\s*(?=[A-Za-z0-9_-]+=)/)) {
    const pair = entry.split(";")[0]?.trim();
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (value === "" || /Expires=(Wed, 09 Jun 1999|max-age=0)/i.test(entry)) {
      delete jar[name];
    } else {
      jar[name] = value;
    }
  }
  writeJar(jar);
}

function cookieHeader(): string {
  const jar = readJar();
  return Object.entries(jar)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

export function resolveUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${API_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

export async function netFetch(input: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const cookie = cookieHeader();
  if (cookie && !headers.has("Cookie")) headers.set("Cookie", cookie);
  const response = await fetch(resolveUrl(input), { ...init, headers });
  absorbSetCookies(response.headers);
  return response;
}
