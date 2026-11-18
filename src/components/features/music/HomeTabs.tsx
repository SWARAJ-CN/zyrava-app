import { useCustomization } from "@/components/providers/CustomizationProvider";
import { Activity, memo, useState, type ReactNode } from "react";
import { View } from "react-native";
import { Tabs } from "heroui-native";
import { useReduceMotion } from "@/hooks/useReduceMotion";

export const HOME_TABS = [
  { value: "songs", label: "Songs" },
  { value: "playlists", label: "Playlists" },
  { value: "liked", label: "Liked songs" },
  { value: "downloads", label: "Downloads" },
  { value: "offline", label: "Offline" },
  { value: "customize", label: "Customize" },
  { value: "payments", label: "Payments" },
] as const;

export type HomeTab = (typeof HOME_TABS)[number]["value"];

/** Measurements and indicator motion stay inside HeroUI, away from the feed. */
export const HomeTabs = memo(function HomeTabs({
  value,
  onChange,
}: {
  value: HomeTab;
  onChange: (value: HomeTab) => void;
}) {
  const { personal } = useCustomization();
  const reducedMotion = useReduceMotion();
  return (
    <Tabs
      value={value}
      onValueChange={(next) => onChange(next as HomeTab)}
      variant="secondary"
      animation={reducedMotion ? "disable-all" : undefined}
      className="mt-4 gap-0"
    >
      <Tabs.List className="w-full border-0">
        <Tabs.ScrollView scrollAlign="center" showsHorizontalScrollIndicator={false}>
          <Tabs.Indicator className="border-accent" />
          {HOME_TABS.filter(
            (tab) => !personal || (tab.value !== "customize" && tab.value !== "payments")
          ).map((tab) => (
            <Tabs.Trigger key={tab.value} value={tab.value} className="min-h-12 px-4">
              {({ isSelected }) => (
                <Tabs.Label
                  className={
                    isSelected ? "text-base font-semibold text-foreground" : "text-base text-muted"
                  }
                >
                  {tab.label}
                </Tabs.Label>
              )}
            </Tabs.Trigger>
          ))}
        </Tabs.ScrollView>
      </Tabs.List>
    </Tabs>
  );
});

/** Visit once, then retain native views/scroll position while pausing hidden effects. */
export function HomeTabPanel({ active, children }: { active: boolean; children: ReactNode }) {
  const [visited, setVisited] = useState(active);
  if (active && !visited) setVisited(true);
  if (!active && !visited) return null;
  return (
    <Activity mode={active ? "visible" : "hidden"}>
      <View
        className="flex-1"
        accessibilityElementsHidden={!active}
        importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      >
        {children}
      </View>
    </Activity>
  );
}
