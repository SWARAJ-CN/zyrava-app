export interface CustomizationPayment {
  id: string;
  orderId: string;
  keyId: string;
  amount: number;
  currency: string;
  status: "pending" | "fulfilled";
  title: string;
  purpose?: "customization_self" | "customization_gift" | "donation";
  recipientId: string;
  createdAt: string;
}
export function formatPaymentAmount(amount: number, currency = "INR") {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount / 100);
}
/** An idempotency key, never a credential. No native crypto module is required. */
export function checkoutRequestId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const value = Math.floor(Math.random() * 16);
    return (c === "x" ? value : (value & 3) | 8).toString(16);
  });
}
export function checkoutHtml(payment: CustomizationPayment, callbackUrl: string) {
  const options = JSON.stringify({
    key: payment.keyId,
    order_id: payment.orderId,
    amount: payment.amount,
    currency: payment.currency,
    name: "ZYRAVA",
    description:
      payment.purpose === "donation"
        ? "Buy A Mug · Support Zyrava"
        : `Customization · ${payment.title}`,
    callback_url: callbackUrl,
    redirect: true,
    theme: { color: "#37c9a4" },
  }).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{background:#121218;color:#fafafa;font:16px system-ui;padding:24px}button{background:#37c9a4;border:0;border-radius:16px;padding:16px;font:inherit}</style></head><body><p id="status">Opening secure checkout…</p><button id="retry" hidden>Open checkout</button><script src="https://checkout.razorpay.com/v1/checkout.js" onerror="document.getElementById('status').textContent='Checkout could not load. Close and retry this pending payment.'"></script><script>if(window.Razorpay){const options=${options};options.modal={ondismiss:()=>{document.getElementById('status').textContent='Checkout closed. Your payment can be checked in ZYRAVA.';document.getElementById('retry').hidden=false;},confirm_close:true};const checkout=new Razorpay(options);document.getElementById('retry').onclick=()=>checkout.open();checkout.open();}</script></body></html>`;
}

export const SUPPORT_AMOUNTS = [10, 50, 100, 500, 1000] as const;
/** Parse decimal rupees exactly into integer paise. */
export function supportAmountPaise(value: string): number | null {
  const text = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(amount) && amount >= 100 && amount <= 1000000 ? amount : null;
}
