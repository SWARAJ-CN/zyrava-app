/* global __dirname */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { createHash } = require("node:crypto");
function load(file, resolver) {
  const module = { exports: {} };
  const js = ts.transpileModule(readFileSync(path.join(__dirname, "../src", file), "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  new Function("module", "exports", "require", js)(module, module.exports, resolver);
  return module.exports;
}
test("missing notifications modules leave startup usable without evaluating remote push imports", () => {
  const loaded = [];
  const api = load("lib/local-notifications.ts", (name) => {
    loaded.push(name);
    if (name === "expo") return { requireOptionalNativeModule: () => null };
    if (name === "react-native") return { Platform: { OS: "android" } };
    throw new Error("Cannot find native module ExpoApplication");
  });
  assert.equal(api.getLocalNotifications(), null);
  assert.equal(api.getLocalNotifications(), null);
  assert.deepEqual(loaded.sort(), ["expo", "react-native"]);
});
test("supported binary loads local reminders without depending on ExpoApplication or push tokens", async () => {
  const calls = [];
  const api = load("lib/local-notifications.ts", (name) => {
    if (name === "expo") return { requireOptionalNativeModule: () => ({}) };
    if (name === "react-native") return { Platform: { OS: "android" } };
    assert.notEqual(name, "expo-notifications");
    const method = name.split("/").at(-1);
    if (method === "NotificationPermissions")
      return {
        getPermissionsAsync: async () => ({ status: "granted" }),
        requestPermissionsAsync: async () => ({ status: "granted" }),
      };
    return { [method]: async (...args) => calls.push([method, ...args]) };
  });
  const notifications = api.getLocalNotifications();
  assert.equal((await notifications.getPermissionsAsync()).status, "granted");
  await notifications.scheduleNotificationAsync({ identifier: "test" });
  await notifications.cancelScheduledNotificationAsync("test");
  await notifications.setNotificationChannelAsync("test", {});
  assert.equal(calls.length, 3);
});
test("partially linked binary does not fail the router during notifications import", () => {
  const api = load("lib/local-notifications.ts", (name) => {
    if (name === "expo") return { requireOptionalNativeModule: () => ({}) };
    if (name === "react-native") return { Platform: { OS: "ios" } };
    throw new Error("incompatible binary");
  });
  assert.equal(api.getLocalNotifications(), null);
});
test("offline imports work without ExpoCrypto and preserve SHA-256 IDs, including Unicode names", async () => {
  const offline = load("lib/offline.ts", (name) => {
    if (name === "expo-crypto") throw new Error("Cannot find native module ExpoCrypto");
    if (name === "./audio-engine") return { getAudioEngine: () => ({}) };
    if (name === "expo-file-system" || name === "./store" || name === "./saavn") return {};
    return require(name);
  });
  for (const file of [
    { name: "track.mp3", size: 12000, lastModified: 1234 },
    { name: "മഴ 🎶.flac" },
    { name: "same.mp3", size: 0, lastModified: 0 },
  ]) {
    const seed = `${file.size ?? 0}:${file.lastModified ?? 0}:${file.name}`;
    const expected = "local:" + createHash("sha256").update(seed).digest("hex").slice(0, 24);
    assert.equal(await offline.localIdFor(file), expected);
    assert.equal(await offline.localIdFor(file), expected);
  }
});
