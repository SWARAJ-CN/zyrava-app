import { useMemo, type ReactNode } from "react";
import { Button, type ButtonProps } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

import { useReduceMotion } from "@/hooks/useReduceMotion";
export { useReduceMotion } from "@/hooks/useReduceMotion";

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
  const animation = useMemo(
    () => ({
      scale: {
        value: reduceMotion ? 1 : 0.94,
        timingConfig: { duration: reduceMotion ? 0 : 150 },
        ignoreScaleCoefficient: true,
      },
    }),
    [reduceMotion]
  );

  return (
    <Button {...props} animation={animation} className={cn(square && "rounded-none", className)} />
  );
}
