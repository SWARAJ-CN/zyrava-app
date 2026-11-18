import { Text, View } from "react-native";
import { useCustomization } from "@/components/providers/CustomizationProvider";
import { Animation } from "@/components/ui/Animation";
export function PersonalHeader() {
  const { config, personalTheme, state } = useCustomization();
  if (!config) return null;
  return (
    <View className="my-3 overflow-hidden rounded-3xl bg-surface px-5 py-4">
      <View className="flex-row items-center gap-3">
        <View className="min-w-0 flex-1">
          <Text className="text-xl font-bold text-foreground">{config.title}</Text>
          {config.wishMessage ? (
            <Text className="mt-2 text-sm text-muted">{config.wishMessage}</Text>
          ) : null}
          <Text className="mt-2 text-xs text-muted">
            {personalTheme
              ? "Crafted with love for Vimitha — my Baava."
              : `Made by ${state.active?.creator.name || "a music lover"}${state.active?.creator.email ? ` · ${state.active.creator.email}` : ""}`}
          </Text>
        </View>
        <Animation
          id={personalTheme ? "personal-header" : config.headerAnimation}
          style={{ width: 140, height: 140 }}
        />
      </View>
    </View>
  );
}
