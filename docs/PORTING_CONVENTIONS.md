# ZYRAVA → React Native port conventions

Source web app: `/home/swaraj/Documents/zyrava/zyrava-client/zyrava` (Next.js 16, HeroUI v3 web, Tailwind 4).
Target app: `/home/swaraj/Documents/zyrava/zyrava-app` (Expo SDK 58, expo-router, HeroUI Native, Uniwind).

Goal: a faithful migration. Every setting, storage key, constant, timer, message string and
piece of business logic from the web app is preserved unless it is physically impossible on
native (documented below).

## Module layout

| Web path                     | RN path                          |
|------------------------------|----------------------------------|
| lib/*.ts                     | src/lib/*.ts                     |
| lib/i18n/**                  | src/lib/i18n/**                  |
| components/providers/*       | src/components/providers/*       |
| components/ui/*              | src/components/ui/*              |
| components/auth/*            | src/components/auth/*            |
| components/features/music/*  | src/components/features/music/*  |
| components/features/community/ChatPanel.tsx | src/components/features/community/ChatPanel.tsx |
| app/layout.tsx               | src/app/_layout.tsx (providers tree order identical) |
| app/page.tsx                 | src/app/(app)/index.tsx          |
| app/login / register         | src/app/(auth)/login.tsx / register.tsx |

Import paths keep the `@/…` prefix unchanged (`@` → `src`), so `@/lib/saavn` or
`@/components/providers/ThemeProvider` look exactly like the web codebase.


## Platform substitutions (apply mechanically)

1. `localStorage` / `sessionStorage` → `@/lib/store` (AsyncStorage-backed, same keys, sync
   reads from an in-memory cache hydrated at boot; writes are fire-and-forget). Keys kept
   verbatim: `music-theme`, `zyrava:has-account`, `zyrava:auto-feed`, `zyrava:now-playing-tab`,
   `zyrava:login-dismissed`, `zyrava:install-dismissed`, `zyrava:visit-sent`, `zyrava:idle-seed`,
   `zyrava:client-id`, `zyrava:installed`, `amare.locale`, `amare.voice.output`,
   `amare.voice.mode`, `music.voice.language`, `zyrava:log:{userId}`, `zyrava-library:{userId}`.
2. `window.addEventListener(CustomEvent)` / `document.dispatchEvent` → `@/lib/emitter`
   (tiny typed event bus). Event names preserved verbatim (`music:theme-change`,
   `amare:locale`, `music:voice-language`, …).
3. `document.cookie` (locale cookie `amare_locale`) → store key `amare_locale` (cookie mirror).
4. `crypto.randomUUID()` → `@/lib/uuid` (global randomUUID where available, same fallback strings).
5. `crypto.subtle.digest("SHA-256")` → `crypto-js/sha256` (same UTF-8 digest; no native module needed).
6. node-forge DES decryption → crypto-js `DES` ECB (same key `38346591`, same iv semantics).
7. `AbortSignal.timeout(ms)` works in RN — keep.
8. `Intl` (lib/format) works in Hermes — keep.
9. Fetch cookies: RN ignores `credentials:'include'`; `@/lib/net` wraps fetch with a manual
   cookie jar (persisted via AsyncStorage in `zyrava:cookies`) that captures `set-cookie`
   (RN exposes it, comma-joined; we split defensively) and echoes `Cookie` + `X-CSRF-Token`
   exactly like the browser. Endpoint paths stay relative `/api/...` resolved against
   `EXPO_PUBLIC_API_URL`.
10. Next rewrites `/api/auth|library|community|visits` → resolved against the account API
    directly; `/api/music/*` uses the Next route handlers when
    `EXPO_PUBLIC_WEB_BASE_URL` is configured. Otherwise `src/lib/saavn.ts` and
    `src/lib/lrclib.ts` call upstreams directly, applying the web route's search
    limits and duplicate headroom. `MUSIC_API` mirrors (comma-separated) are
    configured via `EXPO_PUBLIC_MUSIC_API`. Public Expo environment variables
    must use literal `process.env.EXPO_PUBLIC_*` references to survive bundling.
11. `new Audio()` / `<audio>` → react-native-audio-api `<Audio>` element + `AudioContext`
    (`createMediaElementSource`). All Web-Audio node types used by the graph exist
    (Gain/StereoPanner/BiquadFilter/Convolver/Delay/WaveShaper/Analyser/Oscillator/
    ConstantSource/Panner HRTF/ChannelMerger/Splitter/IIRFilter). DynamicsCompressor does
    not exist natively → `src/lib/audio-graph.ts` provides a waveshaper+gain approximation
    with the same parameter surface (threshold/ratio/knee mapping) so every mixer setting
    still round-trips.
12. `navigator.mediaSession` → react-native-audio-api `PlaybackNotificationManager`
    (metadata + play/pause/next/prev/seek/skip events, 1:1 with the web handlers).
13. `Notification`/service worker (IdleNotifier) → expo-notifications local notification
    (same thresholds: 1 h first, 20 min early, 1 h late, 30 s tick, hidden-only, rotating
    messages, `zyrava:idle-seed`).
14. `window.speechSynthesis` (lib/speech.ts) → expo-speech with the same voice modes
    (male 0.85/1.0, female 1.35/1.0, kid 1.8/1.15 pitch/rate) and the same
    `amare.voice.output` / `amare.voice.mode` gating. The 20 s watchdog is preserved.
15. Web Speech recognition (lib/voice.ts): grammar/vocabulary module ports verbatim
    (pure logic). No component used the recognizer in the web build either — the registry
    (`voice-ops`) ports so behaviour stays identical.
16. IndexedDB offline store → expo-file-system: audio saved under
    `documentDirectory/zyrava-offline/{kind}/{id}{ext}` + metadata list in store key
    `zyrava:offline-tracks` (fields identical to `OfflineTrack`). `showDirectoryPicker`
    import → expo-document-picker (multi-select); `showSaveFilePicker` export →
    expo-sharing. Quota via `FileSystem.storageEstimateAsync` equivalent.
17. `navigator.locks` (playback wake lock) — native audio sessions already survive; dropped.
18. PWA install / beforeinstallprompt / manifest → not applicable natively. The install
    affordances are removed; the OfflineProvider device flow (downloads + local files) keeps
    all its logic. `zyrava:installed` is written at first launch (natively installed).
19. Service worker shell cache → not applicable; offline catalogue playback works via 16.
20. `matchMedia('(prefers-color-scheme)')` → RN `Appearance`; `userInterfaceStyle` handled by
    ThemeProvider writing `uniwind`'s color scheme + `dark` class equivalent.
21. Framer-motion → react-native-reanimated / heroui-native built-ins.
22. lucide-react / inline SVG icons → lucide-react-native + react-native-svg equivalents.
23. Tailwind classes → Uniwind `className` (v4, same utility names). The web `globals.css`
    token bridges are replicated in `src/global.css` with heroui-native theme variables.

## Storage keys inventory (all preserved)

See the table in analysis: every `zyrava:*`, `music-*`, `music.*`, `amare.*` key from the
web app exists in the mobile app with the same value format.

## What intentionally differs

- PWA-only surfaces (install sheet/modal, service worker, manifest, startup images).
- Web Audio `DynamicsCompressorNode` is approximated (node absent in the native engine).
- Speech recognition remains grammar-only (web never wired a mic UI in this fork).
- Navigation is expo-router; hash anchors (#library-list…) become scroll refs / routes.

## November 2026 mobile parity update

- Startup no longer imports the remote-push notifications barrel. Local reminders
  load only when the installed binary contains the scheduler and permissions APIs.
  Missing optional notification modules disable reminders, not routes or playback.
- File fingerprints use JavaScript SHA-256 with the same UTF-8 seed and digest as
  the web; ExpoCrypto is no longer required to import offline/library/player routes.
- Customize and Payments are home tabs and drawer destinations. Partner/birthday
  drafts, 144 palettes, custom hex values, animation previews/sets, loading messages,
  duration, masked directory search, incoming acceptance/removal and outgoing status
  use the existing account APIs. Payment history is paginated and scoped by the server.
- Account colours update shared Uniwind tokens. Logout, expiry and removal restore
  the original palette. The private account is identified by the server's experience
  flag; its hidden menus remain hidden when the admin appearance switch is off.
- Fullscreen lyrics has square artwork, a small timer, anchored transport and the
  three web dancing characters. Selecting a character replaces the artwork; pausing
  playback or backgrounding pauses the animation. Reduced motion uses a still frame.
- Native animation sources are bundled JSON, loaded on demand. Hidden retained tabs
  pause animation effects. Native scroll indicators remain platform controls.

### Mobile checkout

The mobile checkout uses Razorpay Standard Checkout in WebView with `callback_url`,
following [Razorpay's WebView integration](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/webview/).
Only the public key and frozen order details enter the checkout. The app sends no
session cookie or bearer token into it. Returning or closing checkout checks the
purchase with the authenticated server API; the redirect never proves payment.
Pending orders can be resumed/checked, and a failed order request reuses its persisted
idempotency key. Price comes from admin-controlled payment settings.

The server's new `/api/customization/payments/mobile-return` POST endpoint is a static
acknowledgement and must be included in the next server deployment. Order creation,
server-side capture checks, fulfilment and payment history reuse existing endpoints.
WebView checkout has payment-method limitations (including UPI Intent); a dedicated
native Razorpay SDK needs an installed build and cannot be added to Expo Go by a JS
reload. Test checkout on the intended device before a payment-enabled release.

### Verification and runtime

Run `npm test`, `npm run typecheck`, `npm run lint`, and
`npx expo export --platform android --max-workers 2`.
After dependency changes, restart Metro with `npx expo start --clear` and reload the
client. An installed development APK must be rebuilt to receive native package updates;
the startup guards and JavaScript hashing fallback work without those optional modules.
