import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/bodoni-moda";
import "@fontsource/marcellus";
import "@fontsource-variable/hanken-grotesk";
import "./admin.css";
import App from "./App";
import { toast } from "./motion";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// An installable app that opens fast and offline. A new deploy takes over quietly; offer a reload
// rather than forcing one mid-edit.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController) toast("A new version of the admin is ready.", { ms: 60_000, action: { label: "Reload", run: () => location.reload() } });
  });
}
