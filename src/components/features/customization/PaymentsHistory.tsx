import { useCallback, useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { apiFetch } from "@/lib/api";
import { formatPaymentAmount } from "@/lib/customization-payment";
import { durationLabel, type CustomizationPerson } from "@/lib/customization";
import { Button } from "@/components/ui/Button";
interface Payment {
  id: string;
  title: string;
  purpose: string;
  recipient: CustomizationPerson;
  amount: number;
  currency: string;
  amountRefunded: number;
  paymentStatus: string;
  fulfillmentStatus: string;
  orderId: string;
  paymentId: string | null;
  durationMinutes: number | null;
  createdAt: string;
}
interface History {
  items: Payment[];
  page: number;
  pages: number;
  total: number;
}
export function PaymentsHistory() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settled, setSettled] = useState("");
  const [revision, setRevision] = useState(0);
  const busy = settled !== `${page}:${revision}`;
  const refresh = useCallback(() => {
    setError(null);
    setRevision((value) => value + 1);
  }, []);
  useEffect(() => {
    let alive = true;
    void apiFetch<History>(`/api/customization/payments/history?page=${page}&limit=10`)
      .then((result) => {
        if (alive) setData(result);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setSettled(`${page}:${revision}`);
      });
    return () => {
      alive = false;
    };
  }, [page, revision]);
  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 210, gap: 16 }}>
      <Text className="text-2xl font-bold text-foreground">Payments</Text>
      <Text className="text-sm text-muted">Your customization purchases and payment status.</Text>
      <Button variant="secondary" loading={busy} onPress={refresh}>
        Refresh payments
      </Button>
      {error ? <Text className="text-sm text-danger">{error}</Text> : null}
      {data?.items.length === 0 ? (
        <Text className="text-sm text-muted">No payments yet.</Text>
      ) : null}
      {data?.items.map((item) => (
        <View key={item.id} className="gap-2 rounded-2xl bg-surface p-4">
          <View className="flex-row justify-between gap-4">
            <Text className="flex-1 text-base font-semibold text-foreground">{item.title}</Text>
            <Text className="font-bold text-accent">
              {formatPaymentAmount(item.amount, item.currency)}
            </Text>
          </View>
          <Text className="text-sm text-muted">
            {item.purpose === "customization_gift"
              ? `Customization for ${item.recipient?.name || "a listener"}`
              : "Customization for you"}
          </Text>
          <Text className="text-xs text-muted">
            {item.recipient?.email || item.recipient?.phone}
          </Text>
          <Text className="text-sm text-foreground">
            Payment: {item.paymentStatus.replace(/_/g, " ")} · Delivery: {item.fulfillmentStatus}
          </Text>
          {item.amountRefunded > 0 ? (
            <Text className="text-sm text-muted">
              Refunded: {formatPaymentAmount(item.amountRefunded, item.currency)}
            </Text>
          ) : null}
          <Text className="text-xs text-muted">
            {durationLabel(item.durationMinutes)} · {new Date(item.createdAt).toLocaleString()}
          </Text>
          <Text selectable className="text-xs text-muted">
            Order {item.orderId || "not created"}
            {item.paymentId ? `\nPayment ${item.paymentId}` : ""}
          </Text>
        </View>
      ))}
      <View className="flex-row items-center justify-between gap-3">
        <Button
          variant="secondary"
          disabled={busy || page <= 1}
          onPress={() => setPage((value) => value - 1)}
        >
          Previous
        </Button>
        <Text className="text-xs text-muted">
          {data?.page || page} / {Math.max(1, data?.pages || 1)}
        </Text>
        <Button
          variant="secondary"
          disabled={busy || !data || page >= data.pages}
          onPress={() => setPage((value) => value + 1)}
        >
          Next
        </Button>
      </View>
    </ScrollView>
  );
}
