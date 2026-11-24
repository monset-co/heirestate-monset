// Motion for the admin, from the Monset dashboard (dashboard-monset/src/components/motion.tsx):
// a snappy spring for position and short fades, rows that arrive and leave instead of popping,
// skeleton rows, and toasts.
import { AnimatePresence, animate, m as motion, useReducedMotion } from "motion/react";
import { createContext, useContext, useEffect, useRef, useState } from "react";

export const spring = { type: "spring", stiffness: 500, damping: 38, mass: 0.9 };

// A row fades down into place; a removed row fades while the rest slide up. Wrap rows in <Live>.
const row = (delay) => ({
  layout: "position",
  initial: { opacity: 0, y: delay ? 8 : -6 },
  animate: { opacity: 1, y: 0, transition: { ...spring, delay, opacity: { duration: 0.24, delay } } },
  exit: { opacity: 0, scale: 0.985, transition: { duration: 0.18, ease: "easeIn" } },
  transition: spring,
});

// When a <Live> group mounts (data replacing the skeleton, or a tab switch), its rows stagger in
// 35ms apart, top to bottom; rows that arrive later come in at once.
const LiveBorn = createContext(0);
function useDelay(i) {
  const born = useContext(LiveBorn);
  const [delay] = useState(() => (i !== undefined && performance.now() - born < 350 ? Math.min(i, 12) * 0.035 : 0));
  return delay;
}
export const LiveLi = ({ i, ...props }) => <motion.li {...row(useDelay(i))} {...props} />;
export const LiveTr = ({ i, ...props }) => <motion.tr {...row(useDelay(i))} {...props} />;

export function Live({ children }) {
  const [born] = useState(() => performance.now());
  return (
    <LiveBorn.Provider value={born}>
      <AnimatePresence>{children}</AnimatePresence>
    </LiveBorn.Provider>
  );
}

/** Skeleton rows shaped like a list row: a short and a long bar, shimmering. */
export function SkeletonRows({ n = 4 }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="divide-y divide-line">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5">
          <span className="skeleton h-3 rounded-full" style={{ width: `${[46, 62, 38, 54, 44][i % 5]}%` }} />
          <span className="skeleton ml-auto h-3 w-14 rounded-full" />
        </div>
      ))}
    </div>
  );
}
export const Skeleton = ({ className = "" }) => <span aria-hidden className={`skeleton block rounded-md ${className}`} />;

/** A number that counts up from where it was (0 the first time). */
export function CountUp({ value, format = (n) => Math.round(n).toLocaleString("en-PH") }) {
  const reduce = useReducedMotion();
  const from = useRef(0);
  const [shown, setShown] = useState(reduce ? value : 0);
  useEffect(() => {
    if (reduce) return setShown(value);
    const controls = animate(from.current, value, { duration: 0.9, ease: [0.22, 1, 0.36, 1], onUpdate: setShown });
    from.current = value;
    return () => controls.stop();
  }, [value, reduce]);
  return <span className="tabular-nums">{format(shown)}</span>;
}

// ── toasts: toast("Saved"), or with { action: { label: "Undo", run } } ──
let toasts = [];
const subs = new Set();
const emit = () => subs.forEach((s) => s(toasts));
const dismiss = (id) => {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
};
// error: true shows it in red and leaves it up longer, so a failure doesn't read as a success
export function toast(text, { action, error = false, ms = error ? 8000 : 4000 } = {}) {
  const t = { id: Date.now() + Math.random(), text, action, error };
  toasts = [...toasts.slice(-2), t];
  emit();
  setTimeout(() => dismiss(t.id), ms);
}

export function Toaster() {
  const [list, setList] = useState(toasts);
  const ref = useRef(null);
  useEffect(() => {
    subs.add(setList);
    return () => void subs.delete(setList);
  }, []);
  // a popover joins the top layer, so toasts show above an open <dialog>
  useEffect(() => {
    const el = ref.current;
    if (!el?.showPopover) return;
    if (el.matches(":popover-open")) el.hidePopover();
    el.showPopover();
  }, [list.length]);
  return (
    <div
      ref={ref}
      popover="manual"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-auto m-0 flex h-auto w-auto flex-col items-center gap-2 overflow-visible border-0 bg-transparent p-0 px-4"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + var(--tabbar-h, 0px) + 1rem)" }}
    >
      <AnimatePresence initial={false}>
        {list.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.16 } }}
            transition={spring}
            role={t.error ? "alert" : undefined}
            className={`pointer-events-auto flex max-w-md items-center gap-4 rounded-xl ${t.error ? "bg-danger" : "bg-navy"} py-2.5 pr-2.5 pl-4 text-sm text-cream shadow-[0_16px_40px_-12px_rgb(12_21_38/0.5)] ring-1 ring-cream/10`}
          >
            <span className="py-1">{t.text}</span>
            {t.action && (
              <button
                onClick={() => {
                  t.action.run();
                  dismiss(t.id);
                }}
                className="press min-h-10 rounded-md bg-cream/10 px-3 py-1 font-semibold text-gold hover:bg-cream/15"
              >
                {t.action.label}
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
