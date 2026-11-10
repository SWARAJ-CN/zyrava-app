import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useToast as useHeroToast } from "heroui-native";
import { announce } from "@/lib/announcer";
import { useI18n } from "./I18nProvider";
import { localeInfo } from "@/lib/i18n/locales";

type Variant = "success" | "error" | "info" | "warning";

interface ToastInput {
  title: string;
  description?: string;
  variant?: Variant;
}

interface ToastContextValue {
  toast: (input: ToastInput) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const VARIANT: Record<Variant, "accent" | "success" | "warning" | "danger"> = {
  success: "success",
  error: "danger",
  info: "accent",
  warning: "warning",
};

/**
 * The web rendered `<Toast.Provider placement="bottom end" />` here; on native
 * the toast stack is mounted once in the root layout through the
 * HeroUINativeProvider `toast` config (placement bottom), so this provider only
 * exposes the same call surface on top of it.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { locale } = useI18n();
  const { toast: heroToast } = useHeroToast();
  /* A toast carries the shop's own words, written in the language of the
     interface — so it is spoken in that language, whatever the assistant
     itself is speaking. */
  const speech = localeInfo(locale).speech;

  const value = useMemo<ToastContextValue>(() => {
    const show = ({ title, description, variant = "info" }: ToastInput) => {
      heroToast.show({ label: title, description, variant: VARIANT[variant] });
      /* The voice says what the toast says, so the reader does not have to
         look at the screen to know something went through. */
      announce(description ? `${title}. ${description}` : title, { lang: speech });
    };
    return {
      toast: show,
      success: (title, description) => show({ title, description, variant: "success" }),
      error: (title, description) => show({ title, description, variant: "error" }),
    };
  }, [heroToast, speech]);

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider");
  return context;
}
