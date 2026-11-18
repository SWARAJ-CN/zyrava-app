import type { AnimationObject } from "lottie-react-native";

/** Native JSON rendering has no access to a dotLottie archive's images folder.
 * Reject unresolved image filenames before Android tries to draw them: that
 * draw path throws on the UI thread, outside React error boundaries.
 */
export function isSelfContainedAnimation(source: unknown): source is AnimationObject {
  if (!source || typeof source !== "object") return false;
  const animation = source as { layers?: unknown; assets?: unknown };
  if (!Array.isArray(animation.layers)) return false;
  if (animation.assets === undefined) return true;
  if (!Array.isArray(animation.assets)) return false;
  return animation.assets.every((asset) => {
    if (!asset || typeof asset !== "object") return false;
    const image = asset as { p?: unknown; u?: unknown };
    if (image.p === undefined) return true; // Vector precomposition.
    return (
      typeof image.p === "string" &&
      /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.p) &&
      !image.u
    );
  });
}
