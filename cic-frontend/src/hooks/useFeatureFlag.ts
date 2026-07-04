import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';

interface FeatureFlag {
  id: string;
  key: string;
  description?: string;
  enabled: boolean;
  targetingJsonb: Record<string, unknown>;
}

async function fetchFlags(): Promise<FeatureFlag[]> {
  const res = await api.get('/feature-flags');
  return res.data;
}

/** Returns whether a feature flag is enabled for the current user.
 *  Falls back to false when the flag is unknown or the request fails. */
export function useFeatureFlag(key: string): boolean {
  const { data } = useQuery({
    queryKey: ['feature-flags'],
    queryFn: fetchFlags,
    staleTime: 5 * 60 * 1000,
    // Never throw — treat network errors as "flag disabled" to fail safely.
    retry: false,
    throwOnError: false,
  });
  const flag = data?.find((f) => f.key === key);
  return flag?.enabled ?? false;
}
