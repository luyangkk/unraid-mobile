# System snapshot API

`GET /api/v1/system` returns the latest cached System snapshot. The
`system.metrics` event on `GET /api/v1/events` sends the same complete schema,
including `networkInterfaces`. Neither requests nor subscribers trigger host
sampling. System samples every second; the timestamp is RFC 3339 UTC.

Existing Bearer authentication and error envelopes apply. Host collection
failure returns HTTP 200 with `available: false` and `reason`; unavailable
optional network metrics do not make CPU or memory unavailable.

## Network fields

```ts
type NetworkInterfaceSnapshot = {
  name: string;
  available: boolean;
  reason?: string;
  rxBytesPerSecond: number | null;
  txBytesPerSecond: number | null;
};

type SystemNetworkFields = {
  networkInterfaces: NetworkInterfaceSnapshot[];
  networkInterface: string;
  networkRXRate: number | null;
  networkTXRate: number | null;
};
```

`networkInterfaces` lists sampled host interfaces in stable name order. A named
invalid counter row remains in the list with `available: false`, a reason and
null rates. No readable counter rows produce `[]`. Rates describe the selected
host interface's RX/TX in **bytes per second**; they are not Internet speed.

The legacy `networkInterface`, `networkRXRate` and `networkTXRate` fields describe
**Auto**, resolved from the valid active default IPv4 route with the lowest
metric. The rates are a projection of the same per-interface calculation, not
another sample. No valid default route means an empty Auto name and null rates;
valid entries in the array can still be selected manually. Network diagnostics
explain route/counter failures.

Each interface uses its own adjacent timestamped counters. First samples, new
interfaces, rollback and recovery are null. Valid counters without traffic
produce zero. Removal and local failure reset only the affected interface;
whole host collection failure resets all baselines. Readable mounted sysfs
ifindex changes reset the relevant baseline. Ifindex is reusable, and sysfs and
procfs namespace views may differ; this is not proof of every same-name
replacement. Identity metadata is not returned.

Snapshots defensively copy arrays, maps and optional metric pointers between the
sampler, cache and subscribers.

## Browser compatibility and history

Old responses without `networkInterfaces` remain usable: the browser displays
Auto via legacy fields. New servers always include the array. Browser selection
is not sent to the server and does not modify host routes or settings.

The persistent Shell retains only the currently selected interface's network
history: at most 60 deduplicated samples in a 60-second window. Server timestamps
define the horizontal position. Null values and gaps greater than 3 seconds
split each direction independently. Selection or resolved Auto-name changes
reset network curves. Reload/logout/session invalidation discard selection and
history. There is no network configuration API or historical/offline metric
storage.
