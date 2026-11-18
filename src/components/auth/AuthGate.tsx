import { useCustomization } from "@/components/providers/CustomizationProvider";
import { useEffect, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { usePathname, useRootNavigationState, useRouter, type Href } from "expo-router";
import { useThemeColor } from "heroui-native";
import { useAuth } from "@/components/providers/AuthProvider";
import { AuthLoadingScreen } from "./AuthLoadingScreen";

const PUBLIC_ROUTES = new Set(["/login", "/register"]);

export function AuthGate({ children }: { children: ReactNode }) {
  const { welcome } = useCustomization();
  const pathname = usePathname();
  const router = useRouter();
  const navigation = useRootNavigationState();
  const background = useThemeColor("background");
  const { status, expired } = useAuth();
  const isPublic = PUBLIC_ROUTES.has(pathname);
  const mustSignIn = status === "anonymous" && expired && !isPublic;
  const blocked = !isPublic && (status === "loading" || mustSignIn);

  useEffect(() => {
    if (!navigation?.key || !mustSignIn) return;
    const next = pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
    router.replace(`/login${next}` as Href);
  }, [navigation?.key, mustSignIn, pathname, router]);

  // Expo Router needs its root navigator mounted before any redirect. Keep it
  // mounted behind the loading screen instead of replacing the entire Stack.
  return (
    <View style={{ flex: 1, backgroundColor: background }}>
      <View
        style={{ flex: 1 }}
        pointerEvents={blocked ? "none" : "auto"}
        accessibilityElementsHidden={blocked}
        importantForAccessibility={blocked ? "no-hide-descendants" : "auto"}
      >
        {children}
      </View>
      {blocked ? (
        <View style={StyleSheet.absoluteFill}>
          <AuthLoadingScreen welcome={welcome} allowWake={status === "loading"} />
        </View>
      ) : null}
    </View>
  );
}
