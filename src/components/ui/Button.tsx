import {
  forwardRef,
  useEffect,
  type ComponentProps,
  type ComponentRef,
  type ReactNode,
} from "react";
import { Link, type LinkProps } from "expo-router";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { Loader2 } from "lucide-react-native";
import {
  Button as HeroButton,
  buttonClassNames,
  useThemeColor,
  type ButtonSize as HeroButtonSize,
  type ThemeColor,
} from "heroui-native";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

const HERO_VARIANT: Record<
  ButtonVariant,
  "primary" | "secondary" | "outline" | "ghost" | "danger"
> = {
  primary: "primary",
  secondary: "secondary",
  outline: "outline",
  ghost: "ghost",
  danger: "danger",
};

const HERO_SIZE: Record<ButtonSize, HeroButtonSize> = {
  sm: "sm",
  md: "md",
  lg: "lg",
  icon: "md",
};

/** The label-colour token each variant paints its contents with (icon spinners). */
const LABEL_TOKEN: Record<ButtonVariant, ThemeColor> = {
  primary: "accent-foreground",
  secondary: "accent-soft-foreground",
  outline: "default-foreground",
  ghost: "default-foreground",
  danger: "danger-foreground",
};

/** Shared classes so links and buttons look identical. */
export function buttonClasses(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string
) {
  return cn(
    buttonClassNames.root({
      variant: HERO_VARIANT[variant],
      size: HERO_SIZE[size],
      isIconOnly: size === "icon",
    }),
    className
  );
}

type HeroButtonProps = ComponentProps<typeof HeroButton>;

/**
 * The web's `ButtonProps` extended the DOM button attributes; on native the
 * surface is the default (press-feedback) branch of HeroUI's discriminated
 * `ButtonRootProps` union, so the rest-props spread stays branch-safe.
 */
type HeroButtonBranch = Extract<HeroButtonProps, { feedbackVariant?: "scale-highlight" }>;

/** Continuous rotation standing in for the web's `animate-spin` Loader2. */
function LoadingGlyph({ color }: { color: string }) {
  const rotation = useSharedValue(0);

  useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: 900, easing: Easing.linear }),
      -1,
      false
    );
    return () => {
      cancelAnimation(rotation);
    };
  }, [rotation]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Loader2 size={16} color={color} strokeWidth={2.5} />
    </Animated.View>
  );
}

export interface ButtonProps extends Omit<
  HeroButtonBranch,
  "variant" | "size" | "isIconOnly" | "isDisabled" | "children"
> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  /** Extra classes for the auto-generated `Button.Label` of string children. */
  labelClassName?: string;
  /** Web compatibility: same callback, fired without a DOM event. */
  onClick?: (event?: unknown) => void;
  children?: ReactNode;
  /** Accepted for web parity; native has no hover tooltips, so it is dropped. */
  title?: string;
  /** Accepted for web parity (`type="submit"` etc.); meaningless on a native button. */
  type?: "button" | "submit" | "reset";
  "aria-label"?: string;
  id?: string;
}

export const Button = forwardRef<ComponentRef<typeof HeroButton>, ButtonProps>(function Button(
  {
    className,
    labelClassName,
    variant = "primary",
    size = "md",
    loading = false,
    disabled,
    children,
    onClick,
    title,
    type,
    id,
    "aria-label": ariaLabel,
    onPress,
    ...props
  },
  ref
) {
  void title;
  void type;
  const labelColor = useThemeColor(LABEL_TOKEN[variant]);

  return (
    <HeroButton
      ref={ref}
      variant={HERO_VARIANT[variant]}
      size={HERO_SIZE[size]}
      isIconOnly={size === "icon"}
      isDisabled={disabled || loading}
      onPress={onPress ?? (onClick ? () => onClick() : undefined)}
      className={className}
      nativeID={id}
      accessibilityLabel={ariaLabel ?? props.accessibilityLabel}
      {...props}
    >
      {loading ? <LoadingGlyph color={labelColor} /> : null}
      {typeof children === "string" ? (
        <HeroButton.Label className={labelClassName}>{children}</HeroButton.Label>
      ) : (
        children
      )}
    </HeroButton>
  );
});

export interface ButtonLinkProps extends Omit<LinkProps, "className"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}: ButtonLinkProps): ReactNode {
  return (
    <Link {...props} asChild>
      <HeroButton
        variant={HERO_VARIANT[variant]}
        size={HERO_SIZE[size]}
        isIconOnly={size === "icon"}
        className={className}
      >
        {typeof children === "string" ? <HeroButton.Label>{children}</HeroButton.Label> : children}
      </HeroButton>
    </Link>
  );
}
