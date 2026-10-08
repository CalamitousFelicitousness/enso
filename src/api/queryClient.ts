import { QueryClient } from "@tanstack/react-query";

/** The one query client, for code that runs outside React as well as inside. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
});
