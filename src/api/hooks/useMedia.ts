// The media store's lists and settings, read through TanStack Query and kept
// current by the server's change events, not by polling.

import { useQuery } from "@tanstack/react-query";
import { api } from "../client";
import { LIBRARY_KEY, REPORT_KEY, retryUnlessRefused, SETTINGS_KEY, TRASH_KEY } from "../queryKeys";
import type {
  ResLibraryV2,
  ResMediaReportV2,
  ResMediaSettingsV2,
  ResTrashV2,
} from "../types/media";

export const libraryQuery = {
  queryKey: LIBRARY_KEY,
  queryFn: () => api.get<ResLibraryV2>("/sdapi/v2/library"),
  staleTime: Infinity,
  retry: retryUnlessRefused,
};

export const trashQuery = {
  queryKey: TRASH_KEY,
  queryFn: () => api.get<ResTrashV2>("/sdapi/v2/library/trash"),
  staleTime: Infinity,
  retry: retryUnlessRefused,
};

export const mediaSettingsQuery = {
  queryKey: SETTINGS_KEY,
  queryFn: () => api.get<ResMediaSettingsV2>("/sdapi/v2/media/settings"),
  staleTime: Infinity,
  retry: retryUnlessRefused,
};

/** The saved entries, pinned first, then by use. */
export function useLibrary(enabled = true) {
  return useQuery({ ...libraryQuery, enabled });
}

/** The entries in the server's trash, newest first. */
export function useServerTrash(enabled = true) {
  return useQuery({ ...trashQuery, enabled });
}

export function useMediaSettings(enabled = true) {
  return useQuery({ ...mediaSettingsQuery, enabled });
}

export function useMediaReport(enabled = true) {
  return useQuery({
    queryKey: REPORT_KEY,
    queryFn: () => api.get<ResMediaReportV2>("/sdapi/v2/media"),
    staleTime: Infinity,
    retry: retryUnlessRefused,
    enabled,
  });
}
