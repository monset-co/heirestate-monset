// The admin's building blocks, after the Monset dashboard (dashboard-monset/src/components/ui.tsx)
// in the house's own hand: Bodoni titles, Marcellus labels, navy and gold.
import { X } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export const input =
  "w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted/80 outline-none transition-[border-color,box-shadow] duration-150 focus:border-accent focus:ring-3 focus:ring-accent/25 disabled:opacity-60";
export const btn =
  "press inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-navy px-4 py-2 text-sm font-semibold text-cream hover:bg-navy-raised disabled:opacity-50";
export const btnGhost =
  "press inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-line bg-surface px-3.5 py-2 text-sm font-medium text-fg hover:border-muted/50 disabled:opacity-50";
export const btnDanger =
  "press inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-danger hover:bg-danger/10 disabled:opacity-50";
export const card = "rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgb(20_33_58/0.04),0_6px_20px_-12px_rgb(20_33_58/0.14)]";
export const th = "label px-4 py-3 text-left font-normal text-muted";

export function PageHeader({ title, sub, children }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto font-display text-[2.1rem] leading-tight tracking-[-0.01em] text-ink">{title}</h1>
        {children}
      </div>
      {sub && <p className="mt-1.5 max-w-prose text-sm text-muted">{sub}</p>}
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="block text-sm">
      <span className="label mb-1.5 block text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function ErrorNote({ error }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-md border border-danger/30 bg-danger/8 px-3 py-2.5 text-sm text-danger">
      {error}
    </p>
  );
}

export const Empty = ({ children }) => <p className="px-6 py-10 text-center text-sm text-muted">{children}</p>;

const tone = {
  available: "bg-emerald-600/12 text-emerald-800",
  reserved: "bg-gold/20 text-gold-ink",
  sold: "bg-burgundy/12 text-burgundy",
  hidden: "bg-sunken text-muted",
  published: "bg-navy text-cream",
  draft: "bg-sunken text-muted",
  // lead stages
  new: "bg-gold/25 text-gold-ink",
  contacted: "bg-sky-600/12 text-sky-800",
  viewing: "bg-violet-600/12 text-violet-800",
  closed: "bg-emerald-600/12 text-emerald-800",
  lost: "bg-sunken text-muted",
  // how warm a lead is
  hot: "bg-burgundy/12 text-burgundy",
  warm: "bg-gold/25 text-gold-ink",
  cold: "bg-sky-600/12 text-sky-800",
};
export function Badge({ value, children }) {
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${tone[value] ?? "bg-sunken text-muted"}`}>
      {children ?? value.charAt(0).toUpperCase() + value.slice(1)}
    </span>
  );
}

/** Native <dialog>: Esc, focus trap and top layer for free; its motion lives in admin.css. */
export function Modal({ open, onClose, title, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="modal m-auto w-[min(38rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0 text-fg shadow-[0_24px_48px_-12px_rgb(12_21_38/0.35)]"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h2 className="font-display text-xl text-ink">{title}</h2>
        <button onClick={onClose} className="press rounded-md p-1.5 text-muted hover:bg-sunken hover:text-fg" aria-label="Close">
          <X className="size-4" />
        </button>
      </div>
      <div className="max-h-[78dvh] overflow-y-auto p-5">{open && children}</div>
    </dialog>
  );
}

/**
 * The dashboard's tab bar (from Kokonut UI smooth-tab, MIT): a copy of the labels in the active
 * colours is clipped to the selected tab, and the clip moves like a worm: the leading edge leaves
 * first and the trailing edge catches up. Only the active panel mounts; the caller renders it.
 */
export function Tabs({ items, value, onChange, label }) {
  const listRef = useRef(null);
  const tabRefs = useRef([]);
  const [box, setBox] = useState(null);
  const index = Math.max(items.findIndex((i) => i.id === value), 0);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const tab = tabRefs.current[index];
      if (!tab) return;
      const next = { t: tab.offsetTop, l: tab.offsetLeft, r: list.clientWidth - tab.offsetLeft - tab.offsetWidth, b: list.clientHeight - tab.offsetTop - tab.offsetHeight };
      setBox((prev) => ({ ...next, dir: prev && next.l < prev.l ? -1 : 1 }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    document.fonts.ready.then(measure).catch(() => undefined);
    return () => ro.disconnect();
  }, [index, items.length]);

  function onKey(e, i) {
    const next = { ArrowRight: (i + 1) % items.length, ArrowLeft: (i - 1 + items.length) % items.length, Home: 0, End: items.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    tabRefs.current[next]?.focus();
    onChange(items[next].id);
  }

  const lead = { type: "spring", stiffness: 520, damping: 40 };
  const trail = { type: "spring", stiffness: 300, damping: 34, delay: 0.06 };
  const tabCls = "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[5px] px-3.5 py-1.5 text-sm font-semibold";
  return (
    <div className="max-w-full overflow-x-auto">
      <div ref={listRef} role="tablist" aria-label={label} className="relative inline-flex rounded-md border border-line bg-sunken p-1">
        {items.map((item, i) => (
          <button
            key={item.id}
            ref={(el) => (tabRefs.current[i] = el)}
            role="tab"
            type="button"
            aria-selected={i === index}
            tabIndex={i === index ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={`${tabCls} text-muted transition-colors duration-150 hover:text-fg`}
          >
            {item.title}
          </button>
        ))}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex bg-navy p-1"
          // starts as a sliver at the left edge, so Motion has a value to animate each edge from
          initial={{ "--t": "4px", "--b": "4px", "--l": "4px", "--r": "100%" }}
          animate={box ? { "--t": `${box.t}px`, "--b": `${box.b}px`, "--l": `${box.l}px`, "--r": `${box.r}px` } : undefined}
          transition={box?.dir === -1 ? { "--l": lead, "--r": trail, default: lead } : { "--r": lead, "--l": trail, default: lead }}
          style={{ clipPath: "inset(var(--t) var(--r) var(--b) var(--l) round 5px)" }}
        >
          {items.map((item) => (
            <span key={item.id} className={`${tabCls} text-cream`}>
              {item.title}
            </span>
          ))}
        </motion.div>
      </div>
    </div>
  );
}
