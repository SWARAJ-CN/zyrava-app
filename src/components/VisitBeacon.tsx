import { useEffect } from "react";
import { useGlobalSearchParams, usePathname } from "expo-router";
import { API_URL } from "@/lib/env";
import { getItem, setItem } from "@/lib/store";
import { randomUUID } from "@/lib/uuid";

/*
 * Arrival is recorded the moment the app opens — before the visitor does
 * anything — because the click that brought them here is the fact worth
 * keeping. On the web everything the row needed was in the URL or on the
 * request; natively the tagged link survives as the launch's deep-link params
 * and the row still asks nothing of the visitor.
 */

const CLIENT_ID_KEY = "zyrava:client-id";
const SENT_MARK = "zyrava:visit-sent";

/**
 * A random id kept on this device, so "the same person came back from
 * Instagram twice" is answerable without a name, an email or a cookie trail.
 */
function clientId(): string {
  try {
    const stored = getItem(CLIENT_ID_KEY);
    if (stored && stored.length <= 64) return stored;
    const fresh = randomUUID();
    setItem(CLIENT_ID_KEY, fresh);
    return fresh;
  } catch {
    // Storage off: this run still counts as one arrival.
    return randomUUID();
  }
}

export function VisitBeacon() {
  const pathname = usePathname();
  const params = useGlobalSearchParams<Record<string, string>>();

  useEffect(() => {
    try {
      // sessionStorage de-dup becomes a durable mark: one beacon per install.
      if (getItem(SENT_MARK)) return;
      setItem(SENT_MARK, "1");
    } catch {
      /* No storage means no de-duplication; one extra row is honest. */
    }

    const query = new URLSearchParams(params).toString();
    void fetch(`${API_URL}/api/visits`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientId: clientId(),
        path: `${pathname}${query ? `?${query}` : ""}`,
        // document.referrer has no native equivalent; the deep-link params
        // above carry the attribution a tagged launch brought.
      }),
      credentials: "omit",
      keepalive: true,
      cache: "no-store",
    }).catch(() => {
      /* An unreachable API loses the row; the visitor never learns of it. */
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per install, exactly like the web's [] effect
  }, []);

  return null;
}
