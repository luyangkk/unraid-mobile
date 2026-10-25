import type { RefObject } from "react";
import { setTheme, useTheme, type ThemePreference } from "../../lib/theme";
import { AppSheet } from "./AppSheet";

const options: { value: ThemePreference; label: string; description: string }[] = [
  { value: "dark", label: "Dark", description: "Use a dark appearance." },
  { value: "light", label: "Light", description: "Use a light appearance." },
  { value: "system", label: "System", description: "Follow your device appearance." },
];

// AppearanceSheet keeps the native radio group and its focus mounted through palette changes.
export function AppearanceSheet({ open, onOpenChange, returnFocusRef }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const theme = useTheme();
  return (
    <AppSheet open={open} onOpenChange={onOpenChange} returnFocusRef={returnFocusRef}
      title="Appearance" description="Choose how Unraid Mobile looks.">
      <fieldset className="space-y-2">
        <legend className="sr-only">Color theme</legend>
        {options.map(({ value, label, description }) => (
          <label key={value}
            className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border p-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring ${theme === value ? "border-brand-text bg-surface-muted" : "border-control-border bg-surface"}`}>
            <input type="radio" name="appearance" value={value} checked={theme === value}
              onChange={() => setTheme(value)} className="size-5 shrink-0 accent-brand-text" />
            <span className="min-w-0">
              <span className={`block text-sm font-semibold ${theme === value ? "text-brand-text" : "text-foreground"}`}>{label}</span>
              <span className="block text-xs text-text-muted">{description}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </AppSheet>
  );
}
