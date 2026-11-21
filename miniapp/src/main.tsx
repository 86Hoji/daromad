import { StrictMode } from "react";
import { BRAND, BRAND_TAGLINE } from "./lib/brand";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { setupTelegram } from "./lib/telegram";

setupTelegram();
document.title = `${BRAND} — ${BRAND_TAGLINE}`;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
