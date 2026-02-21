import { useCallback, useEffect, useRef, useState } from "react";
import { getUserPlan } from "../lib/api";
import type { FeatureId, UserPlanInfo } from "../types";

interface UsePlanResult {
  planInfo: UserPlanInfo | null;
  loading: boolean;
  error: string | null;
  hasFeature: (feature: FeatureId) => boolean;
  refresh: () => void;
}

/**
 * Hook to fetch and cache the user's current plan info.
 * Automatically refreshes when called.
 */
export function usePlan(authReady: boolean): UsePlanResult {
  const [planInfo, setPlanInfo] = useState<UserPlanInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);

  const fetchPlan = useCallback(async () => {
    if (!authReady) return;
    setLoading(true);
    setError(null);
    try {
      const info = await getUserPlan();
      setPlanInfo(info);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load plan");
    } finally {
      setLoading(false);
    }
  }, [authReady]);

  useEffect(() => {
    void fetchPlan();
  }, [fetchPlan]);

  const refresh = useCallback(() => {
    revision.current += 1;
    void fetchPlan();
  }, [fetchPlan]);

  const hasFeature = useCallback(
    (feature: FeatureId): boolean => {
      if (!planInfo) return false;
      return planInfo.features.includes(feature);
    },
    [planInfo]
  );

  return { planInfo, loading, error, hasFeature, refresh };
}
