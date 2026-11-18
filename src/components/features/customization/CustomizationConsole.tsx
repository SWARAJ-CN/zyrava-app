import { useCallback, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Animation } from "@/components/ui/Animation";
import { useAuth } from "@/components/providers/AuthProvider";
import { useCustomization } from "@/components/providers/CustomizationProvider";
import { apiFetch } from "@/lib/api";
import {
  BIRTHDAY_CUSTOMIZATION,
  CUSTOM_ANIMATIONS,
  CUSTOM_ANIMATION_SETS,
  DEFAULT_CUSTOMIZATION,
  contrast,
  durationLabel,
  isCustomizationConfig,
  type AnimationId,
  type CustomizationConfig,
  type CustomizationPerson,
} from "@/lib/customization";
import { formatPaymentAmount } from "@/lib/customization-payment";
import { ColorPalettePicker } from "./ColorPalettePicker";
import { Checkout } from "./Checkout";
import { useCustomizationCheckout } from "./useCustomizationCheckout";

function Field({
  label,
  value,
  onChange,
  maxLength = 140,
  numeric = false,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  maxLength?: number;
  numeric?: boolean;
}) {
  return (
    <View className="gap-2">
      <Text className="text-sm font-semibold text-foreground">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        maxLength={maxLength}
        keyboardType={numeric ? "number-pad" : "default"}
        autoCapitalize="none"
        className="min-h-12 rounded-xl bg-surface-secondary px-4 py-3 text-foreground"
      />
    </View>
  );
}
type Slot = "loadingAnimation" | "headerAnimation" | "lyricsAnimation";
const SLOTS: { key: Slot; label: string }[] = [
  { key: "loadingAnimation", label: "Loading screen" },
  { key: "headerAnimation", label: "Home header" },
  { key: "lyricsAnimation", label: "Lyrics background" },
];

export function CustomizationConsole({ active = true }: { active?: boolean }) {
  const { user } = useAuth();
  const customization = useCustomization();
  const payment = useCustomizationCheckout();
  const [template, setTemplate] = useState<"partner" | "birthday">("partner");
  const [drafts, setDrafts] = useState({
    partner: { ...DEFAULT_CUSTOMIZATION },
    birthday: { ...BIRTHDAY_CUSTOMIZATION },
  });
  const draft = drafts[template];
  const edit = useCallback(
    (patch: Partial<CustomizationConfig>) =>
      setDrafts((previous) => ({ ...previous, [template]: { ...previous[template], ...patch } })),
    [template]
  );
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomizationPerson[]>([]);
  const [recipient, setRecipient] = useState<CustomizationPerson | null>(null);
  const [searching, setSearching] = useState(false);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const searchVersion = useRef(0);
  const run = async (action: () => Promise<unknown>) => {
    if (mutating) return;
    setMutating(true);
    setNotice(null);
    try {
      await action();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setMutating(false);
    }
  };
  const search = async () => {
    const version = ++searchVersion.current;
    setSearching(true);
    setNotice(null);
    try {
      const response = await apiFetch<{ users: CustomizationPerson[] }>(
        `/api/customization/users?q=${encodeURIComponent(query.trim())}`
      );
      if (version === searchVersion.current) {
        setResults(response.users);
        if (!response.users.length) setNotice("No matching users.");
      }
    } catch (e) {
      if (version === searchVersion.current)
        setNotice(e instanceof Error ? e.message : "Search failed.");
    } finally {
      if (version === searchVersion.current) setSearching(false);
    }
  };
  if (!user || customization.personal) return null;
  const valid = isCustomizationConfig(draft);
  const readable =
    valid &&
    contrast(draft.text, draft.background) >= 4.5 &&
    contrast(draft.text, draft.surface) >= 4.5;
  const preview = valid ? draft : DEFAULT_CUSTOMIZATION;
  const busy = payment.busy || !!payment.checkout;
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 20, paddingBottom: 210, gap: 22 }}
    >
      <View>
        <Text className="text-2xl font-bold text-foreground">Customize</Text>
        <Text className="mt-2 text-sm text-muted">
          Make a listening room for yourself or someone you love.
        </Text>
      </View>
      <View accessibilityRole="tablist" className="flex-row gap-2">
        {(["partner", "birthday"] as const).map((value) => (
          <Button
            key={value}
            variant={template === value ? "primary" : "secondary"}
            accessibilityRole="tab"
            accessibilityState={{ selected: template === value }}
            onPress={() => setTemplate(value)}
          >
            {value === "partner" ? "For partner" : "Birthday"}
          </Button>
        ))}
      </View>
      <View className="gap-3">
        <Text className="text-base font-semibold text-foreground">Who is it for?</Text>
        <Button
          variant="secondary"
          onPress={() => {
            setRecipient(null);
            setResults([]);
          }}
        >
          For me · {user.name || "My account"}
        </Button>
        <Field
          label="Search by name, email or phone"
          value={query}
          onChange={(value) => {
            searchVersion.current++;
            setQuery(value);
            setResults([]);
            setSearching(false);
          }}
        />
        <Button
          variant="secondary"
          loading={searching}
          disabled={query.trim().length < 3}
          onPress={() => void search()}
        >
          Search users
        </Button>
        {results.map((person) => (
          <Pressable
            key={person.id}
            onPress={() => {
              setRecipient(person);
              setResults([]);
            }}
            accessibilityRole="button"
            className="gap-1 rounded-xl bg-surface-secondary p-4"
          >
            <Text className="font-semibold text-foreground">
              {person.name || "ZYRAVA listener"}
            </Text>
            <Text className="text-xs text-muted">
              {[person.email, person.phone].filter(Boolean).join(" · ")}
            </Text>
          </Pressable>
        ))}
        <Text className="text-sm text-accent">
          Selected: {recipient?.name || user.name || "Me"}
          {recipient ? ` · ${recipient.email || recipient.phone || ""}` : ""}
        </Text>
      </View>
      <Field
        label="Room title"
        value={draft.title}
        maxLength={60}
        onChange={(title) => edit({ title })}
      />
      {template === "birthday" ? (
        <Field
          label="Birthday wish"
          value={draft.wishMessage ?? ""}
          maxLength={280}
          onChange={(wishMessage) => edit({ wishMessage })}
        />
      ) : null}
      <ColorPalettePicker accent={draft.accent} onSelect={edit} />
      <View className="flex-row flex-wrap gap-3">
        {(["accent", "background", "surface", "text"] as const).map((key) => (
          <View key={key} style={{ width: "47%" }}>
            <Field
              label={`${key[0].toUpperCase()}${key.slice(1)} colour`}
              value={draft[key]}
              maxLength={7}
              onChange={(value) => edit({ [key]: value })}
            />
          </View>
        ))}
      </View>
      <View className="gap-3">
        <Text className="text-base font-semibold text-foreground">Animation sets</Text>
        <View className="flex-row flex-wrap gap-2">
          {CUSTOM_ANIMATION_SETS.map((set) => (
            <Button
              key={set.id}
              size="sm"
              variant="secondary"
              onPress={() =>
                edit({
                  loadingAnimation: set.loadingAnimation,
                  headerAnimation: set.headerAnimation,
                  lyricsAnimation: set.lyricsAnimation,
                })
              }
            >
              {set.label}
            </Button>
          ))}
        </View>
      </View>
      {SLOTS.map((item) => (
        <View key={item.key} className="rounded-2xl bg-surface p-4">
          <Text className="text-base font-semibold text-foreground">{item.label}</Text>
          {active && previewId === item.key ? <Animation id={draft[item.key]} /> : null}
          {draft[item.key] !== "none" ? (
            <Button
              variant="ghost"
              size="sm"
              onPress={() => setPreviewId((previous) => (previous === item.key ? null : item.key))}
            >
              {previewId === item.key ? "Close preview" : "Preview animation"}
            </Button>
          ) : null}
          <Button variant="secondary" onPress={() => setSlot(item.key)}>
            {CUSTOM_ANIMATIONS.find((animation) => animation.id === draft[item.key])?.label ||
              "No animation"}{" "}
            · Change
          </Button>
        </View>
      ))}
      <Field
        label="Loading screen message"
        value={draft.loadingMessage}
        onChange={(loadingMessage) => edit({ loadingMessage })}
      />
      <View className="gap-3">
        <Text className="text-base font-semibold text-foreground">How long should it stay?</Text>
        <View className="flex-row flex-wrap gap-2">
          {[
            { label: "Until removed", minutes: null },
            { label: "1 hour", minutes: 60 },
            { label: "1 day", minutes: 1440 },
            { label: "7 days", minutes: 10080 },
            { label: "30 days", minutes: 43200 },
          ].map((option) => (
            <Button
              key={option.label}
              variant={draft.durationMinutes === option.minutes ? "primary" : "secondary"}
              size="sm"
              onPress={() => edit({ durationMinutes: option.minutes })}
            >
              {option.label}
            </Button>
          ))}
        </View>
        <Field
          label="Custom duration in minutes (blank = until removed)"
          numeric
          value={draft.durationMinutes == null ? "" : String(draft.durationMinutes)}
          maxLength={6}
          onChange={(value) => edit({ durationMinutes: value === "" ? null : Number(value) })}
        />
        <Text className="text-xs text-muted">
          Duration starts when the recipient accepts. Maximum 365 days.
        </Text>
      </View>
      <View style={{ backgroundColor: preview.background, borderRadius: 22, padding: 20 }}>
        <Text style={{ color: preview.text, fontSize: 22, fontWeight: "700" }}>
          {preview.title}
        </Text>
        <Text style={{ color: preview.accent, marginTop: 10 }}>
          {preview.wishMessage || preview.loadingMessage}
        </Text>
        <Text style={{ color: preview.text, marginTop: 16, fontSize: 12 }}>
          {durationLabel(preview.durationMinutes)}
        </Text>
      </View>
      {!valid || !readable ? (
        <Text className="text-sm text-danger">
          Use six-digit hex colours and a valid duration. Text needs sufficient contrast against
          both backgrounds.
        </Text>
      ) : null}
      <Button
        loading={payment.busy}
        disabled={busy || !valid || !readable || !payment.pricing?.configured}
        onPress={() => void payment.pay(recipient?.id || user.id, draft)}
      >
        {payment.pricing
          ? `Pay ${formatPaymentAmount(payment.pricing.amount, payment.pricing.currency)} and ${recipient && recipient.id !== user.id ? "send" : "apply"}`
          : "Loading price…"}
      </Button>
      {!payment.pricing?.configured ? (
        <Text className="text-sm text-muted">
          Payment availability and price are controlled by the administrator.
        </Text>
      ) : null}
      {payment.message || notice || customization.error ? (
        <Text accessibilityLiveRegion="polite" className="text-sm text-foreground">
          {payment.message || notice || customization.error}
        </Text>
      ) : null}
      <Button
        variant="ghost"
        onPress={() =>
          void run(async () => {
            await customization.refresh();
            await payment.reload();
          })
        }
        loading={mutating}
      >
        Refresh
      </Button>
      {payment.pending
        .filter((p) => p.status !== "fulfilled")
        .map((p) => (
          <View key={p.id} className="gap-3 rounded-2xl bg-surface p-4">
            <Text className="font-semibold text-foreground">
              {p.title} · {formatPaymentAmount(p.amount, p.currency)}
            </Text>
            <Text className="text-xs text-muted">
              An existing checkout is waiting. Check it before starting another payment.
            </Text>
            <View className="flex-row gap-2">
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
      <View className="gap-3">
        <Text className="text-lg font-semibold text-foreground">Received for you</Text>
        {customization.state.incoming.length + customization.state.received.length === 0 ? (
          <Text className="text-sm text-muted">Your gifts will appear here.</Text>
        ) : null}
        {[...customization.state.incoming, ...customization.state.received]
          .filter((item, index, all) => all.findIndex((x) => x.id === item.id) === index)
          .map((item) => (
            <View key={item.id} className="gap-3 rounded-2xl bg-surface p-4">
              <Text className="font-semibold text-foreground">{item.config.title}</Text>
              <Text className="text-sm text-muted">
                By {item.creator.name || "ZYRAVA listener"} ·{" "}
                {item.creator.email || item.creator.phone}
              </Text>
              {active && previewId === `received:${item.id}` ? (
                <Animation id={item.config.headerAnimation} />
              ) : null}
              {item.config.headerAnimation !== "none" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={() =>
                    setPreviewId((previous) =>
                      previous === `received:${item.id}` ? null : `received:${item.id}`
                    )
                  }
                >
                  {previewId === `received:${item.id}` ? "Close preview" : "Preview animation"}
                </Button>
              ) : null}
              <Text className="text-xs text-muted">
                {durationLabel(item.config.durationMinutes)}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {item.status === "pending" ? (
                  <>
                    <Button
                      size="sm"
                      disabled={mutating}
                      onPress={() =>
                        void run(() => customization.respond(item.id, true, item.updatedAt))
                      }
                    >
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={mutating}
                      onPress={() =>
                        void run(() => customization.respond(item.id, false, item.updatedAt))
                      }
                    >
                      Decline
                    </Button>
                  </>
                ) : (
                  <Text className="text-xs text-muted">{item.status}</Text>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={mutating}
                  onPress={() => void run(() => customization.remove(item.id))}
                >
                  Remove
                </Button>
              </View>
            </View>
          ))}
        {customization.state.active ? (
          <Button
            variant="secondary"
            disabled={mutating}
            onPress={() => void run(() => customization.reset())}
          >
            Restore normal ZYRAVA theme
          </Button>
        ) : null}
      </View>
      <View className="gap-3">
        <Text className="text-lg font-semibold text-foreground">Sent by you</Text>
        {customization.state.outgoing.map((item) => (
          <View key={item.id} className="gap-1 rounded-2xl bg-surface p-4">
            <Text className="font-semibold text-foreground">{item.config.title}</Text>
            <Text className="text-sm text-muted">
              For {item.recipient.name} · {item.recipient.email || item.recipient.phone}
            </Text>
            <Text className="text-xs text-accent">{item.status}</Text>
          </View>
        ))}
      </View>
      {slot !== null ? (
        <Modal open onClose={() => setSlot(null)} title="Choose an animation">
          <Button
            variant="secondary"
            onPress={() => {
              if (slot) edit({ [slot]: "none" as AnimationId });
              setSlot(null);
            }}
          >
            No animation
          </Button>
          {CUSTOM_ANIMATIONS.map((animation) => (
            <Button
              key={animation.id}
              variant="ghost"
              onPress={() => {
                if (slot) {
                  edit({ [slot]: animation.id });
                  setPreviewId(slot);
                }
                setSlot(null);
              }}
            >
              {animation.label}
            </Button>
          ))}
        </Modal>
      ) : null}
      {payment.checkout ? <Checkout payment={payment.checkout} onClose={payment.close} /> : null}
    </ScrollView>
  );
}
