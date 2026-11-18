import { memo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { CUSTOM_PALETTES, type CustomizationConfig } from "@/lib/customization";
import { Button } from "@/components/ui/Button";

const PAGE_SIZE = 24;
const PAGE_COUNT = Math.ceil(CUSTOM_PALETTES.length / PAGE_SIZE);
type Palette = (typeof CUSTOM_PALETTES)[number];
const Swatch = memo(function Swatch({
  palette,
  selected,
  onSelect,
}: {
  palette: Palette;
  selected: boolean;
  onSelect: (patch: Partial<CustomizationConfig>) => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={palette.name}
      accessibilityState={{ selected }}
      onPress={() =>
        onSelect({
          accent: palette.accent,
          surface: palette.surface,
          background: palette.background,
          text: palette.text,
        })
      }
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: palette.accent,
        borderWidth: selected ? 3 : 0,
        borderColor: "white",
      }}
    />
  );
});

/** Keep all 144 choices while mounting only one small page of native buttons. */
export const ColorPalettePicker = memo(function ColorPalettePicker({
  accent,
  onSelect,
}: {
  accent: string;
  onSelect: (patch: Partial<CustomizationConfig>) => void;
}) {
  const [page, setPage] = useState(0);
  return (
    <View className="gap-3">
      <Text className="text-base font-semibold text-foreground">144 colour palettes</Text>
      <View className="flex-row flex-wrap gap-2">
        {CUSTOM_PALETTES.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((palette) => (
          <Swatch
            key={palette.name}
            palette={palette}
            selected={palette.accent === accent}
            onSelect={onSelect}
          />
        ))}
      </View>
      <View className="flex-row items-center justify-between gap-3">
        <Button
          variant="secondary"
          size="sm"
          disabled={page === 0}
          onPress={() => setPage((value) => value - 1)}
        >
          Previous colours
        </Button>
        <Text accessibilityLiveRegion="polite" className="text-xs text-muted">
          {page + 1} / {PAGE_COUNT}
        </Text>
        <Button
          variant="secondary"
          size="sm"
          disabled={page === PAGE_COUNT - 1}
          onPress={() => setPage((value) => value + 1)}
        >
          More colours
        </Button>
      </View>
    </View>
  );
});
