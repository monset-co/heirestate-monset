import { useEffect, useRef } from "react";
import { animate } from "animejs";
import loaderSvg from "@/brand/heir-estates-loader.svg?raw";

const SEEN = "heir-intro-seen";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const INTRO_MS = 3900; // the SVG's own CSS timeline: towers rise, windows light, key turns, letters set

// Resolves when fonts and the first frame of the hero's film are in (the others wait unloaded), or after 8s so a slow
// connection still gets in. The loops buffer the rest while they play.
function heroAssets() {
  const videos = [...document.querySelectorAll("video[src]")].map((v) =>
    v.readyState >= 2
      ? null
      : new Promise((r) => {
          v.addEventListener("loadeddata", r, { once: true });
          v.addEventListener("error", r, { once: true });
        })
  );
  return Promise.race([Promise.all([document.fonts.ready, ...videos]), wait(8000)]);
}

// First visit: the skyline rises at dusk, its windows switch on and the key turns in the lock.
// Repeat visits and reduced motion get the finished logo, briefly.
export default function Loader({ onReveal, onDone }) {
  const root = useRef(null);
  const stage = useRef(null);

  let short = matchMedia("(prefers-reduced-motion: reduce)").matches;
  try {
    short ||= sessionStorage.getItem(SEEN) === "1";
  } catch {}

  useEffect(() => {
    let cancelled = false;
    const running = [];
    const html = document.documentElement;
    delete html.dataset.arrive; // the navy painted before the scripts ran (sites.js); the loader is that navy now
    html.style.overflow = "hidden";

    (async () => {
      await Promise.all([heroAssets(), wait(short ? 700 : INTRO_MS)]);
      if (cancelled) return;
      onReveal();
      // the logo steps toward you as the dusk lifts off the hero
      running.push(
        animate(stage.current, { scale: 1.06, opacity: 0, duration: 700, ease: "inQuad" }),
        animate(root.current, { opacity: 0, delay: 350, duration: 650, ease: "outQuad" })
      );
      await running[1];
      if (cancelled) return;
      try {
        sessionStorage.setItem(SEEN, "1");
      } catch {}
      onDone();
    })();

    // React StrictMode runs this effect twice in dev; the first run must leave nothing behind
    return () => {
      cancelled = true;
      running.forEach((a) => a.revert());
      html.style.overflow = "";
    };
  }, [onReveal, onDone, short]);

  return (
    <div
      ref={root}
      role="status"
      aria-label="Loading Heir Estates"
      className={`he-loader fixed inset-0 z-50 grid place-items-center overflow-hidden ${short ? "he-static" : ""}`}
    >
      <div
        ref={stage}
        className="relative w-[min(84vw,560px)] [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
        dangerouslySetInnerHTML={{ __html: loaderSvg }}
      />
    </div>
  );
}
