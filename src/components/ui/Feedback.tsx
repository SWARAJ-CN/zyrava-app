import { cloneElement, isValidElement, type ComponentProps, type ReactNode } from "react";
import { Text, View } from "react-native";
import {
  Alert,
  Skeleton as HeroSkeleton,
  Spinner as HeroSpinner,
  useThemeColor,
} from "heroui-native";
import { cn } from "@/lib/cn";
import { useI18n } from "@/components/providers/I18nProvider";
import { Icon, useClassColor, sizeFromClassName, type IconName } from "./icons";

/** Tailwind `size-N` → HeroUI's three spinner steps. */
function spinnerSize(className?: string): "sm" | "md" | "lg" {
  const px = sizeFromClassName(className);
  if (px === undefined) return "md"; // the web default (size-5 ≈ md on native)
  if (px <= 16) return "sm";
  if (px >= 32) return "lg";
  return "md";
}

export function Skeleton({ className, ...props }: ComponentProps<typeof HeroSkeleton>): ReactNode {
  return <HeroSkeleton className={cn("rounded-md", className)} {...props} />;
}

export function Spinner({ className }: { className?: string }): ReactNode {
  // `color="current"` is a DOM concept; on native the colour is resolved from
  // the same `text-*` class the web spinner inherited its stroke from.
  const color = useClassColor(className, undefined, "--color-foreground");
  return <HeroSpinner size={spinnerSize(className)} color={color} className={className} />;
}

export function CenteredSpinner({ label }: { label?: string }): ReactNode {
  const { t } = useI18n();

  return (
    <View className="flex-col items-center justify-center gap-3 py-16">
      <Spinner className="size-6 text-accent" />
      <Text className="text-center text-sm text-muted">{label ?? t("Loading…")}</Text>
    </View>
  );
}

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps): ReactNode {
  const muted = useThemeColor("muted");
  // The web tile paints `text-muted` and the icon inherits it; on native the
  // SVG needs the resolved colour, so bare <Icon>s get it injected.
  const tintedIcon =
    isValidElement(icon) &&
    (icon as React.ReactElement).type === Icon &&
    !(icon as React.ReactElement<{ color?: string }>).props.color
      ? cloneElement(icon as React.ReactElement<{ color?: string }>, { color: muted })
      : icon;

  return (
    <View className={cn("flex-col items-center justify-center gap-3 px-6 py-14", className)}>
      {icon ? (
        <View className="size-12 items-center justify-center rounded-lg bg-surface-secondary">
          {tintedIcon}
        </View>
      ) : null}
      <View className="max-w-sm">
        <Text className="text-center text-sm font-semibold text-foreground">{title}</Text>
        {description ? (
          <Text className="mt-1 text-center text-xs leading-relaxed text-muted">{description}</Text>
        ) : null}
      </View>
      {action ? <View className="mt-1">{action}</View> : null}
    </View>
  );
}

type NoticeTone = "info" | "success" | "warning" | "danger";

const NOTICE_STATUS: Record<NoticeTone, "accent" | "success" | "warning" | "danger"> = {
  info: "accent",
  success: "success",
  warning: "warning",
  danger: "danger",
};

const NOTICE_ICONS: Record<NoticeTone, IconName> = {
  info: "info",
  success: "check-circle",
  warning: "alert-triangle",
  danger: "x-circle",
};

const NOTICE_ICON_TOKEN: Record<NoticeTone, "accent" | "success" | "warning" | "danger"> = {
  info: "accent",
  success: "success",
  warning: "warning",
  danger: "danger",
};

interface NoticeProps {
  tone?: NoticeTone;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function Notice({
  tone = "info",
  title,
  children,
  action,
  className,
}: NoticeProps): ReactNode {
  const iconColor = useThemeColor(NOTICE_ICON_TOKEN[tone]);
  const icon = NOTICE_ICONS[tone];
  return (
    <Alert status={NOTICE_STATUS[tone]} className={cn("items-start", className)}>
      <Alert.Indicator>
        <Icon name={icon} size={16} color={iconColor} />
      </Alert.Indicator>
      <Alert.Content>
        {typeof title === "string" ? <Alert.Title>{title}</Alert.Title> : <View>{title}</View>}
        {children ? (
          typeof children === "string" ? (
            <Alert.Description className="text-sm leading-relaxed text-muted">
              {children}
            </Alert.Description>
          ) : (
            <View className="gap-1">{children}</View>
          )
        ) : null}
      </Alert.Content>
      {action ? <View className="flex-none">{action}</View> : null}
    </Alert>
  );
}
