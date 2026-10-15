import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./app/App.tsx";
import { AppProviders } from "./app/context.tsx";
import "./app/styles.css";
import { lazy, Suspense } from "react";
import { readAppMode } from "./config/mode.ts";
const RealApp = lazy(() =>
  import("./real/RealApp.tsx").then((m) => ({ default: m.RealApp })),
);
const real = readAppMode() === "real" || location.pathname.startsWith("/real");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      {real ? (
        <Suspense fallback={<p>FLOW RUN을 준비하고 있어요.</p>}>
          <RealApp />
        </Suspense>
      ) : (
        <AppProviders>
          <App />
        </AppProviders>
      )}
    </BrowserRouter>
  </StrictMode>,
);
