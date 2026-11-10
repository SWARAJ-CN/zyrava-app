import { type ComponentType, type ReactNode } from "react";
import { Text, View } from "react-native";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react-native";
import { Card, Chip, useThemeColor } from "heroui-native";
import { cn } from "@/lib/cn";
import { formatPercent } from "@/lib/format";
import { Sparkline } from "@/components/charts/Sparkline";
import { useSourceColor } from "./icons";

/** lucide-react-native components accept exactly this subset of props. */
export type StatIcon = ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

interface StatCardProps {
  label: string;
  value: string;
  icon: StatIcon;
  /** A raw color or a `var(--token)` reference; resolved through Uniwind. */
  accent?: string;
  change?: number | null;
  changeLabel?: string;
  /** true when a rise is good (revenue), false when a rise is bad (expenses). */
  positiveIsGood?: boolean;
  spark?: number[];
  hint?: string;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  accent = "var(--brand)",
  change = null,
  changeLabel,
  positiveIsGood = true,
  spark,
  hint,
}: StatCardProps): ReactNode {
  const rising = (change ?? 0) > 0.05;
  const falling = (change ?? 0) < -0.05;
  const good = rising ? positiveIsGood : falling ? !positiveIsGood : true;
  const TrendIcon = rising ? ArrowUpRight : falling ? ArrowDownRight : Minus;

  // `color-mix(in oklch, accent 14%, transparent)` is approximated with a
  // 14%-opacity tint layer under the icon — same look, native-safe.
  const accentColor = useSourceColor(accent);
  const trendColor = useThemeColor(good ? "success" : "danger");

  return (
    <Card className="gap-3 overflow-clip p-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0">
          <Text className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</Text>
          <Text className="mt-1.5 text-2xl font-bold tabular-nums text-foreground">{value}</Text>
        </View>
        <View className="size-9 flex-none items-center justify-center overflow-hidden rounded-xl">
          <View
            className="absolute inset-0"
            style={{ backgroundColor: accentColor, opacity: 0.14 }}
          />
          <Icon size={20} color={accentColor} />
        </View>
      </View>

      <View className="flex-row items-end justify-between gap-3">
        <View className="min-w-0 flex-1">
          {change !== null ? (
            <Chip
              color={good ? "success" : "danger"}
              variant="soft"
              size="sm"
              className={cn("gap-1 font-semibold")}
            >
              {/* The chip root is a flex row; the label itself must stay plain text. */}
              <TrendIcon size={14} color={trendColor} />
              <Chip.Label>{formatPercent(change)}</Chip.Label>
            </Chip>
          ) : null}
          {changeLabel ? (
            <Text className="mt-1 text-[11px] text-muted">{changeLabel}</Text>
          ) : hint ? (
            <Text className="mt-1 text-[11px] text-muted">{hint}</Text>
          ) : null}
        </View>
        {spark && spark.length > 1 ? (
          <Sparkline
            values={spark}
            color={accent}
            width={110}
            height={34}
            className="h-8 w-24 flex-none opacity-80"
          />
        ) : null}
      </View>
    </Card>
  );
}
