import { type ReactNode } from "react";
import { Dimensions, ScrollView, View } from "react-native";
import { Dialog } from "heroui-native";

type Size = "sm" | "md" | "lg" | "xl";

/**
 * Web sizes are `max-w-[26rem]` etc.; on native the same widths map to pixels
 * (rem = 16px) and are applied as `maxWidth` styles on the dialog card.
 */
const WIDTHS: Record<Size, number> = {
  sm: 26 * 16,
  md: 34 * 16,
  lg: 46 * 16,
  xl: 64 * 16,
};

/** Long bodies scroll inside the card, mirroring the web's `scroll="inside"`. */
const MAX_BODY_HEIGHT = Math.round(Dimensions.get("window").height * 0.6);

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  size?: Size;
  children: ReactNode;
}

/**
 * The web centred HeroUI Modal maps to HeroUI Native's `Dialog`: a dismissible
 * backdrop (`Overlay isCloseOnPress`, the default) with a centred card in a
 * portal. The DOM scroll-lock sweep in the web version is meaningless on
 * native — overlays never lock `<html>` — so it is not ported.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  footer,
  size = "md",
  children,
}: ModalProps): ReactNode {
  return (
    <Dialog
      isOpen={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <Dialog.Portal>
        {/* Dismissible backdrop = true. */}
        <Dialog.Overlay isCloseOnPress />
        <Dialog.Content className="w-full gap-3 self-center" style={{ maxWidth: WIDTHS[size] }}>
          {/*
            `Dialog.Title` is a Text element, so a node title (icon + label)
            renders as a View row instead; string titles keep the heading role.
          */}
          <View className="flex-row items-start justify-between gap-3">
            <View className="min-w-0 flex-1 gap-0.5">
              {typeof title === "string" ? (
                <Dialog.Title className="text-base font-semibold text-foreground">
                  {title}
                </Dialog.Title>
              ) : (
                <View className="flex-row items-center gap-2">{title}</View>
              )}
              {description ? (
                typeof description === "string" ? (
                  <Dialog.Description className="text-xs text-muted">
                    {description}
                  </Dialog.Description>
                ) : (
                  <View>{description}</View>
                )
              ) : null}
            </View>
            <Dialog.Close />
          </View>

          <ScrollView bounces={false} style={{ maxHeight: MAX_BODY_HEIGHT }}>
            <View className="gap-3">{children}</View>
          </ScrollView>

          {footer ? (
            <View className="mt-3 flex-row flex-wrap items-center justify-end gap-2">{footer}</View>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
