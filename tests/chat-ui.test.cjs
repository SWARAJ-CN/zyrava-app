/* global __dirname */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const React = require("react");
const { act, create } = require("react-test-renderer");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function harness(
  colors = { background: "#000000", foreground: "#f4f4f5", muted: "#a1a1aa", accent: "#67dfc6" }
) {
  const selected = [],
    sends = [],
    scrolls = [];
  let back;
  let closed = 0;
  const person = (id, name) => ({ id, name, online: true, lastSeenAt: null });
  const threads = [
    {
      id: "one",
      user: person("alice", "Alice Green"),
      unread: 2,
      updatedAt: "2026-11-14T12:00:00Z",
      lastMessage: null,
    },
    {
      id: "two",
      user: person("bob", "Bob Blue"),
      unread: 0,
      updatedAt: "2026-11-14T11:00:00Z",
      lastMessage: null,
    },
  ];
  const community = {
    chatOpen: true,
    closeChat: () => closed++,
    connected: true,
    loading: false,
    error: null,
    conversations: threads,
    requests: { incoming: [], outgoing: [] },
    people: [],
    peopleQuery: "",
    activeId: "one",
    activeConversation: threads[0],
    messages: [],
    olderLoading: false,
    typingUsers: [],
    onlineIds: new Set(["alice"]),
    searchPeople() {},
    loadOlder() {},
    retryMessage() {},
    askToChat: async () => {},
    respondTo: async () => {},
    reportTyping() {},
    reportTypingStop() {},
    selectConversation: (id) => {
      selected.push(id);
      community.activeId = id;
      community.activeConversation = threads.find((thread) => thread.id === id) ?? null;
    },
    sendText: (text) =>
      new Promise((resolve) => sends.push({ text, id: community.activeId, resolve })),
  };
  const auth = { user: { id: "me" } };
  const FlatList = React.forwardRef(function List(props, ref) {
    React.useImperativeHandle(ref, () => ({
      scrollToOffset: (position) => scrolls.push(position),
    }));
    return React.createElement(
      "FlatList",
      props,
      props.data.length
        ? props.data.map((item) =>
            React.createElement(
              React.Fragment,
              { key: props.keyExtractor(item) },
              props.renderItem({ item })
            )
          )
        : props.ListEmptyComponent
    );
  });
  const mocks = {
    "react-native": {
      View: "View",
      Text: "Text",
      TextInput: "TextInput",
      Pressable: "Pressable",
      ScrollView: "ScrollView",
      KeyboardAvoidingView: "KeyboardAvoidingView",
      ActivityIndicator: "Spinner",
      FlatList,
      Keyboard: { dismiss() {} },
      Platform: { OS: "android" },
      StyleSheet: { absoluteFill: { position: "absolute", inset: 0 } },
    },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 24, bottom: 16 }) },
    "heroui-native": { useThemeColor: (token) => colors[token] },
    "@/hooks/usePanelBackHandler": {
      usePanelBackHandler: (_open, handler) => {
        back = handler;
      },
    },
    "@/lib/cn": { cn: (...args) => args.filter(Boolean).join(" ") },
    "@/lib/format": { formatDate: (value) => new Date(value).toDateString() },
    "@/components/ui/icons": { Icon: "Icon" },
    "@/components/ui/Button": { Button: "Button" },
    "@/components/providers/AuthProvider": { useAuth: () => auth },
    "@/components/providers/CommunityProvider": { useCommunity: () => community },
    "@/lib/community": { MAX_CHAT_MESSAGE: 2000 },
  };
  const source = readFileSync(
    path.resolve(__dirname, "../src/components/features/community/ChatPanel.tsx"),
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
  return {
    ...module.exports,
    community,
    auth,
    selected,
    sends,
    scrolls,
    back: () => back(),
    closed: () => closed,
  };
}

test("date dividers sit above the first chronological message of each day", () => {
  const { buildChatRows } = harness();
  const messages = [
    { id: "1", createdAt: "2026-11-10T12:00:00Z" },
    { id: "2", createdAt: "2026-11-10T13:00:00Z" },
    { id: "3", createdAt: "2026-11-11T12:00:00Z" },
    { id: "4", createdAt: "2026-11-11T13:00:00Z" },
  ];
  const rows = buildChatRows(messages);
  assert.deepEqual(
    rows.map((row) => (row.kind === "message" ? row.message.id : "date")),
    ["4", "3", "date", "2", "1", "date"]
  );
  assert.equal(new Set(rows.map((row) => row.key)).size, rows.length);
});

test("chat navigation keeps explicit contrasting colors and space in both themes", async () => {
  for (const colors of [
    { background: "#000000", foreground: "#f4f4f5", muted: "#a1a1aa", accent: "#67dfc6" },
    { background: "#ffffff", foreground: "#18181b", muted: "#71717a", accent: "#14856f" },
  ]) {
    const h = harness(colors);
    h.community.selectConversation(null);
    let renderer;
    await act(() => {
      renderer = create(React.createElement(h.ChatPanel));
    });
    const root = renderer.root;
    assert.equal(
      root.findAllByType("Text").find((node) => node.props.children === "Community").props.style
        .color,
      colors.foreground
    );
    const navigation = root.findByProps({ accessibilityRole: "tablist" });
    assert.equal(navigation.props.style.flexShrink, 0);
    assert.equal(navigation.props.style.minHeight, 52);
    for (const label of ["Chats", "People", "Requests"]) {
      await act(() => root.findByProps({ accessibilityLabel: label }).props.onPress());
      const triggers = root.findAllByProps({ accessibilityRole: "tab" });
      assert.equal(triggers.length, 3);
      for (const trigger of triggers) {
        const selected = trigger.props.accessibilityLabel === label;
        assert.equal(trigger.props.accessibilityState.selected, selected);
        assert.equal(
          trigger.findByType("Text").props.style.color,
          selected ? colors.foreground : colors.muted
        );
        const style = trigger.props.style({ pressed: false });
        assert.equal(style.borderBottomColor, selected ? colors.accent : "transparent");
        assert.equal(style.minHeight, 52);
      }
    }
    await act(() => renderer.unmount());
  }
});

test("sending preserves newer edits and separate conversation drafts; duplicate taps send once", async () => {
  const h = harness();
  const render = () => React.createElement(h.ChatPanel);
  let renderer;
  await act(() => {
    renderer = create(render());
  });
  const type = (text) => renderer.root.findByType("TextInput").props.onChangeText(text);
  const send = () =>
    renderer.root.findByProps({ accessibilityLabel: "Send message" }).props.onClick();
  await act(() => type("First draft"));
  await act(() => {
    send();
    send();
  });
  assert.equal(h.sends.length, 1);
  await act(() => type("New text while sending"));
  h.community.selectConversation("two");
  await act(() => renderer.update(render()));
  assert.equal(renderer.root.findByType("TextInput").props.value, "");
  await act(() => type("Bob’s draft"));
  await act(() => h.sends[0].resolve(true));
  assert.equal(renderer.root.findByType("TextInput").props.value, "Bob’s draft");
  h.community.selectConversation("one");
  await act(() => renderer.update(render()));
  assert.equal(renderer.root.findByType("TextInput").props.value, "New text while sending");
  await act(() => send());
  await act(() => h.sends[1].resolve(true));
  assert.equal(renderer.root.findByType("TextInput").props.value, "");
  h.auth.user = { id: "another-account" };
  h.community.selectConversation("two");
  await act(() => renderer.update(render()));
  assert.equal(renderer.root.findByType("TextInput").props.value, "");
  await act(() => renderer.unmount());
});

test("offline composer keeps text and hardware back returns to the searchable inbox", async () => {
  const h = harness();
  let renderer;
  const render = () => React.createElement(h.ChatPanel);
  await act(() => {
    renderer = create(render());
  });
  assert.equal(renderer.root.findByType("KeyboardAvoidingView").props.behavior, "height");
  await act(() => renderer.root.findByType("TextInput").props.onChangeText("Keep this"));
  h.community.connected = false;
  await act(() => renderer.update(render()));
  assert.equal(
    renderer.root.findByProps({ accessibilityLabel: "Send message" }).props.disabled,
    true
  );
  await act(() => renderer.root.findByType("TextInput").props.onSubmitEditing());
  assert.equal(h.sends.length, 0);
  assert.equal(renderer.root.findByType("TextInput").props.value, "Keep this");
  await act(() => {
    h.back();
    renderer.update(render());
  });
  assert.equal(h.selected.at(-1), null);
  assert.equal(h.closed(), 0);
  await act(() =>
    renderer.root
      .findByProps({ accessibilityLabel: "Find a conversation" })
      .props.onChangeText("bob")
  );
  assert.deepEqual(
    renderer.root.findByType("FlatList").props.data.map((item) => item.id),
    ["two"]
  );
  await act(() => h.back());
  assert.equal(h.closed(), 1);
  await act(() => renderer.unmount());
});

test("chat-request failures appear in the panel without an unhandled rejection", async () => {
  const h = harness();
  h.community.selectConversation(null);
  h.community.people = [{ id: "listener", name: "Listener", online: false, relation: "none" }];
  h.community.askToChat = async () => {
    throw new Error("Request failed. Try again.");
  };
  let renderer;
  await act(() => {
    renderer = create(React.createElement(h.ChatPanel));
  });
  await act(() => renderer.root.findByProps({ accessibilityLabel: "People" }).props.onPress());
  await act(() =>
    renderer.root
      .findAllByType("Button")
      .find((node) => node.props.children === "Say hello")
      .props.onClick()
  );
  assert.equal(
    renderer.root.findByProps({ accessibilityRole: "alert" }).props.children,
    "Request failed. Try again."
  );
  await act(() => renderer.unmount());
});

test("last activity uses the server timestamp in People, chats, and an offline conversation", async () => {
  const h = harness();
  const now = Date.now();
  const lastSeenAt = new Date(now - 5 * 60_000).toISOString();
  assert.equal(h.lastActiveLabel(lastSeenAt, now), "Last active 5 min ago");
  assert.equal(
    h.lastActiveLabel(new Date(now - 2 * 3600_000).toISOString(), now),
    "Last active 2 hours ago"
  );
  assert.match(
    h.lastActiveLabel(new Date(now - 2 * 86400_000).toISOString(), now),
    /^Last active .+ at .+/
  );
  assert.equal(h.lastActiveLabel(null, now), "Last active unavailable");
  assert.equal(h.lastActiveLabel("invalid", now), "Last active unavailable");
  h.community.activeConversation.user = {
    ...h.community.activeConversation.user,
    online: false,
    lastSeenAt,
  };
  h.community.onlineIds.clear();
  h.community.people = [h.community.activeConversation.user];
  let renderer;
  await act(() => {
    renderer = create(React.createElement(h.ChatPanel));
  });
  const text = () => renderer.root.findAllByType("Text").map((node) => node.props.children);
  assert.ok(text().includes("Last active 5 min ago"));
  h.community.connected = false;
  await act(() => renderer.update(React.createElement(h.ChatPanel)));
  assert.ok(
    text().includes("Last active 5 min ago"),
    "reconnecting must not hide last known activity"
  );
  h.community.selectConversation(null);
  await act(() => renderer.update(React.createElement(h.ChatPanel)));
  assert.ok(text().includes("Last active 5 min ago"));
  await act(() => renderer.root.findByProps({ accessibilityLabel: "People" }).props.onPress());
  assert.ok(text().includes("Last active 5 min ago"));
  h.community.connected = true;
  h.community.onlineIds.add("alice");
  await act(() => renderer.update(React.createElement(h.ChatPanel)));
  assert.ok(text().includes("Online now"));
  await act(() => renderer.unmount());
});
