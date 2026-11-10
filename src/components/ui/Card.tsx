import { type ComponentProps, type ReactNode } from "react";
import { Text, View, type ViewProps } from "react-native";
import { Card as HeroCard } from "heroui-native";
import { cn } from "@/lib/cn";

type HeroCardProps = ComponentProps<typeof HeroCard>;

/** Web HTMLAttributes → the native view props the card forwards. */
export interface CardProps extends Omit<HeroCardProps, "children"> {
  children?: ReactNode;
}

export function Card({ className, children, ...props }: CardProps): ReactNode {
  return (
    <HeroCard className={cn("gap-0 p-0", className)} {...props}>
      {children ?? null}
    </HeroCard>
  );
}

interface CardHeaderProps extends Omit<ComponentProps<typeof HeroCard.Header>, "title"> {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

export function CardHeader({
  title,
  description,
  actions,
  className,
  children,
  ...props
}: CardHeaderProps): ReactNode {
  return (
    <HeroCard.Header
      className={cn(
        // `flex-wrap` lets the actions drop to their own line instead of
        // squeezing the title or pushing the card wider than the screen.
        "flex-row flex-wrap items-start justify-between gap-3 border-b border-separator px-5 py-4",
        className
      )}
      {...props}
    >
      {children ?? (
        <View className="min-w-0 flex-1">
          {title ? (
            typeof title === "string" ? (
              <HeroCard.Title className="text-sm font-semibold text-foreground">
                {title}
              </HeroCard.Title>
            ) : (
              title
            )
          ) : null}
          {description ? (
            typeof description === "string" ? (
              <HeroCard.Description className="mt-0.5 text-xs text-muted">
                {description}
              </HeroCard.Description>
            ) : (
              description
            )
          ) : null}
        </View>
      )}
      {actions ? <View className="flex-row flex-wrap items-center gap-2">{actions}</View> : null}
    </HeroCard.Header>
  );
}

/** Bare strings must render through `Text` on native, so short-circuit them here. */
function renderBody(children: ReactNode): ReactNode {
  return typeof children === "string" ? <Text>{children}</Text> : children;
}

export function CardContent({ className, children, ...props }: ViewProps): ReactNode {
  return (
    <View className={cn("p-5", className)} {...props}>
      {renderBody(children)}
    </View>
  );
}

export function CardFooter({ className, children, ...props }: ViewProps): ReactNode {
  return (
    <View
      className={cn(
        "flex-row flex-wrap items-center justify-between gap-3 border-t border-separator px-5 py-3.5",
        className
      )}
      {...props}
    >
      {renderBody(children)}
    </View>
  );
}
