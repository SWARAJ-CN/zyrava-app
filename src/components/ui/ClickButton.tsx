import { useEffect, useState, type ReactNode } from "react";
import { AccessibilityInfo } from "react-native";
import { Button, type ButtonProps } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

/** True while the OS "reduce motion" accessibility setting is on. */
export function useReduceMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled: boolean) => {
      if (mounted) setReduced(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}

/**
 * A HeroUI button with a short press animation. Pagination and the auth forms
 * use it so a tap is acknowledged before the next screen paints; the scale is
 * tiny (0.94) and skipped entirely when motion is reduced. On native the scale
 * is the button's own press feedback (`PressableFeedback`), retuned to 0.94
 * with `ignoreScaleCoefficient` so it matches the web value on every width.
 */
export function ClickButton({
  square,
  className,
  ...props
}: ButtonProps & { square?: boolean }): ReactNode {
  const reduceMotion = useReduceMotion();

  return (
    <Button
      {...props}
      animation={{
        scale: {
          value: reduceMotion ? 1 : 0.94,
          timingConfig: { duration: reduceMotion ? 0 : 150 },
          ignoreScaleCoefficient: true,
        },
      }}
      className={cn(square && "rounded-none", className)}
    />
  );
}
