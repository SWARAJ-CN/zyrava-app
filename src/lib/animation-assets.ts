// Bundled JSON extracted from the web app’s original dotLottie assets.
export const ANIMATION_ASSETS = {
  "moments-7": () =>
    require("../../assets/animations/customization/custom-moments-7-baa76dfa.json"),
  "lyrics-heart": () => require("../../assets/animations/customization/lyrics-heart-72f46866.json"),
  "personal-header": () =>
    require("../../assets/animations/customization/personal-header-80d44961.json"),
  "personal-welcome": () =>
    require("../../assets/animations/customization/personal-welcome-0bf92b1d.json"),
  "couples-1": () =>
    require("../../assets/animations/customization/custom-couples-1-f3ee3b57.json"),
  "moments-4": () =>
    require("../../assets/animations/customization/custom-moments-4-6418843b.json"),
  "moments-5": () =>
    require("../../assets/animations/customization/custom-moments-5-359a8420.json"),
  "couples-2": () =>
    require("../../assets/animations/customization/custom-couples-2-a74f1184.json"),
  "couples-4": () =>
    require("../../assets/animations/customization/custom-couples-4-5e7e9938.json"),
  "moments-6": () =>
    require("../../assets/animations/customization/custom-moments-6-61d11da8.json"),
  "moments-3": () =>
    require("../../assets/animations/customization/custom-moments-3-4f4fea5e.json"),
  "moments-1": () =>
    require("../../assets/animations/customization/custom-moments-1-006a3210.json"),
  "couples-3": () =>
    require("../../assets/animations/customization/custom-couples-3-48699dc3.json"),
  "moments-2": () =>
    require("../../assets/animations/customization/custom-moments-2-77e997ed.json"),
} as const;
export type BundledAnimation = keyof typeof ANIMATION_ASSETS;
