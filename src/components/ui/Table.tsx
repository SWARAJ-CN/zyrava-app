import { cloneElement, isValidElement, type ReactNode } from "react";
import { ScrollView, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { cn } from "@/lib/cn";

/**
 * Semantic web table → flex-row primitives. Every export keeps its web name;
 * cells accept `className` (Uniwind) and render string children through
 * `Text` automatically.
 */

interface RowProps {
  children?: ReactNode;
  className?: string;
  style?: StyleProp<ViewStyle>;
}

export function TableWrapper({
  className,
  children,
  ...props
}: RowProps & { contentContainerClassName?: string }) {
  // `overflow-x-auto` maps to a horizontal ScrollView on native.
  return (
    <ScrollView
      horizontal
      bounces={false}
      showsHorizontalScrollIndicator={false}
      className={cn("w-full", className)}
      contentContainerClassName="min-w-full"
      {...props}
    >
      {children}
    </ScrollView>
  );
}

export function Table({ className, children, ...props }: RowProps) {
  // `text-sm`/`border-collapse` were CSS context for the cells; native cells
  // carry their own typography, so only the layout classes remain.
  return (
    <View className={cn("w-full min-w-full", className)} {...props}>
      {children}
    </View>
  );
}

export function THead({ className, children, ...props }: RowProps) {
  return (
    <View className={cn("bg-surface-secondary/70", className)} {...props}>
      {children}
    </View>
  );
}

export function TBody({ className, children, ...props }: RowProps) {
  // `divide-y divide-separator` is a CSS child trick; on native the border has
  // to live on every row but the last, so the rows are decorated here.
  const rows = Array.isArray(children) ? children : [children];
  return (
    <View className={className} {...props}>
      {rows.map((child, index) =>
        isValidElement(child) && index < rows.length - 1
          ? cloneElement(child as React.ReactElement<{ className?: string }>, {
              className: cn(
                "border-b border-separator",
                (child.props as { className?: string }).className
              ),
            })
          : child
      )}
    </View>
  );
}

export function TR({ className, children, ...props }: RowProps) {
  // The web row hover is a pointer affordance; native lists surface feedback
  // through the pressable that wraps a row when one is needed.
  return (
    <View className={cn("flex-row items-center", className)} {...props}>
      {children}
    </View>
  );
}

interface CellProps extends RowProps {
  children?: ReactNode;
  /** `scope`/`colSpan` are meaningless on native rows; kept for prop parity. */
  scope?: string;
  colSpan?: number;
}

export function TH({ className, children, scope, colSpan, ...props }: CellProps) {
  void scope;
  void colSpan;
  // Typography lives on the `Text`; node children bring their own.
  return typeof children === "string" ? (
    <Text
      className={cn(
        "flex-1 px-4 py-3 text-left text-xs font-semibold tracking-wide text-muted uppercase",
        className
      )}
      {...props}
    >
      {children}
    </Text>
  ) : (
    <View className={cn("flex-1 px-4 py-3", className)} {...props}>
      {children}
    </View>
  );
}

export function TD({ className, children, colSpan, ...props }: CellProps) {
  void colSpan;
  return typeof children === "string" || typeof children === "number" ? (
    <Text className={cn("flex-1 px-4 py-3 text-foreground", className)} {...props}>
      {children}
    </Text>
  ) : (
    <View className={cn("flex-1 px-4 py-3", className)} {...props}>
      {children}
    </View>
  );
}
