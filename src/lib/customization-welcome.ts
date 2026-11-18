import {
  isCustomizationConfig,
  isCustomizationExpired,
  type AppliedCustomization,
} from "./customization";
export interface CustomizationWelcome {
  userId: string;
  identifier: string;
  personal: boolean;
  active: AppliedCustomization | null;
}
export function readWelcome(value: unknown): CustomizationWelcome | null {
  if (!value || typeof value !== "object") return null;
  const hint = value as CustomizationWelcome;
  if (
    typeof hint.userId !== "string" ||
    typeof hint.identifier !== "string" ||
    typeof hint.personal !== "boolean"
  )
    return null;
  if (
    hint.active &&
    (!isCustomizationConfig(hint.active.config) || isCustomizationExpired(hint.active))
  )
    return { ...hint, active: null };
  return hint;
}
