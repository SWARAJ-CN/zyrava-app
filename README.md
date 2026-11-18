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
| 10-band EQ (18 presets) · 11 spatial modes · 8-slot FX rack · sub/sweep/compressor/limiter/loudness · preamp/balance/tempo/crossfade · 8 DJ pads · BPM readout · VU bridge | Native processing via `react-native-audio-api`; EQ/Space settings match the web, with the 3D and dynamics differences noted below |
| Now-playing: synced lyrics (LRCLIB), related radio | identical |
| Community chat (socket.io, typing, presence, requests) | identical |
| Taste model + server history sync, auto-feed, auto-DJ crossfade | identical |
| Theme (light/dark/system), 23-language i18n, voice announcements, idle reminders | identical (local notifications) |

## Running it

```bash
cp .env.example .env        # set EXPO_PUBLIC_API_URL (your zyrava-server)
npm install
```

Expo Go supports playback, synced lyrics, translation, live karaoke, and foreground EQ and Space effects.
Tap **Karaoke** beside Translate to reduce vocals in the song already playing.
It adjusts the live audio graph without downloading another file, restarting the
song, or changing the lyric position. The same effect works in the installed native
engine. This is stereo center reduction with bass restoration, not AI stem
separation: centered instruments can become quieter and some vocals can remain.
Turning Karaoke off restores the original mix. Selecting another song resets it.

**Use an instrumental file** remains an explicit alternative for an exact backing
track. Choose a version with matching timing; the app saves the file pairing locally.
File switching preserves playback position and pause state.

Use `npx expo start --go --clear` after installing dependencies.

Lyric translation tries Google first and falls back to [MyMemory](https://mymemory.translated.net/doc/spec.php)
using the song's catalogue language. Unsupported/unknown source languages cannot use
that fallback. MyMemory's anonymous quota is [5,000 characters per day](https://mymemory.translated.net/doc/usagelimits.php);
failed translations remain retryable and original lyrics stay visible. Successful
lines are cached for the session (up to 24 hours). No API key is embedded in the app.

The native `react-native-audio-api` engine provides live karaoke processing, EQ,
spatial effects, and the full studio rack. For these features, use a development build:

```bash
npx expo prebuild --clean     # generates android/ & ios/ with the audio plugin
npx expo run:android          # or: npx expo run:ios   (installs on the device)
npx expo start --dev-client   # afterwards: Metro for JS-only reloads
```

- `EXPO_PUBLIC_API_URL` must be reachable from the device (a LAN IP, not
  `localhost`; on Android emulators `10.0.2.2` maps to the host).
- Set `EXPO_PUBLIC_WEB_BASE_URL` to your deployed web app's origin to use its
  existing `/api/music/search`, playlist, and lyrics routes. This shares the
  web server's catalogue configuration and lyrics cache. Without it, mobile
  uses `EXPO_PUBLIC_MUSIC_API` mirrors and the direct providers, with the same
  search limits and duplicate handling as the web routes.
- Typed searches and suggestions share mobile relevance ranking in both hosted
  and direct modes. Title/artist matches take priority, minor misspellings are
  tolerated, and unrequested remixes/instrumentals rank lower. Weak specific
  lookups also try the direct catalogue by title (6.5-second recovery budget).
  Search pools are cached for two minutes, deduplicated before pagination, and
  bounded to 24 queries and ten provider pages per query. Catalogue availability
  still depends on the provider and region; ranking cannot supply missing audio.
- After changing `.env`, restart with `npx expo start --dev-client --clear`.
  Release builds embed these values during bundling, so rebuild them after
  configuration changes. Keep the account API URL separate from the web URL:
  chat sockets connect directly to the account server.
- The startup/session/sign-in loader uses the PWA's branded screen and switches
  to its original server-wake animation after 2.2 seconds of waiting. The
  animation is bundled in `assets/animations/server-wake.json`, so it works
  while the server is asleep. After adding `lottie-react-native`, rebuild and
  reinstall the development app (`npx expo run:android` or `npx expo run:ios`);
  restarting Metro alone cannot add this native animation player.
- Remote streaming needs FFmpeg in the native build; `app.json` already sets
  `enableFFmpeg: true` on the `react-native-audio-api` plugin. The Gradle/CocoaPods
  step downloads those prebuilts — the first build needs network. If you want a
  no-FFmpeg build, set it to `false` (audio is then fully downloaded per track
  before playback).
- `expo run:android` requires a JDK 17+ and the Android SDK (`ANDROID_HOME`).
  No local Android toolchain? Use a cloud build: `eas build -p android --profile development`.

## Background playback and media preview

Installed ZYRAVA builds configure playback to stay active when leaving the app or locking the screen.
The notification shade / lock screen shows song title, artist, artwork and media
controls. The native engine supports next/previous track and seek; the Expo audio
fallback supports play/pause and ten-second seek controls. Remote pause is respected
instead of being undone by the app's recovery watchdog.

Both audio backends have background configuration in `app.json`. Android uses a
media-playback foreground service; the existing Android manifest includes both
services. The native engine is configured to retain its service when the app is
removed from Recents. iOS uses the audio background mode and playback audio session.
**Rebuild the native app** for service/configuration changes to take effect.
Expo Go cannot adopt app-specific native configuration. Its transport uses foreground
playback and skips lock-screen service activation, preventing Expo's native
"service binding failed" error. Adding `enableBackgroundPlayback` to `app.json`
cannot change Expo Go's installed manifest. Test sustained background playback and
lock-screen controls in a rebuilt, installed ZYRAVA app.

Force-stop on Android, force-quit on iOS, OS process termination, or restrictive
battery management can stop playback. A JavaScript queue cannot advance once its
process is killed. This does not implement playback after a true process termination.
Physical-device checks are still required for lock-screen controls, Recents removal,
Bluetooth controls, screen locking and track transitions in the background.

The mobile EQ uses the same ten frequencies, eighteen presets, peaking-filter Q
and gain compensation as the PWA. Expo Go uses its bundled WebView's Web Audio
engine for foreground EQ and Space, including Flat. Remote tracks stream directly
from the CDN with anonymous CORS; playback no longer waits for a full-song download
or base64 transfer. Device-local files use the byte bridge (up to 25 MB).
Changing presets, moving a band, returning to Flat or selecting
Space changes the current graph without replacing the player or reloading the song.
Space includes stereo, mono, width, orbit, HRTF placement, PA stack, telephone and
echo. Switching modes releases the previous nodes, oscillators and delay feedback.
A failed host, CORS-blocked stream or unsupported file falls back once to expo-audio at the current
position, with effects disabled and an explanatory message. The failed effects
source is silenced and stopped first. Remote startup has an eight-second timeout
instead of an unbounded wait for an effects stream that never becomes playable.
This does not add lock-screen/background
support to Expo Go; keep it in the foreground. The studio FX rack, native metering
and pads still require the installed ZYRAVA engine.

Space runs directly after the EQ, independently of the optional DJ rack. Changing
modes disconnects the previous paths and stops their oscillators. If a mode cannot
start, Space returns to Off and shows an error while the track continues. EQ and
Space settings remain connected when switching tracks.

The native library currently implements **equal-power 3D positioning**, while the
web uses **HRTF**. The native 3D hint reflects this; its timbre will not be identical
to the browser's binaural rendering. Stereo/Off are deliberately transparent, and
stereo widening or pan effects are best checked with stereo headphones.

For a standalone APK for ARM64 Android phones (bundles JavaScript; no Metro or
Expo Go required), run from `android/` with the Android SDK configured:

```bash
NODE_ENV=production ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --max-workers=2
```

Output: `android/app/build/outputs/apk/release/app-release.apk`. This local test
build uses the repository's debug signing key; store publishing needs production
signing configuration.

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


## Device and network compatibility

The installed Expo 58 / React Native 0.88 stack has these minimum deployment
requirements; these are framework baselines, not a claim that every device has
been tested:

| Platform | Minimum OS | Feature requirements |
| --- | --- | --- |
| Android | Android 7.0 (API 24) | Karaoke preparation needs a working Android System WebView and offline audio decoding. |
| iPhone / iPad | iOS / iPadOS 16.4 | The installed Expo pods require 16.4; native release testing requires a macOS/Xcode build. |

OS requirements come from the installed native packages (`react-native`'s Android
version catalog and `expo` / `expo-modules-core` podspecs). Lowering an app setting
does not make those dependencies support older OS versions. See the
[Expo SDK guidance](https://docs.expo.dev/versions/latest/) and
[Expo Go compatibility guidance](https://docs.expo.dev/troubleshooting/expo-go-version-mismatch/).

Startup now falls back to in-memory settings after a storage failure or a
three-second storage stall; unresolved fonts stop blocking startup after eight
seconds. Failed persistent writes do not crash the session, but changes may not
survive a restart while device storage is unavailable. Late storage results
cannot overwrite changes made in the current session.

Account requests have a 30-second deadline covering connection and response-body
reads. Invalid responses (including public Wi-Fi sign-in pages) show errors rather
than becoming a broken authenticated session. Requests are not blindly replayed
when a network operation fails; a timed-out write may already have reached the
server. Existing CSRF/session retries remain bounded.

The root route provides a [retry screen for React rendering errors](https://docs.expo.dev/router/error-handling/).
Missing karaoke/WebView modules disable that feature while normal playback remains
available. Audio construction failures report a playback error and release partial
players; temporary audio-session setup failures can retry on the next track.
These protections do not catch OS kills, native crashes, or out-of-memory failures.

Worldwide reachability also requires public HTTPS account and music services,
valid TLS certificates, and upstream availability in each launch country. Do not
ship LAN/localhost URLs or disable TLS checks to work around connectivity errors.
A region-blocked catalogue or an offline device cannot stream unavailable music;
existing downloaded/local playback remains the offline path. Expo Go is a testing
client, not proof of production compatibility.

Before publishing, validate native release builds on Android and iOS, including
older supported and low-memory devices, Wi-Fi/mobile-data handoffs, airplane mode,
captive portals, slow/disconnected transfers, denied permissions, storage-full
conditions, background playback, calls/audio-focus interruptions, and changing
songs during preparation. No device-farm, native iOS release, or worldwide carrier
certification has been performed by the automated unit/bundle checks.

### Playback volume

The bottom player has no volume slider; use the device's volume buttons.
Development/release builds with `react-native-volume-manager` linked keep the
internal volume state synchronized with device media volume. Startup only reads system volume.
The audio graph stays at unity gain (apart from mute/EQ compensation) in this mode
so the same volume is not applied twice. Native volume steps are read back after a
gesture, so Android percentages may round to the nearest supported step.

Rebuild the native app after installing this dependency (`npm run android`, or
`npm run ios` on macOS). Restarting Metro alone cannot add a native module.
Expo Go and older binaries without the module retain app gain for the mixer.
The module does not support Expo Go; validate iOS
volume synchronization on a physical device. See the
[volume manager documentation](https://github.com/hirbod/react-native-volume-manager).
