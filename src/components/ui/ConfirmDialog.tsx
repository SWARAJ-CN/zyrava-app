import { type ReactNode } from "react";
import { Text, View } from "react-native";
import { TriangleAlert } from "lucide-react-native";
import { useThemeColor } from "heroui-native";
import { useI18n } from "@/components/providers/I18nProvider";
import { Button } from "./Button";
import { Modal } from "./Modal";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): ReactNode {
  const { t } = useI18n();
  // The web circle tints itself with `text-danger`/`text-warning` around a
  // `bg-danger-soft`/`bg-warning-soft` disc; on native the icon colour must be
  // an explicit value, so resolve the same tokens.
  const iconColor = useThemeColor(destructive ? "danger" : "warning");

  return (
    <Modal
      open={open}
      onClose={onCancel}
      size="sm"
      title={
        <>
          <View
            className={
              destructive
                ? "size-7 items-center justify-center rounded-full bg-danger-soft"
                : "size-7 items-center justify-center rounded-full bg-warning-soft"
            }
          >
            <TriangleAlert size={16} color={iconColor} />
          </View>
          <Text className="flex-1 text-base font-semibold text-foreground">{title}</Text>
        </>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            {cancelLabel ?? t("Cancel")}
          </Button>
          <Button
            variant={destructive ? "danger" : "primary"}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel ?? t("Confirm")}
          </Button>
        </>
      }
    >
      <Text className="text-sm leading-relaxed text-muted-foreground">{description}</Text>
    </Modal>
  );
}
