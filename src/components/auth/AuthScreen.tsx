import { Animation } from "@/components/ui/Animation";
import { useCustomization } from "@/components/providers/CustomizationProvider";
import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useThemeColor } from "heroui-native";
import { Check, Eye, EyeOff, Lock, Mail, Phone, User } from "lucide-react-native";

import { ClickButton } from "@/components/ui/ClickButton";
import { Input } from "@/components/ui/Input";
import { Icon } from "@/components/ui/icons";
import { TrendingCarousel } from "@/components/auth/TrendingCarousel";
import { AuthLoadingScreen } from "@/components/auth/AuthLoadingScreen";
import { useAuth } from "@/components/providers/AuthProvider";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { TrendingSlide } from "@/lib/trending";

/* ------------------------------------------------------------------ *
 * The web AuthScreen, ported for the phone.
 *
 * Validation, regexes, error copy, the register method toggle, the
 * `remember for 30 days` flag, per-field ApiError.details mapping, the
 * `?next=` safety rule and the signed-in auto-redirect are all verbatim.
 *
 * Platform shape only:
 *  • The web's two-column layout and its desktop "compact hidden / aside
 *    shown" split collapse into the compact phone build — SafeArea, scrollable
 *    card, the trending card above the form.
 *  • `<form onSubmit>` → the same `submit()` driven by the button and by
 *    `onSubmitEditing` on the password field.
 *  • `window.location.search` → the expo-router `next` param, through the
 *    identical `safeNext`.
 *  • The ported `Input` keeps the web call-site surface (`type=`, DOM-ish
 *    `onChange`, `aria-invalid`), so the fields read like the web source.
 *  • `title` tooltips are pointer-only affordances and are dropped
 *    (accessibilityLabel carries the same words to screen readers).
 * ------------------------------------------------------------------ */

type Mode = "login" | "register";
type Method = "email" | "phone";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?\d{8,15}$/;

function cleanPhone(value: string) {
  return value.replace(/[\s()\-.]/g, "");
}

/** Only same-origin paths may be used as a post-login destination. */
function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export function AuthScreen({
  mode,
  initialSlides = [],
}: {
  mode: Mode;
  initialSlides?: TrendingSlide[];
}) {
  const router = useRouter();
  const { welcome } = useCustomization();
  const { status, login, register } = useAuth();
  const isRegister = mode === "register";
  // expo-router hands us `?next=` as a route param; same rules as the web.
  const params = useLocalSearchParams<{ next?: string | string[] }>();
  const rawNext = Array.isArray(params.next) ? (params.next[0] ?? null) : (params.next ?? null);
  const nextPath = safeNext(rawNext);

  const [method, setMethod] = useState<Method>("email");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [identifier, setIdentifier] = useState("");
  const personalWelcome =
    !isRegister &&
    welcome?.personal &&
    (!identifier.trim() || identifier.trim().toLowerCase() === welcome.identifier.toLowerCase());
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const accent = useThemeColor("accent");
  const accentForeground = useThemeColor("accent-foreground");
  const muted = useThemeColor("muted");
  const background = useThemeColor("background");

  // A signed-in visitor has no business on the auth screens.
  useEffect(() => {
    if (status === "authenticated") router.replace(nextPath as Href);
  }, [status, router, nextPath]);

  const validate = (): boolean => {
    const next: Record<string, string> = {};

    if (isRegister && name.trim() && name.trim().length < 2) {
      next.name = "Use at least 2 characters.";
    }

    if (isRegister) {
      if (method === "email" && !EMAIL.test(email.trim())) {
        next.email = "Enter a valid email address.";
      }
      if (method === "phone" && !PHONE.test(cleanPhone(phone))) {
        next.phone = "Use 8–15 digits, optionally starting with +.";
      }
    } else if (!identifier.trim()) {
      next.identifier = "Enter your email or phone number.";
    }

    if (isRegister) {
      if (password.length < 8) next.password = "Use at least 8 characters.";
      else if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
        next.password = "Mix letters and numbers.";
      }
    } else if (!password) {
      next.password = "Enter your password.";
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    if (busy || status === "loading") return;
    setFormError(null);
    if (!validate()) return;

    setBusy(true);
    try {
      if (isRegister) {
        await register({
          name: name.trim() || undefined,
          email: method === "email" ? email.trim() : undefined,
          phone: method === "phone" ? cleanPhone(phone) : undefined,
          password,
          remember,
        });
      } else {
        await login({ identifier: identifier.trim(), password, remember });
      }
      // The authenticated-status effect owns navigation, so a successful
      // request cannot dispatch two replacements of the root stack.
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(error.message);
        if (error.details?.length) {
          const mapped: Record<string, string> = {};
          for (const detail of error.details) {
            mapped[detail.path.replace(/^body\./, "")] ??= detail.message;
          }
          setErrors(mapped);
        }
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  const fieldError = (key: string) =>
    errors[key] ? (
      <Text className="text-[11px] font-medium text-danger-soft-foreground">{errors[key]}</Text>
    ) : null;

  const label = (text: string, extra?: string) => (
    <Text className="text-[11px] font-semibold uppercase tracking-[0.55px] text-muted">
      {text}
      {extra ? (
        <Text className="normal-case tracking-normal text-faint-foreground"> {extra}</Text>
      ) : null}
    </Text>
  );

  return (
    <View style={{ flex: 1, backgroundColor: background }}>
      <SafeAreaView
        edges={["top", "bottom", "left", "right"]}
        style={{ flex: 1, backgroundColor: background }}
        accessibilityElementsHidden={busy || status === "loading"}
        importantForAccessibility={busy || status === "loading" ? "no-hide-descendants" : "auto"}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          {/* Header row — brand and the studio line, as on the web column. */}
          <View className="flex-row items-center justify-between gap-3 px-5 pt-6 pb-2">
            <View className="flex-row items-center gap-2">
              <View
                className="size-7 items-center justify-center"
                style={{ borderRadius: 0.55 * 16, backgroundColor: accent }}
              >
                <Icon name="music" size={14} color={accentForeground} strokeWidth={2.2} />
              </View>
              <Text className="text-xs font-bold uppercase tracking-[2.4px] text-foreground">
                ZYRAVA
              </Text>
            </View>
            <Text className="text-[10px] font-medium uppercase tracking-[1.6px] text-faint-foreground">
              Private listening studio
            </Text>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroller}>
            {/* The mobile variant's trending card sits above the form. */}
            <View className="w-full max-w-sm self-center pb-7">
              {personalWelcome ? (
                <View
                  style={{
                    backgroundColor: welcome.config.surface,
                    borderRadius: 24,
                    padding: 20,
                    alignItems: "center",
                  }}
                >
                  <Animation id="personal-header" style={{ width: 240, height: 180 }} />
                  <Text style={{ color: welcome.config.text, fontSize: 22, fontWeight: "700" }}>
                    Welcome back, Baava
                  </Text>
                  <Text
                    style={{
                      color: welcome.config.accent,
                      fontSize: 12,
                      textAlign: "center",
                      marginTop: 12,
                    }}
                  >
                    Crafted with love for Vimitha — my Baava.
                  </Text>
                </View>
              ) : (
                <TrendingCarousel initialSlides={initialSlides} />
              )}
            </View>

            <View className="w-full max-w-sm self-center py-10">
              <Text className="text-[10px] font-semibold uppercase tracking-[1.8px] text-brand">
                {isRegister ? "Create your account" : "Welcome back"}
              </Text>
              <Text className="mt-2 text-[2rem] font-bold leading-[35px] tracking-[-0.8px] text-foreground">
                {isRegister ? "Join the studio." : "Sign in to ZYRAVA."}
              </Text>
              <Text className="mt-2 text-sm text-muted" style={{ lineHeight: 20 }}>
                {isRegister
                  ? "One account for your queue, saved mixes and the console."
                  : "Your queue and saved mixes are waiting."}
              </Text>

              <View className="mt-7 gap-4">
                {isRegister ? (
                  <>
                    {/* Register: which credential opens the account. */}
                    <View className="flex-row gap-1 rounded-xl border border-separator bg-surface p-1">
                      {(["email", "phone"] as const).map((option) => (
                        <Pressable
                          key={option}
                          onPress={() => {
                            setMethod(option);
                            setErrors({});
                          }}
                          accessibilityRole="button"
                          accessibilityState={{ selected: method === option }}
                          className={cn(
                            "h-9 flex-1 flex-row items-center justify-center gap-2 rounded-lg text-xs font-semibold",
                            method === option ? "bg-accent text-accent-foreground" : "text-muted"
                          )}
                        >
                          {option === "email" ? (
                            <Mail size={14} color={method === option ? accentForeground : muted} />
                          ) : (
                            <Phone size={14} color={method === option ? accentForeground : muted} />
                          )}
                          <Text
                            style={{
                              color: method === option ? accentForeground : muted,
                              fontSize: 12,
                              fontWeight: "600",
                            }}
                          >
                            {option === "email" ? "Email" : "Phone"}
                          </Text>
                        </Pressable>
                      ))}
                    </View>

                    <View className="gap-1.5">
                      {label("Name", "(optional)")}
                      <View className="relative">
                        <View pointerEvents="none" style={styles.leadingIcon}>
                          <User size={16} color={muted} />
                        </View>
                        <Input
                          type="text"
                          value={name}
                          onChange={(event) => setName(event.target.value)}
                          autoComplete="name"
                          placeholder="Your name"
                          className="h-11 w-full rounded-xl ps-10"
                          aria-invalid={Boolean(errors.name)}
                        />
                      </View>
                      {fieldError("name")}
                    </View>

                    {method === "email" ? (
                      <View className="gap-1.5">
                        {label("Email")}
                        <View className="relative">
                          <View pointerEvents="none" style={styles.leadingIcon}>
                            <Mail size={16} color={muted} />
                          </View>
                          <Input
                            type="email"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            autoComplete="email"
                            placeholder="you@example.com"
                            className="h-11 w-full rounded-xl ps-10"
                            aria-invalid={Boolean(errors.email)}
                          />
                        </View>
                        {fieldError("email")}
                      </View>
                    ) : (
                      <View className="gap-1.5">
                        {label("Phone number")}
                        <View className="relative">
                          <View pointerEvents="none" style={styles.leadingIcon}>
                            <Phone size={16} color={muted} />
                          </View>
                          <Input
                            type="tel"
                            value={phone}
                            onChange={(event) => setPhone(event.target.value)}
                            autoComplete="tel"
                            placeholder="+91 98765 43210"
                            className="h-11 w-full rounded-xl ps-10"
                            aria-invalid={Boolean(errors.phone)}
                          />
                        </View>
                        {fieldError("phone")}
                      </View>
                    )}
                  </>
                ) : (
                  <View className="gap-1.5">
                    {label("Email or phone")}
                    <View className="relative">
                      <View pointerEvents="none" style={styles.leadingIcon}>
                        <Mail size={16} color={muted} />
                      </View>
                      <Input
                        type="text"
                        value={identifier}
                        onChange={(event) => setIdentifier(event.target.value)}
                        autoComplete="username"
                        placeholder="you@example.com or +91…"
                        className="h-11 w-full rounded-xl ps-10"
                        aria-invalid={Boolean(errors.identifier)}
                      />
                    </View>
                    {fieldError("identifier")}
                  </View>
                )}

                <View className="gap-1.5">
                  {label("Password")}
                  <View className="relative">
                    <View pointerEvents="none" style={styles.leadingIcon}>
                      <Lock size={16} color={muted} />
                    </View>
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete={isRegister ? "new-password" : "current-password"}
                      placeholder={isRegister ? "At least 8 characters" : "Your password"}
                      className="h-11 w-full rounded-xl ps-10 pe-11"
                      aria-invalid={Boolean(errors.password)}
                      /* The native stand-in for pressing Enter in the web form. */
                      returnKeyType="go"
                      onSubmitEditing={() => void submit()}
                    />
                    <Pressable
                      onPress={() => setShowPassword((visible) => !visible)}
                      accessibilityRole="button"
                      accessibilityLabel={showPassword ? "Hide password" : "Show password"}
                      className="absolute end-1.5 size-8 items-center justify-center rounded-lg"
                      style={{ top: 6 }}
                    >
                      {showPassword ? (
                        <EyeOff size={16} color={muted} />
                      ) : (
                        <Eye size={16} color={muted} />
                      )}
                    </Pressable>
                  </View>
                  {fieldError("password")}
                </View>

                <Pressable
                  onPress={() => setRemember((value) => !value)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: remember }}
                  className="flex-row items-center gap-2.5 self-start"
                >
                  <View
                    className={cn(
                      "size-4 items-center justify-center border border-separator bg-surface",
                      remember && "bg-accent"
                    )}
                  >
                    {remember ? <Check size={12} color={accentForeground} strokeWidth={3} /> : null}
                  </View>
                  <Text className="text-xs font-medium text-muted">
                    Remember me <Text className="text-faint-foreground">for 30 days</Text>
                  </Text>
                </Pressable>

                {formError ? (
                  <View
                    accessibilityRole="alert"
                    className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2"
                  >
                    <Text className="text-xs font-medium text-danger-soft-foreground">
                      {formError}
                    </Text>
                  </View>
                ) : null}

                <ClickButton
                  onPress={() => void submit()}
                  loading={busy || status === "loading"}
                  className="h-11 w-full rounded-none text-[13px] font-semibold"
                >
                  {busy || status === "loading"
                    ? "One moment…"
                    : isRegister
                      ? "Create account"
                      : "Sign in"}
                </ClickButton>
              </View>

              <Text className="mt-6 text-center text-xs text-muted">
                {isRegister ? "Already have an account?" : "New to ZYRAVA?"}{" "}
                <Text
                  onPress={() => router.push(isRegister ? "/login" : "/register")}
                  className="font-semibold text-brand"
                >
                  {isRegister ? "Sign in" : "Create one"}
                </Text>
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
      {busy || status === "loading" ? (
        <View style={StyleSheet.absoluteFill}>
          <AuthLoadingScreen
            welcome={
              welcome?.identifier.toLowerCase() === identifier.trim().toLowerCase() ? welcome : null
            }
          />
        </View>
      ) : null}
    </View>
  );
}

/* Scroller padding mirrors `my-auto … py-10` and the web column's px-5;
   the typographic tracking lives in `tracking-[…]` classes (em values
   resolved to px once, exactly what the browser computes). */
const styles = StyleSheet.create({
  scroller: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 20, paddingVertical: 8 },
  leadingIcon: {
    position: "absolute",
    left: 12,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
});
