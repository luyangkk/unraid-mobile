export type Capabilities = {
  docker: boolean;
  vm: boolean;
  array?: { read: boolean; start: boolean; stop: boolean };
  parity?: { read: boolean; start: boolean; cancel: boolean };
};

export type SystemSnapshot = {
  timestamp: string;
  available: boolean;
  reason?: string;
  hostname: string;
  uptimeSeconds: number | null;
  cpuUsage: number | null;
  cpuTemperature: number | null;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  networkInterface: string;
  networkRXRate: number | null;
  networkTXRate: number | null;
  diagnostics: Record<string, string>;
};

export type StorageCapacity = {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
};
export type StorageSnapshot = {
  timestamp: string;
  available: boolean;
  reason?: string;
  source: string;
  array: { state: string; diskCount: number; capacity: StorageCapacity | null };
  parity: { state: string; action: string; progress: number | null };
  pools: {
    name: string;
    state: string;
    filesystem: string;
    diskCount: number;
    capacity: StorageCapacity | null;
  }[];
  disks: {
    name: string;
    device: string;
    role: string;
    pool?: string;
    status: string;
    powerState: "active" | "standby" | "unknown";
    filesystem: string;
    filesystemStatus: string;
    sizeBytes: number | null;
    temperature: number | null;
    capacity: StorageCapacity | null;
    readBytesPerSecond: number | null;
    writeBytesPerSecond: number | null;
  }[];
  diagnostics: string[];
};

type ErrorPayload = {
  error?: {
    code?: string;
    message?: string;
    details?: string;
    retryable?: boolean;
  };
};

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class ApiError extends Error {
  readonly code: string;
  readonly details?: string;
  readonly retryable: boolean;

  constructor(
    code: string,
    message: string,
    retryable: boolean,
    details?: string,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export async function getCapabilities(
  fetcher: Fetcher = fetch,
): Promise<Capabilities> {
  return request<Capabilities>("/api/v1/capabilities", fetcher, {
    headers: { Accept: "application/json" },
  });
}

export async function getSystem(
  signal?: AbortSignal,
  fetcher: Fetcher = fetch,
): Promise<SystemSnapshot> {
  return request<SystemSnapshot>("/api/v1/system", fetcher, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });
}

export async function getStorage(
  signal?: AbortSignal,
  fetcher: Fetcher = fetch,
): Promise<StorageSnapshot> {
  return request<StorageSnapshot>("/api/v1/storage", fetcher, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });
}

async function request<T>(
  path: string,
  fetcher: Fetcher,
  init: RequestInit,
): Promise<T> {
  const response = await fetcher(path, init);

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ErrorPayload;
    const error = payload.error;
    throw new ApiError(
      error?.code ?? "REQUEST_FAILED",
      error?.message ?? "The server couldn't complete this request.",
      error?.retryable ?? response.status >= 500,
      error?.details,
    );
  }

  return (await response.json()) as T;
}
