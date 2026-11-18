# Native customization animations

These JSON files retain the animation data from the dotLottie files in
`zyrava-client/zyrava/public/animations`. That directory's README records the
original user-supplied Lottie CDN URLs. Bundling the JSON makes previews and
characters available without a CDN request or a new native player dependency.

`src/lib/animation-assets.ts` loads each animation on demand. The three dancing
characters match the web: Dancing dog, Skeleton groove, and DJ groove.

Raster files stored inside the archive must be embedded as base64 data URIs in
JSON. In particular, Couples 2 contains `images/image_0.png`: its `e: 1` flag
alone does not embed the PNG. An unresolved filename makes Android Lottie throw
while drawing. Regenerate with `scripts/extract-lottie.py source.lottie target.json`;
the script preserves the original image bytes and fails on missing assets.

Playback uses declarative `speed`/`autoPlay` props. Do not dispatch `pause()` or
`resume()` from effect cleanup: React Activity and source replacement can detach
Lottie's native view before cleanup executes. Customize mounts one preview only
when requested and removes it when the tab is inactive.
