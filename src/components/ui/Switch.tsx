import { type ComponentProps, type ReactNode } from "react";
import { Switch as HeroSwitch } from "heroui-native";

interface SwitchProps extends Omit<ComponentProps<typeof HeroSwitch>, "children"> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/**
 * A plain on/off switch on HeroUI Native's `Switch`. The web version's
 * `checked`/`onChange(boolean)` API is kept exactly; it maps to the native
 * `isSelected`/`onSelectedChange` pair (the native thumb/animation is built in).
 */
export function Switch({
  checked,
  onChange,
  disabled,
  className,
  ...props
}: SwitchProps): ReactNode {
  return (
    <HeroSwitch
      isSelected={checked}
      onSelectedChange={onChange}
      isDisabled={disabled}
      className={className}
      {...props}
    />
  );
}
