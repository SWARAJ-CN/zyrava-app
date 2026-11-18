/* global __dirname */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const React = require("react");
const { act, create } = require("react-test-renderer");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test("presence snapshots and refreshed threads remove stale online state without losing last activity", async () => {
  const handlers = new Map();
  const lastSeenAt = "2026-11-14T06:00:00Z";
  let threads = [
    {
      id: "thread",
      user: { id: "alice", name: "Alice", online: true, lastSeenAt },
      unread: 0,
      lastMessage: null,
      updatedAt: lastSeenAt,
    },
  ];
  const auth = { status: "authenticated", user: { id: "me" } };
  const toast = { success() {}, error() {} };
  const api = {
    MAX_CHAT_MESSAGE: 2000,
    fetchSummary: async () => ({ unread: 0, requests: 0, online: 1 }),
    fetchConversations: async () => threads,
    fetchRequests: async () => ({ incoming: [], outgoing: [] }),
    fetchPeople: async () => threads.map((thread) => thread.user),
  };
  const mocks = {
    "@/components/providers/AuthProvider": { useAuth: () => auth },
    "@/components/providers/ToastProvider": { useToast: () => toast },
    "@/lib/community": api,
    "@/lib/socket": {
      connectCommunity() {},
      disconnectCommunity() {},
      emitTyping() {},
      onCommunityStatus: () => () => {},
      onCommunityEvent: (event, handler) => {
        handlers.set(event, handler);
        return () => handlers.delete(event);
      },
    },
  };
  const source = readFileSync(
    path.resolve(__dirname, "../src/components/providers/CommunityProvider.tsx"),
    "utf8"
  );
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "require", code)(module, module.exports, (name) =>
    Object.hasOwn(mocks, name) ? mocks[name] : require(name)
  );
  const { CommunityProvider, useCommunity } = module.exports;
  let value;
  function Capture() {
    value = useCommunity();
    return null;
  }
  let renderer;
  await act(() => {
    renderer = create(React.createElement(CommunityProvider, null, React.createElement(Capture)));
  });
  try {
    await act(() => value.openChat());
    assert.equal(value.onlineIds.has("alice"), true);
    await act(() => handlers.get("presence:init")({ online: ["me"] }));
    assert.equal(value.onlineIds.has("alice"), false);
    assert.equal(value.conversations[0].user.online, false);
    assert.equal(value.people[0].online, false);
    assert.equal(value.people[0].lastSeenAt, lastSeenAt);
    const newer = "2026-11-14T06:05:00Z";
    await act(() =>
      handlers.get("presence:update")({ userId: "alice", online: false, lastSeenAt: newer })
    );
    assert.equal(value.conversations[0].user.lastSeenAt, newer);
    await act(() =>
      handlers.get("presence:update")({ userId: "alice", online: true, lastSeenAt: null })
    );
    assert.equal(value.onlineIds.has("alice"), true);
    assert.equal(value.conversations[0].user.lastSeenAt, newer);
    assert.equal(value.people[0].lastSeenAt, newer);
    threads = [{ ...threads[0], user: { ...threads[0].user, online: false, lastSeenAt: newer } }];
    await act(() => value.openChat());
    assert.equal(
      value.onlineIds.has("alice"),
      false,
      "REST refresh must remove an offline person from the online set"
    );
    assert.equal(value.conversations[0].user.online, false);
  } finally {
    await act(() => renderer.unmount());
  }
});
