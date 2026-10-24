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
