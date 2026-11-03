import { useEffect, useRef } from "react";

// A phone's back gesture closes a full-screen overlay (the lightbox, a tour) instead of leaving
// the page: opening one adds a history entry, and back takes it off. Closed any other way, the
// entry comes off too. The take-off waits a tick, so React's dev remount keeps the entry.
let pending = 0;
export function useBackCloses(onClose) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    clearTimeout(pending);
    if (!history.state?.overlay) history.pushState({ ...history.state, overlay: true }, "");
    let popped = false;
    const pop = () => ((popped = true), close.current());
    addEventListener("popstate", pop);
    return () => {
      removeEventListener("popstate", pop);
      if (!popped) pending = setTimeout(() => history.state?.overlay && history.back());
    };
  }, []);
}
