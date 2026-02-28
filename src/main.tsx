import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { migrateLocalStorage } from "./lib/local-storage-migration";
import { App } from "./App";
import "./index.css";

// Migrate localStorage keys from old "openacpui-*" prefix before React mounts
migrateLocalStorage();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
