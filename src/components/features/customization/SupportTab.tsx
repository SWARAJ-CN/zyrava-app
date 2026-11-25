import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Coffee, Heart, Check } from "lucide-react-native";
import { useThemeColor } from "heroui-native";
import { Button } from "@/components/ui/Button";
import {
  SUPPORT_AMOUNTS,
  supportAmountPaise,
  formatPaymentAmount,
} from "@/lib/customization-payment";
import { useCustomizationCheckout } from "./useCustomizationCheckout";
import { Checkout } from "./Checkout";

export function SupportTab({ onHistory }: { onHistory?: () => void }) {
  const payment = useCustomizationCheckout("donation");
  const [selected, setSelected] = useState<number | "custom">(50);
  const [custom, setCustom] = useState("");
  const accent = useThemeColor("accent");
  const amount = selected === "custom" ? supportAmountPaise(custom) : selected * 100;
  const busy = payment.busy || !!payment.checkout;
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 20, paddingBottom: 210, gap: 24 }}
    >
      <View className="items-start gap-5 rounded-3xl bg-surface p-6">
        <View className="size-20 items-center justify-center rounded-3xl bg-accent-soft">
          <Coffee size={42} color={accent} strokeWidth={1.5} />
        </View>
        <View className="gap-2">
          <Text className="text-xs font-semibold uppercase tracking-widest text-muted">
            A little support, a lot of music
          </Text>
          <Text className="text-3xl font-bold text-foreground">Buy A Mug</Text>
          <Text className="text-base leading-7 text-muted">
            I’m building Zyrava with care. Your support helps me cover server costs, fix the little
            things, and keep making your listening experience better.
          </Text>
        </View>
        <View className="flex-row items-center gap-2">
          <Heart size={16} color={accent} />
          <Text className="text-sm text-muted">A virtual mug. A one-time thank-you.</Text>
        </View>
      </View>
      <View className="gap-4">
        <Text className="text-lg font-semibold text-foreground">Choose your support</Text>
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel="Support amount"
          className="flex-row flex-wrap gap-3"
        >
          {[...SUPPORT_AMOUNTS, "custom" as const].map((value) => (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityLabel={value === "custom" ? "Custom amount" : `${value} rupees`}
              accessibilityState={{ checked: selected === value, disabled: busy }}
              disabled={busy}
              onPress={() => setSelected(value)}
              style={{ flexBasis: "30%", flexGrow: 1, minHeight: 72 }}
              className={`items-center justify-center gap-1 rounded-2xl px-3 py-4 active:opacity-70 ${selected === value ? "bg-accent-soft" : "bg-surface-secondary"}`}
            >
              <Text
                className={`text-lg font-semibold ${selected === value ? "text-accent-soft-foreground" : "text-foreground"}`}
              >
                {value === "custom" ? "Custom" : `₹${value.toLocaleString("en-IN")}`}
              </Text>
              {selected === value ? (
                <Check size={14} color={accent} />
              ) : (
                <View style={{ height: 14 }} />
              )}
            </Pressable>
          ))}
        </View>
        {selected === "custom" ? (
          <View className="gap-2">
            <Text className="text-sm font-medium text-foreground">Your amount in rupees</Text>
            <TextInput
              accessibilityLabel="Custom support amount in rupees"
              keyboardType="decimal-pad"
              editable={!busy}
              value={custom}
              onChangeText={setCustom}
              placeholder="e.g. 250"
              placeholderTextColor={accent}
              maxLength={9}
              className="min-h-14 rounded-2xl bg-surface-secondary px-4 text-xl text-foreground"
            />
            <Text className="text-xs text-muted">₹1–₹10,000. Up to two decimal places.</Text>
          </View>
        ) : null}
        <Button
          loading={payment.busy}
          disabled={busy || amount === null || !payment.pricing?.configured}
          onPress={() => amount !== null && void payment.donate(amount)}
        >
          {amount === null ? "Enter an amount" : `Buy A Mug · ${formatPaymentAmount(amount)}`}
        </Button>
        <Text className="text-center text-xs leading-5 text-muted">
          Supporting is always optional. Customization stays free for everyone.
        </Text>
        {!payment.pricing ? (
          <Text className="text-sm text-muted">Loading secure checkout…</Text>
        ) : !payment.pricing.configured ? (
          <Text className="text-sm text-muted">
            Support payments are unavailable right now. Thank you for being here.
          </Text>
        ) : null}
        {payment.message ? (
          <Text accessibilityLiveRegion="polite" className="text-sm leading-6 text-foreground">
            {payment.message}
          </Text>
        ) : null}
      </View>
      {payment.pending.map((p) => (
        <View key={p.id} className="gap-3 rounded-2xl bg-surface p-4">
          <Text className="font-semibold text-foreground">
            Pending support · {formatPaymentAmount(p.amount)}
          </Text>
          <Text className="text-sm text-muted">
            Already paid? Check this payment before starting another.
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onPress={() => void payment.check(p)}
            >
              Check payment
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onPress={() => void payment.resume(p)}
            >
              Resume checkout
            </Button>
          </View>
        </View>
      ))}
      <View className="gap-2">
        <Button
          variant="ghost"
          disabled={busy}
          onPress={() => void payment.reload().catch(() => undefined)}
        >
          Refresh payments
        </Button>
        {onHistory ? (
          <Button variant="ghost" onPress={onHistory}>
            View payment history
          </Button>
        ) : null}
      </View>
      {payment.checkout ? <Checkout payment={payment.checkout} onClose={payment.close} /> : null}
    </ScrollView>
  );
}
