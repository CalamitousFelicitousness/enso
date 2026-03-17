import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { PlaygroundApp } from "./PlaygroundApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PlaygroundApp />
  </StrictMode>,
);
