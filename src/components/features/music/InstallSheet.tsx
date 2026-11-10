/* #18 PWA-only, kept so provider wiring compiles identically.
 *
 * The web InstallSheet is the three-taps Safari flow (beforeinstallprompt has
 * no native meaning; the app ships through the store). The component is
 * mounted by AppChrome exactly where the web mounts it and renders nothing —
 * usePwa's sheetOpen/closeSheet stay wired for anything that still reads
 * them. All copy lives on here as a no-op for the record:
 *
 *   "Add ZYRAVA to your home screen" / "iPhone and iPad install an app this
 *   way — Safari does the rest." / "Not now" / "Got it", plus the three STEPS
 *   and the "Safari only: Chrome and Firefox on iPhone have no such menu…"
 *   note (see the web file for the full strings).
 */
export function InstallSheet(): null {
  return null;
}
