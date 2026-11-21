import { StrictMode } from "react";
import { LazyMotion } from "motion/react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/bodoni-moda";
import "@fontsource/marcellus";
import "@fontsource-variable/hanken-grotesk";
import "./admin.css";
import App from "./App";
import { toast } from "./motion";
import "./install"; // catches the browser's install prompt before anything else can miss it

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {/* the animation engine arrives just after the first paint; components render still until then */}
    <LazyMotion features={() => import("./motion-features").then((x) => x.default)}>
      <App />
    </LazyMotion>
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

// Pages load on demand. A tab left open across a deploy asks for the old build's page files, which
// are gone: load the new build instead. At most once a minute, so a real outage doesn't reload
// forever, yet every later deploy in the same tab still gets its reload.
addEventListener("vite:preloadError", (e) => {
  try {
    if (Date.now() - Number(sessionStorage.getItem("reloaded-for-deploy")) < 60_000) return;
    sessionStorage.setItem("reloaded-for-deploy", String(Date.now()));
  } catch {}
  e.preventDefault();
  location.reload();
});
