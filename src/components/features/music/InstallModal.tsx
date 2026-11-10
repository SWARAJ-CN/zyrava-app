/* #18 PWA-only, kept so provider wiring compiles identically.
 *
 * The web InstallModal is the PWA download offer (ARRIVE_DELAY 900 ms,
 * `zyrava:install-dismissed` / `zyrava:open-app-dismissed` session marks,
 * the PERKS list, the splash-sweep installing bar, and the OpenAppModal
 * standalone bounce). A native build is already installed — there is nothing
 * to offer — so this renders null while the component's slot in the tree
 * (and every usePwa value it consumed) keeps compiling. Its copy lives on as
 * a no-op for the record: "Take the music with you", "Download this as an
 * app on your device — no store, no extra account.", "Ignore" / "Download" /
 * "Installing", "Open ZYRAVA", "The app is already installed — this is just
 * the browser tab it lives in.", "Keep browsing here" / "Open app". */
export function InstallModal(): null {
  return null;
}
