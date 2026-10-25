import { getAppToken, getAuthRevision, reportUnauthorized } from "./auth";

export type Capabilities = {
  docker: boolean;
  dockerActions?: { start: boolean; stop: boolean; restart: boolean };
  vm: boolean;
  vmActions?: { start: boolean; stop: boolean; forceStop: boolean };
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

export type DockerContainer = {
  id: string;
  name: string;
  state: string;
  cpuUsage: number | null;
  memoryUsedBytes: number | null;
  memoryLimitBytes: number | null;
  uptimeSeconds: number | null;
  networkRXRate: number | null;
  networkTXRate: number | null;
  diagnostics: string[];
};

export type DockerSnapshot = {
  timestamp: string;
  available: boolean;
  reason?: string;
  containers: DockerContainer[];
  summary: { running: number; stopped: number; other: number };
  diagnostics: string[];
};

export type StorageCapacity = {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
};

export type VMDomain = {
  id: string;
  name: string;
  state: string;
  vcpus: number | null;
  memoryBytes: number | null;
  uptimeSeconds: number | null;
  diagnostics: string[];
};

export type VMSnapshot = {
  timestamp: string;
  available: boolean;
  reason?: string;
  domains: VMDomain[];
  summary: { running: number; stopped: number; other: number };
  diagnostics: string[];
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

export type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class ApiError extends Error {
  readonly code: string;
  readonly details?: string;
  readonly retryable: boolean;

  // Preserve the API failure fields consumed by UI and retry policies.
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

// Fetch a response using the shared credential session.
export async function authenticatedFetch(
  path: string,
  init: RequestInit,
  fetcher: Fetcher = fetch,
): Promise<Response> {
  const revision = getAuthRevision();
  const token = getAppToken();
  const headers = new Headers(init.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (token !== null) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetcher(path, { ...init, headers });
  if (response.status === 401) {
    void response.body?.cancel().catch(() => {});
    reportUnauthorized(revision);
    throw new ApiError("UNAUTHORIZED", "Authentication required", false);
  }
  return response;
}

// Validate capabilities with the same uncached, cancellable transport as reads.
export async function getCapabilities(
  fetcher: Fetcher = fetch,
  signal?: AbortSignal,
): Promise<Capabilities> {
  return request<Capabilities>("/api/v1/capabilities", fetcher, {
    cache: "no-store",
    signal,
  });
}

// Load the latest system sample without retaining an offline snapshot.
export async function getSystem(
  signal?: AbortSignal,
  fetcher: Fetcher = fetch,
): Promise<SystemSnapshot> {
  return request<SystemSnapshot>("/api/v1/system", fetcher, {
    cache: "no-store",
    signal,
  });
}

// Load the latest storage sample with caller cancellation.
export async function getStorage(
  signal?: AbortSignal,
  fetcher: Fetcher = fetch,
): Promise<StorageSnapshot> {
  return request<StorageSnapshot>("/api/v1/storage", fetcher, {
    cache: "no-store",
    signal,
  });
}

// getDocker fetches the current cached sample without offline business caching.
export async function getDocker(
  signal?: AbortSignal,
  fetcher: Fetcher = fetch,
): Promise<DockerSnapshot> {
  return request<DockerSnapshot>("/api/v1/docker", fetcher, {
    cache: "no-store",
    signal,
  });
}

// Load the latest VM sample with caller cancellation.
export async function getVMs(
  signal?: AbortSignal,
  fetcher: Fetcher = fetch,
): Promise<VMSnapshot> {
  return request<VMSnapshot>("/api/v1/vms", fetcher, {
    cache: "no-store",
    signal,
  });
}

// Decode JSON reads after centralized authentication and preserve non-401 errors.
async function request<T>(
  path: string,
  fetcher: Fetcher,
  init: RequestInit,
): Promise<T> {
  const response = await authenticatedFetch(path, init, fetcher);

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
