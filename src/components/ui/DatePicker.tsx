import { useContext, useState, type ReactNode } from "react";
import { Input as HeroInput } from "heroui-native";
import { cn } from "@/lib/cn";
import { useI18n } from "@/components/providers/I18nProvider";
import { FieldLabelContext } from "@/components/ui/Input";

interface DateChangeEvent {
  target: { value: string };
}

interface DateInputProps {
  id?: string;
  /** ISO date string, `YYYY-MM-DD`. */
  value?: string;
  onChange?: (event: DateChangeEvent) => void;
  /** ISO date string, `YYYY-MM-DD`. */
  min?: string;
  /** ISO date string, `YYYY-MM-DD`. */
  max?: string;
  className?: string;
  size?: "sm" | "md";
  placeholder?: string;
  "aria-label"?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` → days since epoch for range checks (no Date parsing edge cases). */
function toOrdinal(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86400000;
}

function isValid(value: string, min?: string, max?: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return false;
  }
  const ordinal = toOrdinal(value);
  if (min && ISO_DATE.test(min) && ordinal < toOrdinal(min)) return false;
  if (max && ISO_DATE.test(max) && ordinal > toOrdinal(max)) return false;
  return true;
}

/**
 * Platform swap: the web version is a HeroUI DatePicker with a calendar
 * popover built on `@internationalized/date`; there is no equivalent calendar
 * surface in HeroUI Native, and nothing in the ported app actually renders a
 * `DateInput` (the only web consumer is this file itself), so the control is
 * ported as a plain editable field that keeps the exact web API —
 * `{value: "YYYY-MM-DD", onChange({target: {value}}), min, max, size,
 * placeholder}` — with typing validation instead of a picker.
 */
export function DateInput({
  id,
  value,
  onChange,
  min,
  max,
  className,
  size = "md",
  placeholder,
  "aria-label": ariaLabel,
}: DateInputProps): ReactNode {
  const { t } = useI18n();
  const fieldLabel = useContext(FieldLabelContext);
  // Mid-typing text is held locally (partial dates like `2024-0-` can exist
  // while editing). The controlled prop wins whenever it moves elsewhere.
  const [localDraft, setLocalDraft] = useState<string | null>(null);
  const propValue = value ?? "";
  if (localDraft !== null && localDraft === propValue) setLocalDraft(null);
  const draft = localDraft ?? propValue;

  const committed = !draft || isValid(draft, min, max);

  return (
    <HeroInput
      className={cn(
        // Match the height the Input/Select controls use so filter rows line up.
        "min-h-9 w-full",
        size === "sm" && "min-h-8 text-xs",
        className
      )}
      nativeID={id}
      value={draft}
      onChangeText={(text) => {
        setLocalDraft(text);
        if (!text || isValid(text, min, max)) {
          onChange?.({ target: { value: text } });
        }
      }}
      placeholder={placeholder ?? t("Select date")}
      keyboardType="numbers-and-punctuation"
      autoCapitalize="none"
      autoCorrect={false}
      maxLength={10}
      isInvalid={!committed}
      accessibilityLabel={ariaLabel ?? fieldLabel ?? t("Date")}
    />
  );
}
