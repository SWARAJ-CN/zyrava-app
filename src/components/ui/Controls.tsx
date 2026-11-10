import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { LayoutChangeEvent, Pressable, ScrollView, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { SearchField } from "heroui-native";
import { cn } from "@/lib/cn";
import { useI18n } from "@/components/providers/I18nProvider";
import { registerVoiceOps, type VoiceOp } from "@/lib/voice-ops";
import { searchTerm } from "@/lib/voice";
import { Icon } from "./icons";
import { ClickButton, useReduceMotion } from "./ClickButton";

/**
 * Native stand-in for the web's `VoiceOps` provider hook: identical mount /
 * re-register-on-label-change semantics, talking to the same module registry
 * (`registerVoiceOps`) the ported voice panel reads.
 */
function useRegisterVoiceOps(owner: string, ops: VoiceOp[]): void {
  const latest = useRef(ops);
  const ownerKey = useId();

  /* Keep the freshest set: the handlers close over this render's state, and
     the words the microphone hears follow the language of the interface. */
  useEffect(() => {
    latest.current = ops;
  });

  /* What the microphone hears. When it changes — a new action, or a different
     language — the operations are put up again. */
  const signature = ops.map((op) => `${op.id}|${op.label}|${op.phrases.join(",")}`).join("~");

  useEffect(() => {
    const release = registerVoiceOps(
      `${owner}@${ownerKey}`,
      latest.current.map((op) => ({
        id: op.id,
        label: op.label,
        phrases: op.phrases,
        feedback: op.feedback,
        /* Resolve through the ref, so the handler belongs to the render that
           is actually on screen rather than to the one that mounted. */
        run: (spoken: string) => latest.current.find((entry) => entry.id === op.id)?.run(spoken),
      }))
    );
    return release;
  }, [owner, ownerKey, signature]);
}

interface Option {
  value: string;
  /** Spoken/read label — also the tooltip when an icon is shown. */
  label: string;
  /** When set, the control shows this glyph instead of the label text. */
  icon?: ReactNode;
}

interface SegmentedControlProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  ariaLabel?: string;
}

/**
 * A strip of pressables with the selected pill sliding between positions —
 * the native answer to the web's `bg-surface` pill with `transition-all`:
 * option positions are measured once, then Reanimated interpolates them.
 */
export function SegmentedControl({
  options,
  value,
  onChange,
  className,
  ariaLabel,
}: SegmentedControlProps): ReactNode {
  const reduceMotion = useReduceMotion();
  const [frames, setFrames] = useState<Record<string, { x: number; width: number }>>({});
  const translateX = useSharedValue(0);
  const pillWidth = useSharedValue(0);
  const initialized = useRef(false);

  useEffect(() => {
    const frame = frames[value];
    if (!frame || frame.width === 0) return;
    if (!initialized.current || reduceMotion) {
      initialized.current = true;
      translateX.value = frame.x;
      pillWidth.value = frame.width;
    } else {
      translateX.value = withTiming(frame.x, { duration: 200 });
      pillWidth.value = withTiming(frame.width, { duration: 200 });
    }
  }, [value, frames, reduceMotion, translateX, pillWidth]);

  const pillStyle = useAnimatedStyle(() => ({
    width: pillWidth.value,
    transform: [{ translateX: translateX.value }],
  }));

  const remember = (key: string) => (event: LayoutChangeEvent) => {
    const { x, width } = event.nativeEvent.layout;
    setFrames((current) =>
      current[key]?.x === x && current[key]?.width === width
        ? current
        : { ...current, [key]: { x, width } }
    );
  };

  return (
    // `max-w-full` + horizontal scrolling keep the strip usable on narrow
    // phones instead of forcing the whole page wider than the screen.
    <ScrollView
      horizontal
      bounces={false}
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={ariaLabel}
      className={cn(
        "w-auto max-w-full shrink rounded-field bg-segment p-0.5 shadow-field",
        className
      )}
    >
      <View className="flex-row items-center gap-0.5">
        <Animated.View
          className="absolute top-0.5 left-0 bottom-0.5 rounded-[11px] bg-surface shadow-field"
          style={[pillStyle, { pointerEvents: "none" }]}
        />
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={option.icon ? option.label : undefined}
              onLayout={remember(option.value)}
              onPress={() => onChange(option.value)}
              className="flex-none items-center justify-center rounded-[11px] px-3 py-1.5"
            >
              {option.icon ? (
                <View className="h-5 w-6 items-center justify-center">{option.icon}</View>
              ) : (
                <Text
                  className={cn(
                    "text-xs font-semibold whitespace-nowrap",
                    selected ? "text-foreground" : "text-segment-foreground"
                  )}
                >
                  {option.label}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
}: SearchInputProps): ReactNode {
  const { t, locale } = useI18n();
  const instance = useId();
  const language = locale.split("-")[0];

  /* The box can be filled by voice: "search for Asha" types Asha into it. */
  useRegisterVoiceOps("search", [
    {
      id: `search-${instance}`,
      label: t("Search"),
      phrases: ["search", "find", "look for", "search for"],
      feedback: "",
      run: (spoken: string) => {
        const term = searchTerm(spoken, language);
        if (term) onChange(term);
      },
    },
  ]);

  return (
    <SearchField
      value={value}
      onChange={onChange}
      accessibilityLabel={t("Search")}
      className={cn("w-full", className)}
    >
      <SearchField.Group>
        <SearchField.SearchIcon />
        <SearchField.Input placeholder={placeholder ?? t("Search…")} />
        <SearchField.ClearButton accessibilityLabel={t("Clear search")} />
      </SearchField.Group>
    </SearchField>
  );
}

interface PaginationProps {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
  className?: string;
}

export function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  onChange,
  className,
}: PaginationProps): ReactNode {
  const { t } = useI18n();

  /* Turning the page is something the reader can ask for by voice wherever a
     list is shown, so it is put up for the microphone here rather than on
     every page that happens to have one. The id carries the instance, so two
     lists on one page never claim the same command. */
  const instance = useId();
  useRegisterVoiceOps(
    "pagination",
    pageCount > 1
      ? [
          {
            id: `next-page-${instance}`,
            label: t("Next page"),
            phrases: ["next page", "more results", "page forward"],
            feedback: t("Next page"),
            run: () => onChange(Math.min(pageCount, page + 1)),
          },
          {
            id: `previous-page-${instance}`,
            label: t("Previous page"),
            phrases: ["previous page", "back a page", "page back"],
            feedback: t("Previous page"),
            run: () => onChange(Math.max(1, page - 1)),
          },
        ]
      : []
  );

  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  const pages: number[] = [];
  const start = Math.max(1, Math.min(page - 1, pageCount - 2));
  for (let index = start; index <= Math.min(pageCount, start + 2); index += 1) {
    pages.push(index);
  }

  return (
    <View
      className={cn("flex-row flex-wrap items-center justify-between gap-3 px-1 py-3", className)}
    >
      <Text className="text-xs tabular-nums text-muted">
        {t("Showing {from}–{to} of {total}", { from, to, total })}
      </Text>
      <View className="flex-row items-center gap-1">
        <ClickButton
          variant="outline"
          size="icon"
          square
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          aria-label={t("Previous page")}
          className="size-9"
        >
          <Icon name="chevron-left" size={16} />
        </ClickButton>
        {pages.map((value) => (
          <ClickButton
            key={value}
            size="sm"
            square
            variant={value === page ? "primary" : "ghost"}
            onClick={() => onChange(value)}
            className="h-9 min-w-9 px-2"
            labelClassName={cn(
              "text-xs font-semibold tabular-nums",
              value !== page && "text-muted"
            )}
          >
            {String(value)}
          </ClickButton>
        ))}
        <ClickButton
          variant="outline"
          size="icon"
          square
          onClick={() => onChange(page + 1)}
          disabled={page >= pageCount}
          aria-label={t("Next page")}
          className="size-9"
        >
          <Icon name="chevron-right" size={16} />
        </ClickButton>
      </View>
    </View>
  );
}

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Shown before the title — e.g. the phone-only dock trigger. */
  leading?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  leading,
  actions,
  className,
}: PageHeaderProps): ReactNode {
  return (
    <View className={cn("flex-row flex-wrap items-end justify-between gap-4 pb-2", className)}>
      <View className="min-w-0 flex-1 flex-row items-center gap-3">
        {leading}
        <View className="min-w-0 flex-1">
          <Text className="text-2xl font-bold tracking-tight text-foreground">{title}</Text>
          {description ? (
            <Text className="mt-1.5 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
              {description}
            </Text>
          ) : null}
        </View>
      </View>
      {actions ? (
        <View className="w-full flex-row flex-wrap items-center gap-2">{actions}</View>
      ) : null}
    </View>
  );
}
