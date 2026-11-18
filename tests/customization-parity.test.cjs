/* global __dirname */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { act, create } = require("react-test-renderer");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function load(file, mocks = {}) {
  const module = { exports: {} };
  const js = ts.transpileModule(readFileSync(path.join(__dirname, "../src", file), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  new Function("module", "exports", "require", js)(module, module.exports, (name) =>
    Object.hasOwn(mocks, name) ? mocks[name] : require(name)
  );
  return module.exports;
}
const config = load("lib/customization.ts");
const welcome = load("lib/customization-welcome.ts", { "./customization": config });
const payment = load("lib/customization-payment.ts");
const empty = { active: null, incoming: [], received: [], outgoing: [] };
const active = {
  id: "gift",
  config: config.DEFAULT_CUSTOMIZATION,
  creator: { id: "sender", name: "Sender", email: "s***@example.test" },
  appliedAt: new Date().toISOString(),
  expiresAt: null,
};

test("expired or malformed welcome hints cannot restore a customization", () => {
  assert.equal(welcome.readWelcome({}), null);
  const hint = {
    userId: "user",
    identifier: "user@example.test",
    personal: false,
    active: { ...active, expiresAt: "2000-01-01" },
  };
  assert.equal(welcome.readWelcome(hint).active, null);
  hint.active.expiresAt = null;
  hint.active.config = { ...config.DEFAULT_CUSTOMIZATION, accent: "javascript:bad" };
  assert.equal(welcome.readWelcome(hint).active, null);
  assert.equal(config.CUSTOM_PALETTES.length, 144);
});

test("account themes restore original colours on logout and ignore late account responses", async () => {
  let user = { id: "a", experience: "standard", email: "a@example.test" };
  const requests = [];
  const vars = {};
  const original = "#010203";
  let value;
  const lib = load("components/providers/CustomizationProvider.tsx", {
    "./AuthProvider": { useAuth: () => ({ user }) },
    "./ThemeProvider": { useTheme: () => ({ resolved: "dark" }) },
    "@/lib/customization": config,
    "@/lib/customization-welcome": welcome,
    "@/lib/store": { readJson: () => null, writeJson() {} },
    "@/lib/api": { apiFetch: () => new Promise((resolve) => requests.push(resolve)) },
    "react-native": {
      AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
    },
    uniwind: {
      Uniwind: {
        getCSSVariable: (key) => vars[key] ?? original,
        updateCSSVariables: (_theme, next) => Object.assign(vars, next),
      },
    },
  });
  function Probe() {
    value = lib.useCustomization();
    return null;
  }
  const element = () =>
    React.createElement(lib.CustomizationProvider, null, React.createElement(Probe));
  let renderer;
  await act(async () => {
    renderer = create(element());
  });
  assert.equal(value.config, null);
  await act(async () => requests.shift()({ ...empty, active }));
  assert.equal(vars["--background"], active.config.background);
  assert.equal(value.config.title, active.config.title);
  let stale;
  await act(async () => {
    stale = value.refresh();
  });
  user = null;
  await act(async () => renderer.update(element()));
  assert.equal(value.config, null);
  assert.equal(vars["--background"], original);
  await act(async () => {
    requests.shift()({ ...empty, active });
    await stale;
  });
  assert.equal(value.config, null);
  await act(async () => renderer.unmount());
});

test("Vimitha appearance switch controls colours while identity restrictions remain enabled", async () => {
  let enabled = true,
    context,
    foreground;
  const vars = {};
  const user = { id: "private", experience: "brown-burgundy" };
  const lib = load("components/providers/CustomizationProvider.tsx", {
    "./AuthProvider": { useAuth: () => ({ user }) },
    "./ThemeProvider": { useTheme: () => ({ resolved: "dark" }) },
    "@/lib/customization": config,
    "@/lib/customization-welcome": welcome,
    "@/lib/store": { readJson: () => null, writeJson() {} },
    "@/lib/api": {
      apiFetch: async (path) => {
        assert.equal(path, "/api/appearance");
        return { vimithaThemeEnabled: enabled };
      },
    },
    "react-native": {
      AppState: {
        currentState: "active",
        addEventListener: (_name, fn) => {
          foreground = fn;
          return { remove() {} };
        },
      },
    },
    uniwind: {
      Uniwind: {
        getCSSVariable: () => "#000000",
        updateCSSVariables: (_theme, next) => Object.assign(vars, next),
      },
    },
  });
  function Probe() {
    context = lib.useCustomization();
    return null;
  }
  let renderer;
  await act(async () => {
    renderer = create(
      React.createElement(lib.CustomizationProvider, null, React.createElement(Probe))
    );
  });
  assert.equal(context.personal, true);
  assert.equal(context.personalTheme, true);
  enabled = false;
  await act(async () => foreground("active"));
  assert.equal(context.personal, true);
  assert.equal(context.personalTheme, false);
  assert.equal(context.config, null);
  assert.equal(vars["--background"], "#000000");
  await act(async () => renderer.unmount());
});

test("checkout encodes untrusted titles and only includes public order information", () => {
  const html = payment.checkoutHtml(
    {
      keyId: "public-key",
      orderId: "order_1",
      amount: 500,
      currency: "INR",
      title: "</script><script>alert(1)</script>",
    },
    "https://api.example/mobile-return"
  );
  assert.ok(html.includes("\\u003c/script>"));
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("callback_url"));
  assert.ok(!html.includes("Authorization"));
  assert.match(
    payment.checkoutRequestId(),
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  );
});

test("failed order retry reuses its idempotency key; returning from checkout asks the server before success", async () => {
  const saved = new Map(),
    orders = [];
  let fail = true,
    fulfilled = false,
    checked = 0,
    refreshed = 0,
    value;
  const order = {
    id: "purchase",
    orderId: "order_1",
    keyId: "public-key",
    amount: 500,
    currency: "INR",
    title: "Room",
    recipientId: "a",
    status: "pending",
  };
  class ApiError extends Error {}
  const lib = load("components/features/customization/useCustomizationCheckout.ts", {
    "@/lib/api": {
      ApiError,
      apiFetch: async (path, options) => {
        if (path.endsWith("/config")) return { amount: 500, currency: "INR", configured: true };
        if (path.endsWith("/payments")) return { payments: [] };
        if (path.endsWith("/order")) {
          orders.push(options.body);
          if (fail) throw new Error("Network lost");
          return order;
        }
        if (path.endsWith("/check")) {
          checked++;
          return { fulfilled };
        }
        throw new Error("Unexpected endpoint " + path);
      },
    },
    "@/lib/customization-payment": payment,
    "@/components/providers/CustomizationProvider": {
      useCustomization: () => ({
        refresh: async () => {
          refreshed++;
        },
      }),
    },
    "@/components/providers/AuthProvider": { useAuth: () => ({ user: { id: "a" } }) },
    "@/lib/store": {
      readJson: (key, fallback) => saved.get(key) ?? fallback,
      writeJson: (key, value) => saved.set(key, value),
      removeItem: (key) => saved.delete(key),
    },
  });
  function Probe() {
    value = lib.useCustomizationCheckout();
    return null;
  }
  let renderer;
  await act(async () => {
    renderer = create(React.createElement(Probe));
  });
  await act(async () => value.pay("a", config.DEFAULT_CUSTOMIZATION));
  assert.equal(orders.length, 1);
  assert.equal(value.checkout, null);
  assert.equal(refreshed, 0);
  fail = false;
  await act(async () => value.pay("a", config.DEFAULT_CUSTOMIZATION));
  assert.equal(orders[0].requestId, orders[1].requestId);
  assert.equal(value.checkout.id, "purchase");
  await act(async () => value.close());
  assert.equal(refreshed, 0);
  assert.equal(checked, 2);
  assert.match(value.message, /If you paid/);
  fulfilled = true;
  await act(async () => value.check(order));
  assert.equal(refreshed, 1);
  assert.equal(saved.size, 0);
  assert.match(value.message, /confirmed/);
  await act(async () => renderer.unmount());
});

test("fullscreen dancer selection replaces artwork, follows playback, and toggles back to artwork", async () => {
  const player = {
    current: { id: "song", title: "Song", image: "https://image.test/cover" },
    playing: true,
  };
  let closed = 0;
  const lib = load("components/features/music/FullscreenLyrics.tsx", {
    "react-native": {
      Image: "Image",
      Pressable: "Pressable",
      Text: "Text",
      View: "View",
      Switch: "Switch",
      StyleSheet: { absoluteFill: {} },
      useWindowDimensions: () => ({ width: 1000, height: 800 }),
    },
    "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    "@/components/providers/MusicPlayerProvider": {
      useMusicPlayer: () => player,
      usePlaybackProgress: () => ({ progress: 12, duration: 60 }),
    },
    "@/components/providers/CustomizationProvider": {
      useCustomization: () => ({ config: null, personalTheme: false }),
    },
    "@/hooks/usePanelBackHandler": { usePanelBackHandler() {} },
    "@/components/ui/Animation": { Animation: "Animation" },
    "@/components/ui/Modal": {
      Modal: ({ open, children }) => (open ? React.createElement("Modal", null, children) : null),
    },
    "@/components/ui/icons": { Icon: "Icon" },
    "./LyricsPanel": { LyricsPanel: "LyricsPanel" },
    "./NowPlayingTransport": { NowPlayingTransport: "Transport" },
    "@/lib/lyrics": { formatSeconds: (value) => String(value) },
  });
  let renderer;
  const element = () =>
    React.createElement(lib.FullscreenLyrics, {
      onClose: () => {
        closed++;
      },
    });
  await act(async () => {
    renderer = create(element());
  });
  assert.equal(renderer.root.findAllByType("Image").length, 2);
  await act(async () => renderer.root.findByType("Switch").props.onValueChange(true));
  await act(async () =>
    renderer.root.findByProps({ accessibilityLabel: "Choose Dancing dog" }).props.onPress()
  );
  assert.equal(renderer.root.findAllByType("Image").length, 1);
  assert.equal(renderer.root.findByType("Animation").props.id, "moments-2");
  assert.equal(renderer.root.findByType("Animation").props.playing, true);
  player.playing = false;
  await act(async () => renderer.update(element()));
  assert.equal(renderer.root.findByType("Animation").props.playing, false);
  await act(async () => renderer.root.findByType("Switch").props.onValueChange(false));
  assert.equal(renderer.root.findAllByType("Image").length, 2);
  await act(async () =>
    renderer.root.findByProps({ accessibilityLabel: "Exit fullscreen lyrics" }).props.onPress()
  );
  assert.equal(closed, 1);
  await act(async () => renderer.unmount());
});

test("palette picker mounts 24 swatches, reaches all 144 colours, and only updates changed selections", async () => {
  const rendered = [];
  const { ColorPalettePicker } = load("components/features/customization/ColorPalettePicker.tsx", {
    "react-native": {
      View: "View",
      Text: "Text",
      Pressable: (props) => {
        rendered.push(props.accessibilityLabel);
        return React.createElement("Pressable", props);
      },
    },
    "@/lib/customization": config,
    "@/components/ui/Button": { Button: "Button" },
  });
  function Harness() {
    const [accent, setAccent] = React.useState("");
    const select = React.useCallback((patch) => setAccent(patch.accent), []);
    return React.createElement(ColorPalettePicker, { accent, onSelect: select });
  }
  let renderer;
  await act(async () => {
    renderer = create(React.createElement(Harness));
  });
  assert.equal(renderer.root.findAllByType("Pressable").length, 24);
  rendered.length = 0;
  await act(async () => renderer.root.findAllByType("Pressable")[0].props.onPress());
  assert.equal(rendered.length, 1);
  rendered.length = 0;
  await act(async () => renderer.root.findAllByType("Pressable")[1].props.onPress());
  assert.equal(rendered.length, 2);
  const names = new Set();
  for (let page = 0; page < 6; page++) {
    const swatches = renderer.root.findAllByType("Pressable");
    assert.equal(swatches.length, 24);
    swatches.forEach((swatch) => names.add(swatch.props.accessibilityLabel));
    const more = renderer.root
      .findAllByType("Button")
      .find((button) => button.props.children === "More colours");
    if (page < 5) await act(async () => more.props.onPress());
    else assert.equal(more.props.disabled, true);
  }
  assert.equal(names.size, 144);
  await act(async () => renderer.unmount());
});

test("Customize opens with no native animations and only mounts the requested preview", async () => {
  const { CustomizationConsole } = load(
    "components/features/customization/CustomizationConsole.tsx",
    {
      "react-native": {
        View: "View",
        Text: "Text",
        Pressable: "Pressable",
        ScrollView: "ScrollView",
        TextInput: "TextInput",
      },
      "@/components/ui/Button": { Button: "Button" },
      "@/components/ui/Modal": { Modal: "Modal" },
      "@/components/ui/Animation": { Animation: "Animation" },
      "@/components/providers/AuthProvider": {
        useAuth: () => ({ user: { id: "a", name: "Listener" } }),
      },
      "@/components/providers/CustomizationProvider": {
        useCustomization: () => ({ personal: false, state: empty }),
      },
      "@/lib/api": {
        apiFetch() {
          throw new Error("Unexpected request");
        },
      },
      "@/lib/customization": config,
      "@/lib/customization-payment": payment,
      "./ColorPalettePicker": { ColorPalettePicker: "PalettePicker" },
      "./Checkout": { Checkout: "Checkout" },
      "./useCustomizationCheckout": {
        useCustomizationCheckout: () => ({
          pending: [],
          pricing: { amount: 500, currency: "INR", configured: true },
        }),
      },
    }
  );
  let renderer;
  await act(async () => {
    renderer = create(React.createElement(CustomizationConsole));
  });
  assert.equal(renderer.root.findAllByType("Animation").length, 0);
  assert.equal(renderer.root.findAllByType("Modal").length, 0);
  const previewButtons = () =>
    renderer.root
      .findAllByType("Button")
      .filter((button) => button.props.children === "Preview animation");
  await act(async () => previewButtons()[0].props.onPress());
  assert.equal(renderer.root.findByType("Animation").props.id, "couples-1");
  const sourceBeforeColour = renderer.root.findByType("Animation");
  await act(async () =>
    renderer.root.findByType("PalettePicker").props.onSelect(config.CUSTOM_PALETTES[1])
  );
  assert.equal(renderer.root.findByType("Animation"), sourceBeforeColour);
  await act(async () => previewButtons()[0].props.onPress());
  assert.equal(renderer.root.findAllByType("Animation").length, 1);
  assert.equal(renderer.root.findByType("Animation").props.id, "couples-2");
  await act(async () =>
    renderer.update(React.createElement(CustomizationConsole, { active: false }))
  );
  assert.equal(renderer.root.findAllByType("Animation").length, 0);
  await act(async () => renderer.unmount());
});
