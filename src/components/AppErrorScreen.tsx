import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ErrorBoundaryProps } from "expo-router";
import * as SplashScreen from "expo-splash-screen";

/** Keep recovery independent of fonts, themes, and providers that may have failed. */
export function AppErrorScreen({ retry }: ErrorBoundaryProps) {
  const [pending, setPending] = useState(false);
  return (
    <View
      style={styles.screen}
      onLayout={() => {
        void SplashScreen.hideAsync().catch(() => undefined);
      }}
    >
      <Text accessibilityRole="header" style={styles.title}>
        Let’s try that again
      </Text>
      <Text style={styles.body}>
        This screen couldn’t open. Retry to reload it. If it keeps happening, close and reopen the
        app.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: pending, busy: pending }}
        disabled={pending}
        style={styles.button}
        onPress={() => {
          setPending(true);
          void Promise.resolve()
            .then(retry)
            .catch(() => undefined)
            .finally(() => setPending(false));
        }}
      >
        <Text style={styles.label}>{pending ? "Retrying…" : "Try again"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#000",
    padding: 28,
    justifyContent: "center",
    alignItems: "center",
  },
  title: { color: "#fff", fontSize: 24, fontWeight: "700", textAlign: "center" },
  body: {
    color: "#b5b5b5",
    fontSize: 15,
    lineHeight: 23,
    textAlign: "center",
    marginTop: 12,
    maxWidth: 420,
  },
  button: {
    backgroundColor: "#fff",
    borderRadius: 24,
    paddingHorizontal: 28,
    minHeight: 48,
    justifyContent: "center",
    marginTop: 24,
  },
  label: { color: "#000", fontSize: 15, fontWeight: "600" },
});
