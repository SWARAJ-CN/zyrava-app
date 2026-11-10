import type { JSX } from "react";
import { Stack } from "expo-router";

/** The account stack — login and register, no native headers, as on the web. */
export default function AuthLayout(): JSX.Element {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
    </Stack>
  );
}
