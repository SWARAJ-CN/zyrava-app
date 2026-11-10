import { type ReactNode } from "react";
import { Chip } from "heroui-native";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const TONES: Record<Tone, "default" | "accent" | "success" | "warning" | "danger"> = {
  neutral: "default",
  brand: "accent",
  success: "success",
  warning: "warning",
  danger: "danger",
  info: "accent",
};

interface BadgeProps {
  tone?: Tone;
  className?: string;
  children?: ReactNode;
}

export function Badge({ tone = "neutral", className, children }: BadgeProps): ReactNode {
  return (
    <Chip color={TONES[tone]} variant="soft" size="sm" className={cn("font-semibold", className)}>
      <Chip.Label>{children}</Chip.Label>
    </Chip>
  );
}
