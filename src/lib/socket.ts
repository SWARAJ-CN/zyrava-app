/*
 * One websocket for the whole app, shared by every community component.
 *
 * It is deliberately separate from `lib/api.ts`: the REST calls carry the
 * cookies and the CSRF header, and this carries the access token in the
 * handshake so the socket dies with the session. Nothing proxies a socket on
 * device, so this connects straight to the API host — a native socket sends no
 * browser `Origin`, so the server's `CLIENT_ORIGINS` allow-list never applies
 * to it.
 */

import { io, type Socket } from "socket.io-client";
import { getAccessToken, refreshSession } from "./api";
import { API_URL } from "./env";

/** The same origin `netFetch` resolves the REST calls against (`EXPO_PUBLIC_API_URL`). */
const API_ORIGIN = API_URL;

/** Handshake refusals before deciding the account is really signed out. */
const MAX_AUTH_RETRIES = 3;

export type CommunityEvent =
  | "message:new"
  | "conversation:new"
  | "conversation:update"
  | "conversation:read"
  | "request:received"
  | "request:resolved"
  | "presence:init"
  | "presence:update"
  | "typing"
  | "library:changed"
  | "history:changed";

type Handler = (payload: never) => void;

let socket: Socket | null = null;
let authFailures = 0;
const handlers = new Map<CommunityEvent, Set<Handler>>();
const statusListeners = new Set<(connected: boolean) => void>();

function bind(connection: Socket) {
  connection.on("connect", () => {
    authFailures = 0;
    statusListeners.forEach((notify) => notify(true));
  });
  connection.on("disconnect", () => statusListeners.forEach((notify) => notify(false)));

  connection.on("connect_error", (error: Error & { message?: string }) => {
    if (error?.message !== "Unauthorized") return;
    authFailures += 1;
    /*
     * Socket.IO does not automatically reconnect after middleware rejects a
     * handshake. Refresh first, then explicitly retry with the new token.
     */
    if (authFailures >= MAX_AUTH_RETRIES) {
      connection.close();
      statusListeners.forEach((notify) => notify(false));
      return;
    }
    void refreshSession().then((session) => {
      // Logout or an account switch may have replaced the socket meanwhile.
      if (socket !== connection) return;
      if (session) connection.connect();
      else {
        connection.close();
        statusListeners.forEach((notify) => notify(false));
      }
    });
  });

  // One dispatcher also covers subscriptions added after connecting. Per-
  // subscriber socket listeners leaked on unsubscribe and duplicated updates.
  connection.onAny((event: string, payload: unknown) => {
    handlers.get(event as CommunityEvent)?.forEach((handler) => handler(payload as never));
  });
}

export function connectCommunity(): void {
  if (!getAccessToken()) return;
  if (socket) {
    if (!socket.connected) {
      authFailures = 0;
      socket.connect();
    }
    return;
  }

  socket = io(API_ORIGIN, {
    /*
     * socket.io expects the callback form: the function is handed a `proceed`
     * and must call it. Returning the object instead makes the client open the
     * transport and then wait forever for a handshake packet that never leaves.
     * Reading the token here rather than at module scope means every attempt —
     * including an automatic reconnect — carries whatever the app holds now.
     */
    auth: (proceed: (credentials: { token: string }) => void) =>
      proceed({ token: getAccessToken() ?? "" }),
    autoConnect: true,
    reconnection: true,
    reconnectionDelay: 800,
    reconnectionDelayMax: 5_000,
    // Keep Socket.IO's polling fallback, as in the web client, for networks
    // that block websocket upgrades. React Native provides XMLHttpRequest.
  });
  bind(socket);
}

export function disconnectCommunity(): void {
  // Mounted providers own their subscriptions and remove them in cleanup.
  socket?.close();
  socket = null;
  authFailures = 0;
}

export function communityConnected(): boolean {
  return socket?.connected ?? false;
}

/**
 * Subscribe to a server push. Handlers live in a registry rather than on the
 * socket, so a reconnection (and a component mounting before the socket exists)
 * never loses an event.
 */
export function onCommunityEvent(event: CommunityEvent, handler: Handler): () => void {
  const set = handlers.get(event) ?? new Set<Handler>();
  set.add(handler);
  handlers.set(event, set);

  return () => {
    set.delete(handler);
  };
}

export function onCommunityStatus(listener: (connected: boolean) => void): () => void {
  statusListeners.add(listener);
  /*
   * A listener that appears after the socket is already up must learn the
   * present state rather than wait for the next change — which is what a
   * re-subscribing effect does. Deferred a tick so it never lands inside the
   * effect that registered it.
   */
  const live = socket?.connected ?? false;
  queueMicrotask(() => {
    if (statusListeners.has(listener)) listener(live);
  });
  return () => {
    statusListeners.delete(listener);
  };
}

/** Ephemeral: the server relays it to the other half of the thread, unstored. */
export function emitTyping(conversationId: string, isTyping: boolean): void {
  if (!socket?.connected) return;
  socket.emit(isTyping ? "typing:start" : "typing:stop", { conversationId });
}
