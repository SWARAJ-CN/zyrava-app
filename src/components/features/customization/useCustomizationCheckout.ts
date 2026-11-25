import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import { checkoutRequestId, type CustomizationPayment } from "@/lib/customization-payment";
import type { CustomizationConfig } from "@/lib/customization";
import { useCustomization } from "@/components/providers/CustomizationProvider";
import { useAuth } from "@/components/providers/AuthProvider";
import { readJson, writeJson, removeItem } from "@/lib/store";
interface Pricing {
  amount: number;
  currency: string;
  configured: boolean;
}
export function useCustomizationCheckout(mode: "customization" | "donation" = "customization") {
  const { user } = useAuth();
  const { refresh } = useCustomization();
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [pending, setPending] = useState<CustomizationPayment[]>([]);
  const [checkout, setCheckout] = useState<CustomizationPayment | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const lock = useRef(false);
  const alive = useRef(true);
  const attemptKey = `zyrava:checkout-attempt:${user?.id}:${mode}`;
  const reload = useCallback(async () => {
    const [price, payments] = await Promise.all([
      apiFetch<Pricing>("/api/customization/payments/config"),
      apiFetch<{ payments: CustomizationPayment[] }>("/api/customization/payments"),
    ]);
    if (alive.current) {
      setPricing(price);
      setPending(
        payments.payments.filter((p) =>
          mode === "donation" ? p.purpose === "donation" : p.purpose !== "donation"
        )
      );
    }
  }, [mode]);
  useEffect(() => {
    alive.current = true;
    void reload().catch((e) => {
      if (alive.current) setMessage(e.message);
    });
    return () => {
      alive.current = false;
    };
  }, [reload]);
  const check = async (payment: CustomizationPayment) => {
    const result = await apiFetch<{ fulfilled: boolean }>("/api/customization/payments/check", {
      method: "POST",
      body: { purchaseId: payment.id },
    });
    if (result.fulfilled) {
      removeItem(attemptKey);
      if (payment.purpose !== "donation") await refresh();
      if (alive.current)
        setMessage(
          payment.purpose === "donation"
            ? "Thank you for the mug! Your support helps keep Zyrava growing."
            : "Payment confirmed. Your customization has been saved."
        );
    }
    return result.fulfilled;
  };
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (e) {
      if (alive.current)
        setMessage(
          e instanceof Error
            ? e.message
            : "Could not confirm payment. Check its status before paying again."
        );
    } finally {
      lock.current = false;
      if (alive.current) {
        setBusy(false);
        void reload().catch(() => undefined);
      }
    }
  };
  const open = async (payment: CustomizationPayment) => {
    if (await check(payment)) return;
    if (alive.current) setCheckout(payment);
  };
  const pay = (recipientId: string, config: CustomizationConfig) =>
    run(async () => {
      if (!pricing?.configured) throw new Error("Payments are not configured yet.");
      const fingerprint = JSON.stringify({ recipientId, config, amount: pricing.amount });
      let attempt = readJson<{ fingerprint: string; requestId: string } | null>(attemptKey, null);
      if (attempt?.fingerprint !== fingerprint) {
        attempt = { fingerprint, requestId: checkoutRequestId() };
        writeJson(attemptKey, attempt);
      }
      try {
        const payment = await apiFetch<CustomizationPayment>("/api/customization/payments/order", {
          method: "POST",
          body: {
            recipientId,
            config,
            expectedAmount: pricing.amount,
            requestId: attempt.requestId,
          },
        });
        await open(payment);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) removeItem(attemptKey);
        throw e;
      }
    });
  const donate = (amount: number) =>
    run(async () => {
      if (!pricing?.configured) throw new Error("Support payments are not available right now.");
      if (!Number.isSafeInteger(amount) || amount < 100 || amount > 1000000)
        throw new Error("Choose an amount between ₹1 and ₹10,000.");
      const fingerprint = JSON.stringify({ purpose: "donation", amount });
      let attempt = readJson<{ fingerprint: string; requestId: string } | null>(attemptKey, null);
      if (attempt?.fingerprint !== fingerprint) {
        attempt = { fingerprint, requestId: checkoutRequestId() };
        writeJson(attemptKey, attempt);
      }
      const payment = await apiFetch<CustomizationPayment>("/api/customization/donations/order", {
        method: "POST",
        body: { amount, requestId: attempt.requestId },
      });
      await open(payment);
    });
  return {
    pricing,
    pending,
    checkout,
    busy,
    message,
    pay,
    donate,
    reload,
    resume: (payment: CustomizationPayment) => run(() => open(payment)),
    check: (payment: CustomizationPayment) =>
      run(async () => {
        if (!(await check(payment)))
          setMessage("Payment is not confirmed yet. Check again before paying a second time.");
      }),
    close: () => {
      const payment = checkout;
      setCheckout(null);
      if (payment)
        void run(async () => {
          if (!(await check(payment)))
            setMessage(
              "Checkout closed. If you paid, use Check payment below while confirmation completes."
            );
        });
    },
  };
}
