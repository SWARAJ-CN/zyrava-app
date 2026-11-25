import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useThemeColor } from "heroui-native";

export function formatPlaybackTime(value: number): string {
  const seconds = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** A full-height touch target: preview while dragging and seek once on release. */
export function PlaybackSeekBar({
  progress,
  duration,
  seek,
}: {
  progress: number;
  duration: number;
  seek: (seconds: number) => void;
}) {
  const accent = useThemeColor("accent");
  const trackColor = useThemeColor("surface-secondary");
  const width = useRef(0);
  const gesture = useRef<{ startX: number; pageX: number; value: number } | null>(null);
  const [draft, setDraft] = useState<number | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const limit = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const clamp = (value: number) => Math.max(0, Math.min(limit, Number.isFinite(value) ? value : 0));
  const position = clamp(draft ?? pending ?? progress);
  const valueAt = (x: number) => clamp((x / Math.max(1, width.current)) * limit);
  const commit = (value: number) => {
    if (limit <= 0) return;
    const target = clamp(value);
    setPending(target);
    setDraft(null);
    seek(target);
  };

  // The decoder may send an old clock tick before it confirms the seek. Keep
  // the tapped position visible instead of bouncing back and inviting a retry.
  if (pending !== null && Math.abs(progress - pending) < 1.5) {
    setPending(null);
  }
  useEffect(() => {
    if (pending === null) return;
    const timeout = setTimeout(() => setPending(null), 2000);
    return () => clearTimeout(timeout);
  }, [pending]);

  return (
    <View className="w-full flex-row items-center gap-2" style={{ minHeight: 44 }}>
      <Text className="w-10 text-right text-[11px] tabular-nums text-muted-foreground">
        {formatPlaybackTime(position)}
      </Text>
      <View
        accessibilityRole="adjustable"
        accessibilityLabel="Seek"
        accessibilityState={{ disabled: limit <= 0 }}
        accessibilityValue={{
          min: 0,
          max: limit,
          now: position,
          text: formatPlaybackTime(position),
        }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={({ nativeEvent }) => {
          if (nativeEvent.actionName === "increment") commit(position + 10);
          if (nativeEvent.actionName === "decrement") commit(position - 10);
        }}
        onLayout={({ nativeEvent }) => {
          width.current = nativeEvent.layout.width;
        }}
        onStartShouldSetResponder={() => limit > 0 && width.current > 0}
        onResponderTerminationRequest={() => false}
        onResponderGrant={({ nativeEvent }) => {
          const value = valueAt(nativeEvent.locationX);
          gesture.current = { startX: nativeEvent.locationX, pageX: nativeEvent.pageX, value };
          setPending(null);
          setDraft(value);
        }}
        onResponderMove={({ nativeEvent }) => {
          const active = gesture.current;
          if (!active) return;
          active.value = valueAt(active.startX + nativeEvent.pageX - active.pageX);
          setDraft(active.value);
        }}
        onResponderRelease={({ nativeEvent }) => {
          const active = gesture.current;
          if (!active) return;
          gesture.current = null;
          commit(valueAt(active.startX + nativeEvent.pageX - active.pageX));
        }}
        onResponderTerminate={() => {
          gesture.current = null;
          setDraft(null);
        }}
        className="min-w-0 flex-1"
        style={{ height: 44, justifyContent: "center" }}
      >
        <View
          pointerEvents="none"
          style={{ height: 6, borderRadius: 3, backgroundColor: trackColor }}
        >
          <View
            style={{
              width: `${limit > 0 ? (position / limit) * 100 : 0}%`,
              height: 6,
              borderRadius: 3,
              backgroundColor: accent,
            }}
          />
          <View
            style={{
              position: "absolute",
              left: `${limit > 0 ? (position / limit) * 100 : 0}%`,
              top: -5,
              marginLeft: -8,
              width: 16,
              height: 16,
              borderRadius: 8,
              backgroundColor: accent,
            }}
          />
        </View>
      </View>
      <Text className="w-10 text-[11px] tabular-nums text-muted-foreground">
        {formatPlaybackTime(limit)}
      </Text>
    </View>
  );
}
