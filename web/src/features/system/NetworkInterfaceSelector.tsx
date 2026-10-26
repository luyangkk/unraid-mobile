import { useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { AppSheet } from "../../components/app/AppSheet";
import { Button } from "../../components/ui/button";
import type { NetworkInterfaceSnapshot, SystemSnapshot } from "../../lib/api";
import { resolveNetwork } from "../../lib/network";

// NetworkInterfaceSelector owns only modal visibility; telemetry selection stays in the Shell.
export function NetworkInterfaceSelector({ snapshot, selection, selectedNetwork, onSelectionChange }: {
  snapshot: SystemSnapshot;
  selection: string | null;
  selectedNetwork: NetworkInterfaceSnapshot;
  onSelectionChange: (selection: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const groupId = useId();
  const auto = resolveNetwork(snapshot, null);
  const interfaces = snapshot.networkInterfaces ?? [];
  const label = selection === null
    ? `Auto${auto.name ? ` · ${auto.name}` : ""}`
    : selection;
  const options: { value: string | null; label: string; description?: string; available: boolean }[] = [
    {
      value: null, label: "Auto", available: auto.available,
      description: auto.available ? `Default route · ${auto.name}`
        : auto.reason ?? "Default network interface unavailable",
    },
    ...interfaces.map((entry) => ({
      value: entry.name, label: entry.name, available: entry.available,
      description: entry.available ? undefined : entry.reason ?? "Network interface unavailable",
    })),
    ...(selection !== null && !interfaces.some((entry) => entry.name === selection)
      ? [{ value: selection, label: selection, available: false,
        description: selectedNetwork.reason ?? "Selected network interface unavailable" }]
      : []),
  ];

  // choose applies the display selection once and dismisses through AppSheet's focus lifecycle.
  function choose(value: string | null) {
    onSelectionChange(value);
    setOpen(false);
  }

  return (
    <>
      <Button ref={trigger} type="button" variant="secondary"
        className="min-w-0 max-w-[70%] gap-2 px-3 text-sm font-medium"
        aria-label={`Network interface: ${label}${selectedNetwork.available ? "" : " (unavailable)"}`}
        aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown aria-hidden="true" size={14} className="shrink-0" />
      </Button>
      <AppSheet open={open} onOpenChange={setOpen} returnFocusRef={trigger}
        title="Network interface" description="Choose one interface to display. Host configuration is unchanged.">
        <fieldset className="space-y-2">
          <legend className="sr-only">Network interface</legend>
          {options.map((option, index) => {
            const selected = option.value === selection;
            const descriptionId = `${groupId}-${index}`;
            return (
              <label key={option.value === null ? "auto" : `interface:${option.value}`}
                className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border p-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring ${selected ? "border-brand-text bg-surface-muted" : "border-control-border bg-surface"}`}
                onClick={() => { if (selected) setOpen(false); }}>
                <input type="radio" name={groupId} value={option.value ?? ""}
                  checked={selected} aria-label={option.label}
                  aria-describedby={option.description ? descriptionId : undefined}
                  onChange={() => choose(option.value)} className="size-4 shrink-0 accent-brand-text" />
                <span className="min-w-0">
                  <span className={`block break-all text-sm font-semibold ${selected ? "text-brand-text" : "text-foreground"}`}>
                    {option.label}
                  </span>
                  {option.description ? <span id={descriptionId}
                    className={`mt-1 block break-words text-xs ${option.available ? "text-text-muted" : "text-warning"}`}>
                    {option.description}
                  </span> : null}
                </span>
              </label>
            );
          })}
        </fieldset>
      </AppSheet>
    </>
  );
}
