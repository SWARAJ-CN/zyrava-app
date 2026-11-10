import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useMemo,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Text, View } from "react-native";
import { Input as HeroInput, Select as HeroSelect, TextArea as HeroTextArea } from "heroui-native";
import { cn } from "@/lib/cn";
import { useI18n } from "@/components/providers/I18nProvider";

/**
 * Carries the visible `Field` label down to controls that need to describe
 * themselves to assistive tech (the native equivalents of React Aria's hidden
 * controls are the `accessibilityLabel` props).
 */
const FieldLabelContext = createContext<string | undefined>(undefined);

export { FieldLabelContext };

interface SelectOption {
  value: string;
  label: ReactNode;
  /** Plain-text form of the label, for the placeholder. */
  text: string;
  disabled?: boolean;
}

/** Reads the plain `<option>`/`<Option>` children the rest of the app already passes in. */
function parseOptions(children: ReactNode): SelectOption[] {
  const options: SelectOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as {
      value?: unknown;
      children?: ReactNode;
      disabled?: boolean;
    };
    const label = props.children;
    options.push({
      value: String(props.value ?? ""),
      label,
      text: typeof label === "string" || typeof label === "number" ? String(label) : "",
      disabled: props.disabled,
    });
  });
  return options;
}

interface SelectChangeEvent {
  target: { value: string };
}

/** A single choice inside `<Select>` for call sites that used `<option>` markup. */
export function Option(_props: {
  value?: string | number;
  disabled?: boolean;
  children?: ReactNode;
}): null {
  // Never rendered — `Select` reads the props and builds native `Select.Item`s.
  return null;
}

type HeroInputProps = ComponentProps<typeof HeroInput>;

/**
 * The web `<input>` prop surface, mapped to native `Input` props below.
 * `onChange` keeps the DOM-ish `{ target: { value } }` event so ported pages
 * need no edits.
 */
export interface InputProps extends Omit<HeroInputProps, "onChange" | "type" | "autoComplete"> {
  onChange?: (event: { target: { value: string } }) => void;
  type?: "text" | "email" | "password" | "tel" | "search" | "number" | "url";
  /** Web autocomplete tokens are accepted and mapped to the native enum. */
  autoComplete?: string;
  disabled?: boolean;
  required?: boolean;
  "aria-invalid"?: boolean;
  "aria-label"?: string;
  id?: string;
}

/** Web `type` → native keyboard/entry props. */
const TYPE_PROPS: Record<NonNullable<InputProps["type"]>, Partial<HeroInputProps>> = {
  text: {},
  email: { keyboardType: "email-address", autoCapitalize: "none", autoCorrect: false },
  password: { secureTextEntry: true, autoCapitalize: "none", autoCorrect: false },
  tel: { keyboardType: "phone-pad" },
  search: { keyboardType: "web-search" },
  number: { keyboardType: "numeric" },
  url: { keyboardType: "url", autoCapitalize: "none", autoCorrect: false },
};

/** Web `autoComplete` tokens → native equivalents (unmapped values are dropped). */
const AUTO_COMPLETE: Record<string, NonNullable<HeroInputProps["autoComplete"]>> = {
  name: "name",
  email: "email",
  tel: "tel",
  username: "username",
  "current-password": "current-password",
  "new-password": "new-password",
  "one-timecode": "one-time-code",
  "cc-number": "cc-number",
  "cc-name": "cc-name",
};

export function Input({
  className,
  value,
  onChange,
  type = "text",
  disabled,
  required,
  autoComplete,
  "aria-invalid": ariaInvalid,
  "aria-label": ariaLabel,
  id,
  ...props
}: InputProps): ReactNode {
  void required; // required-marking lives on the `Field` label on native
  return (
    <HeroInput
      className={cn("w-full", className)}
      value={value ?? ""}
      onChangeText={onChange ? (text) => onChange({ target: { value: text } }) : undefined}
      secureTextEntry={TYPE_PROPS[type].secureTextEntry}
      keyboardType={TYPE_PROPS[type].keyboardType}
      autoCapitalize={TYPE_PROPS[type].autoCapitalize}
      autoCorrect={TYPE_PROPS[type].autoCorrect}
      autoComplete={autoComplete ? AUTO_COMPLETE[autoComplete] : undefined}
      editable={disabled ? false : props.editable}
      isDisabled={disabled}
      isInvalid={ariaInvalid}
      accessibilityLabel={ariaLabel}
      nativeID={id}
      {...props}
    />
  );
}

export interface TextareaProps extends Omit<ComponentProps<typeof HeroTextArea>, "onChange"> {
  onChange?: (event: { target: { value: string } }) => void;
  disabled?: boolean;
  required?: boolean;
  rows?: number;
  "aria-invalid"?: boolean;
  "aria-label"?: string;
}

export function Textarea({
  className,
  value,
  onChange,
  disabled,
  required,
  rows,
  "aria-invalid": ariaInvalid,
  "aria-label": ariaLabel,
  ...props
}: TextareaProps): ReactNode {
  void required; // required-marking lives on the `Field` label on native
  return (
    <HeroTextArea
      // `resize-y` is web-only; native text areas grow with their content box.
      className={cn("min-h-20 w-full", className)}
      multiline
      value={value ?? ""}
      onChangeText={onChange ? (text) => onChange({ target: { value: text } }) : undefined}
      numberOfLines={rows}
      editable={disabled ? false : props.editable}
      isDisabled={disabled}
      isInvalid={ariaInvalid}
      accessibilityLabel={ariaLabel}
      {...props}
    />
  );
}

interface SelectProps {
  id?: string;
  value?: string;
  onChange?: (event: SelectChangeEvent) => void;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
  /** Pre-parsed choices; when omitted they are read from `<Option>` children. */
  options?: { value: string; label?: ReactNode; disabled?: boolean }[];
  children?: ReactNode;
}

/**
 * The web `<select>` API kept intact: it still accepts `<Option value>label</Option>`
 * children (or a ready-made `options` array), reports `{ target: { value } }`
 * changes, and opens the native popover list instead of the DOM dropdown.
 */
export function Select({
  className,
  children,
  value,
  onChange,
  placeholder,
  disabled,
  required,
  id,
  "aria-label": ariaLabel,
  options,
}: SelectProps): ReactNode {
  void required; // required-marking lives on the `Field` label on native
  const { t } = useI18n();
  const parsed = useMemo(
    () =>
      options
        ? options.map((option) => ({
            value: String(option.value),
            label: option.label ?? String(option.value),
            text:
              typeof option.label === "string" || typeof option.label === "number"
                ? String(option.label)
                : "",
            disabled: option.disabled,
          }))
        : parseOptions(children),
    [children, options]
  );
  const placeholderOption = parsed.find((option) => option.value === "");
  const items = parsed.filter((option) => option.value !== "");
  const selected = value === undefined || value === null || value === "" ? null : String(value);
  const fieldLabel = useContext(FieldLabelContext);
  const label = ariaLabel ?? fieldLabel ?? placeholder ?? placeholderOption?.text;
  const placeholderText = placeholder ?? placeholderOption?.text ?? t("Select…");

  const selectedOption =
    selected === null ? undefined : parsed.find((option) => option.value === selected);

  return (
    <HeroSelect
      value={
        selectedOption
          ? { value: selectedOption.value, label: selectedOption.text || selectedOption.value }
          : undefined
      }
      onValueChange={(next) =>
        onChange?.({
          target: { value: next && !Array.isArray(next) ? next.value : "" },
        })
      }
      isDisabled={disabled}
    >
      <HeroSelect.Trigger
        className={cn("w-full", className)}
        accessibilityLabel={label}
        nativeID={id}
      >
        <HeroSelect.Value placeholder={placeholderText} />
        <HeroSelect.TriggerIndicator />
      </HeroSelect.Trigger>
      <HeroSelect.Portal>
        <HeroSelect.Overlay />
        <HeroSelect.Content presentation="popover">
          {items.map((option) => (
            <HeroSelect.Item
              key={option.value}
              value={option.value}
              label={option.text || String(option.value)}
              disabled={option.disabled}
            >
              {/*
                `Select.ItemLabel` renders the item's plain-text `label`, so a
                rich (non-string) label is placed in the item row directly. */}
              {typeof option.label === "string" ? undefined : (
                <>
                  {option.label}
                  <HeroSelect.ItemIndicator />
                </>
              )}
            </HeroSelect.Item>
          ))}
        </HeroSelect.Content>
      </HeroSelect.Portal>
    </HeroSelect>
  );
}

interface FieldProps {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  className,
  children,
}: FieldProps): ReactNode {
  void htmlFor; // native focus is driven by tapping the field, not the label's `for`
  return (
    <FieldLabelContext.Provider value={typeof label === "string" ? label : undefined}>
      <View className={cn("flex-col gap-1.5", className)}>
        <View className="flex-row flex-wrap items-center gap-1">
          {typeof label === "string" ? (
            <Text className="text-xs font-semibold text-muted">{label}</Text>
          ) : (
            label
          )}
          {required ? <Text className="text-xs font-semibold text-danger">*</Text> : null}
        </View>
        {children}
        {error ? (
          typeof error === "string" ? (
            <Text className="text-xs font-medium text-danger">{error}</Text>
          ) : (
            error
          )
        ) : hint ? (
          typeof hint === "string" ? (
            <Text className="text-xs text-muted">{hint}</Text>
          ) : (
            hint
          )
        ) : null}
      </View>
    </FieldLabelContext.Provider>
  );
}
