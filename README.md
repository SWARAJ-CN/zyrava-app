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
npx expo start -c           # Metro
```

`react-native-audio-api` is a native module — **Expo Go will not carry the audio
engine**. Use a development build:

```bash
npx expo prebuild
npx expo run:android        # or: npx expo run:ios
```

- `EXPO_PUBLIC_API_URL` must be reachable from the device (a LAN IP, not
  `localhost`, on Android emulators `10.0.2.2` maps to the host).
- The remote streaming decoder needs FFmpeg; `app.json` already passes
  `enableFFmpeg: true` to the `react-native-audio-api` plugin.
- The account API (`../zyrava-server`) is used unchanged — the same
  session-cookie + CSRF flow the web uses, kept alive by the mobile cookie jar
  (`src/lib/net.ts`).

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
