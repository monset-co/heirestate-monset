// Installing the admin as an app. Chrome, Edge and Android offer their own install prompt, which
// the browser hands over once (beforeinstallprompt), so it's caught here, as early as the page
// loads, and kept until someone presses Install. Safari (iPhone, iPad, Mac) has no prompt; there
// the button leads to the steps in Settings instead.
import { useEffect, useState } from "react";

let deferred = null; // the browser's install prompt, while it's on offer
const subs = new Set();
const emit = () => subs.forEach((s) => s());

const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault(); // keep it for our own button rather than the browser's mini bar
  deferred = e;
  emit();
});
addEventListener("appinstalled", () => {
  deferred = null;
  emit();
});

// which steps to show: iPhone/iPad, Mac Safari, Android, or a desktop browser
export function device() {
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "ios";
  if (/android/i.test(ua)) return "android";
  if (/safari/i.test(ua) && !/chrome|chromium|edg/i.test(ua)) return "mac-safari";
  return "desktop";
}

export function useInstall() {
  const [, render] = useState(0);
  useEffect(() => {
    const on = () => render((n) => n + 1);
    subs.add(on);
    const mq = matchMedia("(display-mode: standalone)");
    mq.addEventListener?.("change", on);
    return () => {
      subs.delete(on);
      mq.removeEventListener?.("change", on);
    };
  }, []);
  return {
    installed: standalone(),
    canPrompt: !!deferred,
    // shows the browser's install dialog; true if they accepted
    async prompt() {
      if (!deferred) return false;
      const e = deferred;
      deferred = null;
      e.prompt();
      const { outcome } = await e.userChoice;
      emit();
      return outcome === "accepted";
    },
  };
}
