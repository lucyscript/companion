import { useEffect, useMemo, useState } from "react";
import { getDashboard } from "../lib/api";
import { DashboardSnapshot } from "../types";

const pollIntervalMs = 6000;

export function useDashboard(enabled = true): {
  data: DashboardSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [data, setData] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useMemo(
    () => async () => {
      try {
        const snapshot = await getDashboard();
        setData(snapshot);
        setError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown dashboard error";
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setData(null);
      setError(null);
      return;
    }

    setLoading(true);
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, pollIntervalMs);

    return () => clearInterval(timer);
  }, [enabled, refresh]);

  return {
    data,
    loading,
    error,
    refresh
  };
}
