import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RootBoundary } from "./RootBoundary";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootBoundary><App /></RootBoundary>
  </StrictMode>,
);
