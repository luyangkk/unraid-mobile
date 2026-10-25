import { ApiError } from "./api";

// shouldRetryRequest stops nonretryable API errors and bounds network retries.
export function shouldRetryRequest(failureCount: number, error: Error): boolean {
  return !(error instanceof ApiError && !error.retryable) && failureCount < 1;
}
