import { useMemo } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

interface MockEntry {
  queryKey: unknown[];
  data: unknown;
}

interface PlaygroundQueryProviderProps {
  /** Pre-seed query cache with exact-match keys. */
  mocks?: MockEntry[];
  /** Prefix-based fallback: if a query key starts with the prefix string,
   *  return the associated data instead of hitting the network.
   *  Useful for parameterized hooks like useExtraNetworks. */
  prefixMocks?: Record<string, unknown>;
  children: React.ReactNode;
}

/**
 * Provides a TanStack QueryClient for playground panels that use API hooks.
 *
 * Supports two mocking strategies:
 * - `mocks`: exact key match (good for simple keys like `["prompt-styles"]`)
 * - `prefixMocks`: prefix match (good for parameterized keys like `["extra-networks", {...}]`)
 *
 * Mutations (useMutation) work without mocking — they just won't hit a backend.
 */
export function PlaygroundQueryProvider({
  mocks = [],
  prefixMocks = {},
  children,
}: PlaygroundQueryProviderProps) {
  const client = useMemo(() => {
    const qc = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          refetchOnWindowFocus: false,
          refetchOnMount: false,
          refetchOnReconnect: false,
          staleTime: Infinity,
          // Prefix-based fallback: return mock data for any matching key prefix
          queryFn: ({ queryKey }) => {
            const prefix = String(queryKey[0]);
            if (prefix in prefixMocks) return prefixMocks[prefix];
            // No mock available — return undefined to avoid network request
            return undefined;
          },
        },
        mutations: {
          // Mutations fire on user action only; let them fail silently
          retry: false,
        },
      },
    });

    // Seed exact-match keys
    for (const { queryKey, data } of mocks) {
      qc.setQueryData(queryKey, data);
    }

    return qc;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <QueryClientProvider client={client}>
      {children}
    </QueryClientProvider>
  );
}
