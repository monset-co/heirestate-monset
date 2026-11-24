// The desktop rail, grouped by what each page is for. It folds to icons only (remembered per
// device); folded, a liquid bulge flows out of the rail's edge toward whichever icon the pointer is
// nearest (or the one with keyboard focus) and carries its name: Motionbook's Liquid Bulge (T2)
// turned on its side. The bulge is the rail's own navy, merged into it by an SVG goo filter; its
// text sits on an unfiltered copy so it stays crisp.
import { ChevronDown, ChevronsLeft, ChevronsRight, LogOut } from "lucide-react";
import { m as motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router";
import Bell from "./Bell";
import ThemeSwitch from "./ThemeSwitch";
import { spring } from "./motion";
import { useStored } from "./ui";

const GOO = { stiffness: 240, damping: 20, mass: 1.2 }; // Motionbook spring.gooey
const SLIM = 72; // px, the folded rail
const NEAR = 28; // px: how close to an icon the pointer must be for its bulge

export function useSlim() {
  const [slim, set] = useStored("rail-slim", "0");
  return [slim === "1", () => set(slim === "1" ? "0" : "1")];
}

export default function Rail({ groups, section, slim, onToggle, me, mark, install, signOut }) {
  const aside = useRef(null);
  const links = useRef({});
  // the nav scrolls on short screens with no scrollbar; its edges fade where there's more, and a
  // small chevron at the foot says (and takes you to) what's below
  const list = useRef(null);
  const [edge, setEdge] = useState({ up: false, down: false });
  useEffect(() => {
    const el = list.current;
    const check = () => setEdge({ up: el.scrollTop > 2, down: el.scrollTop + el.clientHeight < el.scrollHeight - 2 });
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    el.addEventListener("scroll", check, { passive: true });
    return () => (ro.disconnect(), el.removeEventListener("scroll", check));
  }, [slim]);
  const fade = `linear-gradient(to bottom, transparent 0, #000 ${edge.up ? 28 : 0}px, #000 calc(100% - ${edge.down ? 36 : 0}px), transparent 100%)`;
  const [near, setNear] = useState(null); // { to, label, y } the bulge is out for

  // the item nearest the pointer, by its centre, if near enough; once a frame at most
  const frame = useRef(0);
  const track = (e) => {
    if (!slim || frame.current) return;
    const { clientY } = e;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      nearest(clientY);
    });
  };
  const nearest = (clientY) => {
    const top = aside.current.getBoundingClientRect().top;
    let best = null;
    for (const g of groups)
      for (const it of g.items) {
        const el = links.current[it.to];
        if (!el) continue;
        const b = el.getBoundingClientRect();
        const d = Math.abs(clientY - (b.top + b.height / 2));
        if (d <= NEAR && (!best || d < best.d)) best = { to: it.to, label: it.label, y: b.top + b.height / 2 - top, d };
      }
    if (best?.to !== near?.to || (best && Math.abs(best.y - near.y) > 1)) setNear(best);
  };
  const focusOn = (it) => (e) => {
    if (!slim) return;
    const b = e.currentTarget.getBoundingClientRect();
    setNear({ to: it.to, label: it.label, y: b.top + b.height / 2 - aside.current.getBoundingClientRect().top });
  };

  return (
    <aside
      ref={aside}
      onPointerMove={track}
      onPointerLeave={() => setNear(null)}
      className="on-navy sticky top-0 isolate z-20 hidden h-dvh flex-col bg-side text-cream print:hidden md:flex"
    >
      {slim && <Bulge near={near} />}

      <div className={`relative z-[1] flex shrink-0 items-center gap-2 ${slim ? "h-20 flex-col justify-center" : "h-20 justify-between px-5"}`}>
        {slim ? <img src="/logo.svg" alt="Heir Estates" className="h-9 w-auto" /> : mark}
        {!slim && (
          <span className="flex items-center">
            <ThemeSwitch />
            <Bell />
          </span>
        )}
      </div>

      <div className="relative z-[1] mt-1 flex min-h-0 flex-1 flex-col">
      <nav
        ref={list}
        aria-label="Main"
        onScroll={() => slim && setNear(null)}
        style={{ maskImage: fade, WebkitMaskImage: fade }}
        className={`flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${slim ? "items-center px-2" : "px-3"}`}
      >
        {groups.map((g, gi) => (
          <div key={g.name ?? gi} className={gi ? "mt-4" : ""} role="group" aria-label={g.name ?? "Overview"}>
            {g.name &&
              (slim ? (
                <span aria-hidden className="mx-auto mb-2 block h-px w-6 bg-cream/12" />
              ) : (
                <p className="label mb-1.5 px-3 text-[0.65rem] text-cream/40">{g.name}</p>
              ))}
            <div className="flex flex-col gap-0.5">
              {g.items.map((it) => {
                const { to, label, icon: Icon } = it;
                const active = to === section;
                return (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === "/"}
                    ref={(el) => (links.current[to] = el)}
                    aria-label={slim ? label : undefined}
                    onFocus={focusOn(it)}
                    onBlur={() => slim && setNear(null)}
                    className={`press relative flex items-center rounded-md text-sm font-medium ${slim ? "size-11 justify-center" : "gap-3 px-3 py-2"} ${active ? "text-cream" : "text-cream/60 hover:text-cream"}`}
                  >
                    {active && (
                      <motion.span layoutId="nav-pill" transition={spring} className="absolute inset-0 rounded-md bg-side-2 ring-1 ring-cream/8">
                        <span className="absolute top-1/2 left-0 h-4 w-[3px] -translate-y-1/2 rounded-full bg-gold" />
                      </motion.span>
                    )}
                    <Icon className={`relative size-[1.05rem] transition-colors ${active ? "text-gold" : ""}`} aria-hidden />
                    {!slim && <span className="relative">{label}</span>}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={() => list.current.scrollBy({ top: list.current.clientHeight * 0.7, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })}
        className={`absolute bottom-1 left-1/2 grid size-6 -translate-x-1/2 place-items-center rounded-full bg-side-2 text-cream/60 ring-1 ring-cream/10 transition-[opacity,transform] duration-200 ease-[var(--ease-out)] hover:text-cream ${edge.down ? "opacity-100" : "pointer-events-none translate-y-1 opacity-0"}`}
      >
        <ChevronDown className="size-3.5" />
      </button>
      </div>

      <div className={`relative z-[1] shrink-0 border-t border-cream/10 ${slim ? "flex flex-col items-center gap-1 py-3" : "p-3"}`}>
        {slim ? (
          <>
            <ThemeSwitch />
            <Bell />
            <span title={`${me.name}\n${me.email}`} className="mt-1 grid size-9 place-items-center rounded-full bg-side-2 text-xs font-semibold text-champagne">
              {me.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
            </span>
            {install("press grid size-10 place-items-center rounded-md text-gold hover:bg-side-2 [&>span]:sr-only")}
            <button onClick={signOut} aria-label="Sign out" className="press grid size-10 place-items-center rounded-md text-cream/55 hover:bg-side-2 hover:text-cream">
              <LogOut className="size-4" aria-hidden />
            </button>
          </>
        ) : (
          <>
            <div className="px-1 text-sm">
              <div className="truncate font-medium">{me.name}</div>
              <div className="truncate text-xs text-cream/50">{me.email}</div>
            </div>
            {install("press mt-2 flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-gold hover:bg-side-2 hover:text-champagne")}
            <button onClick={signOut} className="press flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-cream/65 hover:bg-side-2 hover:text-cream">
              <LogOut className="size-4" aria-hidden />
              Sign out
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-label={slim ? "Expand the sidebar" : "Collapse the sidebar"}
          aria-pressed={slim}
          title={slim ? "Expand" : "Collapse"}
          className={`press grid place-items-center rounded-md text-cream/35 hover:bg-side-2 hover:text-cream ${slim ? "mt-1 size-10" : "mt-1 ml-auto size-8"}`}
        >
          {slim ? <ChevronsRight className="size-4" aria-hidden /> : <ChevronsLeft className="size-4" aria-hidden />}
        </button>
      </div>
    </aside>
  );
}

// The bulge: a navy pill that slides out from under the rail's edge at the icon's height, merged
// into the rail by the goo filter, with its label on a crisp copy above. Only a band around it is
// filtered, so the blur stays cheap.
function Bulge({ near }) {
  const reduce = useReducedMotion();
  const navigate = useNavigate();
  const pill = useRef(null);
  const [width, setWidth] = useState(0);
  const [label, setLabel] = useState("");
  if (near && near.label !== label) setLabel(near.label); // the last label stays while it retracts

  const y = useSpring(0, GOO);
  const out = useSpring(0, GOO);
  const target = useMotionValue(0);
  useLayoutEffect(() => {
    if (near) {
      if (reduce || out.get() < 0.05) y.jump(near.y);
      else y.set(near.y);
    }
    if (reduce) out.jump(near ? 1 : 0);
    else out.set(near ? 1 : 0);
  }, [near?.y, !!near, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (pill.current) setWidth(pill.current.offsetWidth);
  }, [label]);
  useLayoutEffect(() => target.set(width), [width, target]);
  // hidden: the pill's right end 4px inside the rail; out: it overlaps the rail by 12px
  const x = useTransform([out, target], ([o, w]) => o * (w - 8));
  const band = useTransform(y, (v) => v - 80);
  const textOpacity = useTransform(out, [0.55, 1], [0, 1]);
  const labelY = useTransform(y, (v) => v - 20);
  const left = SLIM - width - 4;

  const shape = "flex h-10 items-center whitespace-nowrap rounded-full pr-4 pl-6 text-[0.8125rem] font-semibold";
  return (
    <>
      <svg width="0" height="0" aria-hidden className="absolute">
        <filter id="rail-goo">
          <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="b" />
          <feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9" />
        </filter>
      </svg>
      <motion.div aria-hidden className="pointer-events-none absolute top-0 left-0 z-0 h-40 w-[calc(72px+16rem)]" style={{ y: band, filter: "url(#rail-goo)" }}>
        <span className="absolute inset-y-0 left-0 bg-side" style={{ width: SLIM }} />
        <motion.span ref={pill} className={`absolute top-[60px] bg-side text-transparent ${shape}`} style={{ left, x }}>
          {label}
        </motion.span>
      </motion.div>
      {/* the same pill, unfiltered and see-through, for its crisp label; a click goes there too */}
      <motion.button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={() => near && navigate(near.to)}
        className={`absolute top-0 z-[2] text-champagne ${shape} ${near ? "" : "pointer-events-none"}`}
        style={{ left, x, y: labelY, opacity: textOpacity }}
      >
        {label}
      </motion.button>
    </>
  );
}
