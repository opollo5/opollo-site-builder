"use client";

import { useCallback, useRef, useState } from "react";

// Spec 07 PR B — async-action hook with three load-bearing safeguards:
//
//   1. In-flight de-dupe via inFlightRef — clicking Publish twice in
//      a row only fires one request. The second call is silently
//      dropped (no error, no double-toast).
//   2. Hard timeout — caller picks the budget; default 30s. Past that,
//      onTimeout fires and the button re-enables. WP publish gets 60s,
//      fast saves 10s, default 30s.
//   3. Error surfacing — onError fires with the actual error so the
//      caller renders a banner / toast, NOT a silent swallow.
//
// Wire to <LoadingButton loading={loading} ... /> for the visual half.
//
// Note on cancellation: this hook does NOT abort the underlying request
// at the timeout. The caller is responsible for AbortController if it
// wants to cut the network call. This hook only stops UI-side waiting.

interface UseAsyncActionOptions {
  /** Defaults to 30_000 (30s). Pick higher (60s) for WP publish, lower (10s) for fast saves. */
  timeoutMs?: number;
  onSuccess?: (result: unknown) => void;
  onError?: (error: Error) => void;
  onTimeout?: () => void;
}

interface UseAsyncActionResult<TArgs extends unknown[], TResult> {
  run: (...args: TArgs) => Promise<TResult | undefined>;
  loading: boolean;
  error: Error | null;
  reset: () => void;
}

export function useAsyncAction<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => Promise<TResult>,
  options: UseAsyncActionOptions = {},
): UseAsyncActionResult<TArgs, TResult> {
  const { timeoutMs = 30_000, onSuccess, onError, onTimeout } = options;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const inFlightRef = useRef(false);

  const run = useCallback(
    async (...args: TArgs): Promise<TResult | undefined> => {
      if (inFlightRef.current) return undefined;
      inFlightRef.current = true;
      setLoading(true);
      setError(null);

      let timedOut = false;
      const timeoutPromise = new Promise<never>((_, reject) => {
        const t = setTimeout(() => {
          timedOut = true;
          reject(new Error(`Action timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        // Best-effort cleanup; the race rejection is what matters.
        return () => clearTimeout(t);
      });

      try {
        const result = await Promise.race([action(...args), timeoutPromise]);
        onSuccess?.(result);
        return result;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        if (timedOut) onTimeout?.();
        else onError?.(e);
        return undefined;
      } finally {
        inFlightRef.current = false;
        setLoading(false);
      }
    },
    [action, timeoutMs, onSuccess, onError, onTimeout],
  );

  const reset = useCallback(() => {
    setError(null);
  }, []);

  return { run, loading, error, reset };
}
