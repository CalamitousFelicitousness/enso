import { useEffect } from "react";
import { toast } from "sonner";
import { ws, ensureWs } from "@/api/wsManager";
import { useBackendStatusStore } from "@/stores/backendStatusStore";
import { useDownloadStore, type DownloadProgress } from "@/stores/downloadStore";
import { previewMimeType } from "@/lib/image";
import { queryClient } from "@/api/queryClient";
import { jobLists } from "@/api/jobLists";
import { createLiveQueries, isGlobalEvent } from "@/api/liveQueries";

/** Query keys to invalidate when the backend reconnects (e.g. after restart). */
const RECONNECT_INVALIDATE_KEYS = [
  "checkpoint",
  "options",
  "loaded-models",
  "memory",
  "gpu",
  "server-info",
  "frontend-build",
];

/** Lists a finished download may add to; sdnext registers the file before it leaves the active list. */
const DOWNLOAD_INVALIDATE_KEYS = [
  "civitai-check-local",
  "extra-networks",
  "models",
  "vaes",
  "options-info",
];

export function useGlobalWs() {
  useEffect(() => {
    ensureWs();
    let wasConnected = false;
    let downloading = new Set<string>();
    const live = createLiveQueries(queryClient);

    const offOpen = ws.on("open", () => {
      if (wasConnected) {
        for (const key of RECONNECT_INVALIDATE_KEYS) {
          void queryClient.invalidateQueries({ queryKey: [key] });
        }
      }
      // the socket owes nothing from before it opened, the first time included
      live.opened();
      wasConnected = true;
      useBackendStatusStore.getState().setConnected(true);
    });

    const offClose = ws.on("close", (event) => {
      useBackendStatusStore.getState().setConnected(false);
      if (event.code === 4003) {
        toast.error("The server refuses live updates from this address", {
          id: "socket-origin",
          duration: Infinity,
          description: `It takes sockets from its own address and from sdnext's --cors-origins; add ${window.location.origin} there.`,
        });
      }
    });

    const offMessage = ws.on("message", (raw: unknown) => {
      const msg = raw as { type: string; data?: unknown };
      const store = useBackendStatusStore.getState();

      if (msg.type === "progress" && msg.data) {
        store.setStatus(msg.data);
      } else if (msg.type === "status" && msg.data) {
        store.setStatus(msg.data);
        // The server went idle: every job that ran has ended, whichever client sent it
        jobLists.lists();
      } else if (msg.type === "model") {
        // The server's loaded image model changed, from this page or any other client;
        // sdnext lists control models per model type
        void queryClient.invalidateQueries({ queryKey: ["checkpoint"] });
        void queryClient.invalidateQueries({ queryKey: ["control-models"] });
        void queryClient.invalidateQueries({ queryKey: ["control-modes"] });
      } else if (msg.type === "download" && Array.isArray(msg.data)) {
        const items = msg.data as DownloadProgress[];
        useDownloadStore.getState().updateFromWs(items);
        const now = new Set(items.map((item) => item.id));
        if ([...downloading].some((id) => !now.has(id))) {
          for (const key of DOWNLOAD_INVALIDATE_KEYS) {
            void queryClient.invalidateQueries({ queryKey: [key] });
          }
        }
        downloading = now;
      } else if (isGlobalEvent(msg)) {
        live.event(msg);
      }
    });

    const offBinary = ws.on("binary", (buf: ArrayBuffer) => {
      const blob = new Blob([buf], { type: previewMimeType(buf) });
      const url = URL.createObjectURL(blob);
      useBackendStatusStore.getState().setPreview(url);
    });

    return () => {
      offOpen();
      offClose();
      offMessage();
      offBinary();
    };
  }, []);
}
