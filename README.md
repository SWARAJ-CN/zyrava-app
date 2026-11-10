# ZYRAVA — mobile (React Native / Expo)

A faithful native port of the ZYRAVA web app (`../zyrava-client/zyrava`, Next.js +
HeroUI v3). Built with **Expo SDK 58**, **expo-router**, **HeroUI Native** (the
React-Native sibling of HeroUI v3 — same design tokens, same component mental
model) and **Uniwind** (Tailwind CSS v4 for React Native).

## What was migrated

Everything runs on the same rules as the web build — same queue semantics, same
EQ/mixer/FX/spatial graph, same taste engine, same storage keys, same API
contract. The migration map and every platform substitution (IndexedDB → file
system, `<audio>`+WebAudio → `react-native-audio-api`, MediaSession → lock-screen
notification, speechSynthesis → expo-speech, cookies → jar, PWA → native, …) are
documented in [`docs/PORTING_CONVENTIONS.md`](docs/PORTING_CONVENTIONS.md).

| Web | Mobile |
| --- | --- |
| Login / register + guest trial (10-song queue) | identical |
| Region browse, vibe filters, ranked feed, pagination, page-chaining | identical |
| Playlists / Liked / Downloads / Offline-files tabs | identical |
| 10-band EQ (21 presets) · 11 spatial modes · 8-slot FX rack · sub/sweep/compressor/limiter/loudness · preamp/balance/tempo/crossfade · 8 DJ pads · BPM readout · VU bridge | identical — real Web-Audio-style graph via `react-native-audio-api` |
| Now-playing: synced lyrics (LRCLIB), related radio | identical |
| Community chat (socket.io, typing, presence, requests) | identical |
| Taste model + server history sync, auto-feed, auto-DJ crossfade | identical |
| Theme (light/dark/system), 23-language i18n, voice announcements, idle reminders | identical (local notifications) |

## Running it

```bash
cp .env.example .env        # set EXPO_PUBLIC_API_URL (your zyrava-server)
npm install
```

`react-native-audio-api` is a native module — **Expo Go cannot carry the audio
engine** (it reports exactly *"failed to install react-native-audio-api / the
native lib could not be found"* — the module simply isn't inside Expo Go). Build
a development build instead:

```bash
npx expo prebuild --clean     # generates android/ & ios/ with the audio plugin
npx expo run:android          # or: npx expo run:ios   (installs on the device)
npx expo start --dev-client   # afterwards: Metro for JS-only reloads
```

- `EXPO_PUBLIC_API_URL` must be reachable from the device (a LAN IP, not
  `localhost`; on Android emulators `10.0.2.2` maps to the host).
- Remote streaming needs FFmpeg in the native build; `app.json` already sets
  `enableFFmpeg: true` on the `react-native-audio-api` plugin. The Gradle/CocoaPods
  step downloads those prebuilts — the first build needs network. If you want a
  no-FFmpeg build, set it to `false` (audio is then fully downloaded per track
  before playback).
- `expo run:android` requires a JDK 17+ and the Android SDK (`ANDROID_HOME`).
  No local Android toolchain? Use a cloud build: `eas build -p android --profile development`.

## Background playback (even when the app is swiped away)

Configured through the `react-native-audio-api` config plugin in `app.json`:

- **Android** — a `mediaPlayback` **foreground service** (`androidFSStopWithTask:
  false`) keeps playing when the app is backgrounded, screen-locked, or removed
  from recents; the persistent notification carries artwork, title, transport,
  skip (±10 s) and scrub controls, and the service holds the process alive, so
  the queue keeps advancing track after track. Runtime `POST_NOTIFICATIONS`
  permission is requested when the session starts (Android 13+). OEM battery
  killers (Xiaomi/Huawei/OnePlus…) can still cut in — set the app to
  "unrestricted" battery usage if playback dies on your device.
- **iOS** — the `audio` background mode keeps playback + lock-screen/Control
  Center/CarPlay (via `MPNowPlayingInfoCenter`) running indefinitely in the
  background, with interruptions (calls, other apps) ducking and resuming.
  Apple hard-kills the app when you force-quit from the app switcher — no iOS
  app survives that; background/locked playback is the supported mode.
- Call/other-app interruptions pause the track and take it back when the system
  hands the session over (focus-aware `AudioManager` observation in the player).

- The account API (`../zyrava-server`) is used **unchanged** — the same
  session-cookie + CSRF flow the web uses, kept alive by the mobile cookie jar
  (`src/lib/net.ts`).
- **Background playback (Android, survives app close/swipe-away):** a
  `mediaPlayback` foreground service is wired in `app.json`
  (`androidForegroundService: true`, `androidFSStopWithTask: false`,
  `POST_NOTIFICATIONS` + `FOREGROUND_SERVICE_MEDIA_PLAYBACK` permissions). The
  library shows the persistent media notification (artwork + transport) as
  soon as a track arms — that notification is what keeps the service, and
  playback, alive after the app is swiped away. Some aggressive OEM launchers
  (Xiaomi/MIUI, OnePlus/Oxygen, Huawei) may still kill background apps — grant
  ZYRAVA "unrestricted battery" / autostart in system settings if playback dies
  when the app is closed.
- **Background playback (iOS):** `iosBackgroundMode: true` writes the `audio`
  UIBackgroundMode; playback + lock-screen controls continue with the app in
  the background or screen locked. (A swipe-kill from the app switcher stops
  any iOS app's process by design — background playback is the supported mode.)

## Folder map (mirrors the web app 1:1)

```
src/app            expo-router screens (root _layout = web app/layout.tsx provider tree)
  (auth)/login|register    ↔  app/login, app/register
  (app)/index              ↔  app/page.tsx (browse feed + tabs)
  (app)/_layout            mounts AppChrome once — the web's shell pattern:
    SideBar (dock drawer, mobileNavOpen) · MixerConsole (mixerOpen) ·
    ChatPanel (chatOpen) · NowPlayingPanel (nowPlayingOpen) ·
    StickyPlayerBar (queue active) — each hides itself until its flag flips,
    so the single <Audio> element and chrome persist through all navigation.
src/components     ↔  components/ (ui, auth, providers, features/*)
src/lib            ↔  lib/ (saavn, taste, related, lyrics, lrclib, community,
                     socket, history, library, offline→files, i18n/, …)
```

## Honest platform notes

- **PWA install / service worker / manifest** — meaningless on a native app;
  the in-app equivalents (downloads + local files) keep all their logic.
- **DynamicsCompressor** has no node in the native audio engine yet; the
  compressor/limiter slots keep the exact same parameter surface driven by a
  soft-knee waveshaper approximation (`src/components/providers/MusicPlayerProvider.tsx`).
- **Speech recognition** (Web Speech API) — the grammar module is ported; the
  recognizer was never wired to a UI in the web fork either.
- **Lock-screen/background playback** is handled by the OS audio session +
  `PlaybackNotificationManager` (the MediaSession equivalent, incl. artwork and
  seek buttons).
