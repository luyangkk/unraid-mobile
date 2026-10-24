export type Capabilities = {
  docker: boolean;
  vm: boolean;
  array?: { read: boolean; start: boolean; stop: boolean };
  parity?: { read: boolean; start: boolean; cancel: boolean };
};

type ErrorPayload = {
  error?: {
    code?: string;
    message?: string;
    details?: string;
    retryable?: boolean;
  };
};

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class ApiError extends Error {
  readonly code: string;
  readonly details?: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean, details?: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export async function getCapabilities(fetcher: Fetcher = fetch): Promise<Capabilities> {
  const response = await fetcher("/api/v1/capabilities", {
    headers: { Accept: "application/json" },
  });

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

  return (await response.json()) as Capabilities;
}
