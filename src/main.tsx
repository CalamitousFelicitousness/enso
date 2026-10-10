import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import "./index.css";
import App from "./App.tsx";
import { queryClient } from "./api/queryClient";
import { api } from "./api/client";
import { startSession } from "./api/session";
import { useConnectionStore } from "./stores/connectionStore";

// The stored connection applies before anything renders, queries or opens a socket
const { backendUrl, username, password } = useConnectionStore.getState();
if (backendUrl) api.setBaseUrl(backendUrl);
if (username && password) api.setAuth(username, password);
void startSession();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
