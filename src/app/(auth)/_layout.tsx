import type { JSX } from "react";
import { Stack } from "expo-router";
import { useThemeColor } from "heroui-native";

/** The account stack — login and register, no native headers, as on the web. */
export default function AuthLayout(): JSX.Element {
  const backgroundColor = useThemeColor("background");
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor } }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
    </Stack>
  );
}
