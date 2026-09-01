import { useCallback, useEffect, useState } from "react";

export type ApiDataState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; error: string };

/**
 * Generic fail-closed data hook: `loader` returning null disables the fetch
 * (e.g. no authenticated token). Errors are surfaced, never swallowed or
 * substituted with synthetic data.
 */
export function useApiData<T>(loader: (() => Promise<T>) | null): { state: ApiDataState<T>; reload: () => void } {
  const [state, setState] = useState<ApiDataState<T>>({ status: "idle" });
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (loader === null) {
      setState({ status: "idle" });
      return;
    }
    let active = true;
    setState({ status: "loading" });
    loader().then(
      (data) => {
        if (active) {
          setState({ status: "ready", data });
        }
      },
      (error: unknown) => {
        if (active) {
          setState({ status: "error", error: error instanceof Error ? error.message : "request failed" });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [loader, generation]);

  const reload = useCallback(() => setGeneration((current) => current + 1), []);
  return { state, reload };
}
