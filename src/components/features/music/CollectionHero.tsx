import type { ReactNode } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { useUniwind } from "uniwind";
import { Scrim } from "@/components/ui/Scrim";

/**
 * Spotify's collection header — a gradient band with the cover sitting on the
 * text block: eyebrow, oversized title, quiet meta line, then whatever actions
 * the view wants parked underneath (play, shuffle, add…).
 *
 * next/image `fill` → an absolute cover-fitted RN Image; the `line-clamp-2`
 * meta line becomes numberOfLines. The web's `bg-gradient-to-b` band keeps its
 * class — where the native engine can't paint the gradient it falls back to
 * the surface colour underneath, and the layout is untouched.
 */
export function CollectionHero({
  eyebrow,
  title,
  meta,
  image,
  glyph = "list",
  tone = "brand",
  flush = false,
  square = true,
  children,
}: {
  eyebrow: string;
  title: string;
  meta: string;
  image?: string;
  glyph?: "list" | "heart" | "music" | "download";
  tone?: "brand" | "plain";
  /** Bleeds to the container's edges — for headers inside a dialog. */
  flush?: boolean;
  /** Square surfaces for collections that do not use rounded artwork/cards. */
  square?: boolean;
  children?: ReactNode;
}) {
  const { theme } = useUniwind();

  return (
    <View
      className={cn(
        "relative overflow-hidden px-4 pb-5 pt-6 sm:px-6",
        flush && "border-b border-separator",
        !flush && (square ? "rounded-none" : "rounded-xl"),
        tone === "brand" ? "bg-surface" : "bg-surface-secondary"
      )}
    >
      {tone === "brand" ? (
        // The web's 14% brand-soft band, painted from resolved accent stops.
        <Scrim
          className="absolute inset-0"
          direction="down"
          colors={
            theme === "dark"
              ? ["rgba(124, 211, 184, 0.13)", "rgba(124, 211, 184, 0.02)", "rgba(0,0,0,0)"]
              : ["rgba(45, 158, 133, 0.10)", "rgba(45, 158, 133, 0.02)", "rgba(0,0,0,0)"]
          }
        />
      ) : null}
      <View className="flex-row items-end gap-4">
        <View
          className={cn(
            "relative size-24 flex-none overflow-hidden bg-surface-secondary sm:size-28",
            square ? "rounded-none" : "rounded-lg"
          )}
        >
          {image ? (
            <Image
              source={{ uri: image }}
              className="absolute inset-0 size-full"
              resizeMode="cover"
            />
          ) : (
            <Icon
              name={glyph}
              className={cn(
                "absolute left-1/2 top-1/2 size-9 -translate-x-1/2 -translate-y-1/2",
                tone === "brand" ? "text-brand" : "text-faint-foreground"
              )}
            />
          )}
        </View>

        <View className="min-w-0 flex-1">
          <Text className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
            {eyebrow}
          </Text>
          <Text
            numberOfLines={1}
            className="mt-1 truncate text-2xl font-black tracking-tight text-foreground sm:text-3xl lg:text-4xl"
          >
            {title}
          </Text>
          <Text numberOfLines={2} className="mt-1.5 line-clamp-2 text-xs text-muted">
            {meta}
          </Text>
        </View>
      </View>

      {children ? (
        <View className="mt-4 flex-row flex-wrap items-center gap-3">{children}</View>
      ) : null}
    </View>
  );
}

/**
 * Spotify's round green action pair — a solid play circle beside an outline
 * icon button (shuffle, follow…). Both stay quiet until touched.
 */
export function RoundPlay({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onClick}
      disabled={disabled}
      accessibilityLabel={label}
      className="size-12 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-pop transition-transform duration-150 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </Pressable>
  );
}

/** The quiet companion beside <RoundPlay> — shuffle, save, import. */
export function OutlineAction({
  onClick,
  disabled,
  active,
  label,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  /** Holds the brand colour while the action is engaged. */
  active?: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onClick}
      disabled={disabled}
      accessibilityLabel={label}
      className={cn(
        "size-12 items-center justify-center rounded-full border border-separator text-muted transition-colors active:text-foreground disabled:pointer-events-none disabled:opacity-40",
        active && "text-brand"
      )}
    >
      {children}
    </Pressable>
  );
}
