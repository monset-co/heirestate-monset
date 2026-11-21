// The admin's building blocks, after the Monset dashboard (dashboard-monset/src/components/ui.tsx)
// in the house's own hand: Bodoni titles, Marcellus labels, navy and gold.
import { Check, ChevronDown, X } from "lucide-react";
import { motion } from "motion/react";
import { Children, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
  // inventory statuses
  "inv-pre": "bg-emerald-600/15 text-emerald-800",
  "inv-sold": "bg-navy text-cream",
  "inv-rented": "bg-red-600/12 text-red-800",
  "inv-for-rent": "bg-orange-500/15 text-orange-800",
  "inv-assume": "bg-yellow-400/30 text-yellow-900",
  "inv-for-sale": "bg-sky-400/20 text-sky-800",
  "inv-reserved": "bg-zinc-500/15 text-zinc-700",
  "inv-unavailable": "bg-neutral-900 text-white",
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
 * The admin's own "are you sure?", in place of the browser's confirm():
 *   if (!(await ask({ title: "Delete this file?", body: "It can't be undone.", yes: "Delete", danger: true }))) return;
 * Rendered by <Confirmer /> (once, in Shell). Esc, Cancel and the backdrop all answer no; a
 * dangerous question starts on Cancel. With `input: { placeholder }` it asks for a line of text
 * and answers with it (or false).
 */
let asking = null;
const askSubs = new Set();
export function ask(q) {
  return new Promise((resolve) => {
    asking?.resolve(false);
    asking = { ...q, resolve };
    askSubs.forEach((s) => s(asking));
  });
}
export function Confirmer() {
  const [q, setQ] = useState(null);
  const [text, setText] = useState("");
  useEffect(() => {
    askSubs.add((next) => (setText(""), setQ(next)));
    return () => askSubs.clear();
  }, []);
  const answer = (yes) => {
    q?.resolve(yes && q.input ? text.trim() || false : yes);
    asking = null;
    setQ(null);
  };
  return (
    <Modal open={!!q} onClose={() => answer(false)} title={q?.title ?? ""}>
      {q && (
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            answer(true);
          }}
        >
          {q.body && <p className="text-sm text-charcoal">{q.body}</p>}
          {q.input && <input autoFocus required value={text} onChange={(e) => setText(e.target.value)} maxLength={300} placeholder={q.input.placeholder} className={input} />}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" autoFocus={q.danger} className={btnGhost} onClick={() => answer(false)}>{q.no ?? "Cancel"}</button>
            <button autoFocus={!q.danger && !q.input} className={q.danger ? `${btn} bg-danger hover:bg-danger/90` : btn}>{q.yes ?? "OK"}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

/**
 * A drop-in for <select> (same value, onChange(e.target.value), <option>, <optgroup>). It opens a
 * menu that grows from its trigger (the motion is .menu in admin.css): a
 * popover in the top layer, so Esc and clicking away close it and nothing clips it, the same on
 * phones. The highlight glides from option to option.
 * `multiple`: value is an array, each pick toggles and the menu stays open; `placeholder` shows
 * while nothing is picked.
 */
const textOf = (children) => Children.toArray(children).join("");
function optionsOf(children, group) {
  return Children.toArray(children).flatMap((el) =>
    el.type === "optgroup"
      ? optionsOf(el.props.children, el.props.label)
      : el.type === "option"
        ? [{ value: String(el.props.value ?? textOf(el.props.children)), label: textOf(el.props.children), disabled: !!el.props.disabled, group }]
        : []
  );
}

export function Select({ value, onChange, children, className = "", disabled, required, multiple, placeholder = "", ...aria }) {
  const options = optionsOf(children);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const button = useRef(null);
  const list = useRef(null);
  const typed = useRef({ text: "", at: 0 });
  const closedAt = useRef(0); // a click on the trigger first light-dismisses the open menu; that click must not reopen it
  const id = useId();
  const picked = multiple ? -1 : options.findIndex((o) => o.value === String(value ?? ""));
  const isPicked = (o, i) => (multiple ? (value ?? []).includes(o.value) : i === picked);
  const shown = multiple ? options.filter((o) => value?.includes(o.value)).map((o) => o.label).join(", ") : options[picked]?.label;

  // the menu lives in the dialog it was opened from (outside an open modal everything is inert), else in <body>
  const [host, setHost] = useState(null);
  useLayoutEffect(() => setHost(button.current?.closest("dialog") ?? document.body), []);

  const choose = (i) => {
    const o = options[i];
    if (!o || o.disabled) return;
    if (multiple) {
      const now = value ?? [];
      return onChange?.({ target: { value: now.includes(o.value) ? now.filter((v) => v !== o.value) : options.filter((x) => x.value === o.value || now.includes(x.value)).map((x) => x.value) } });
    }
    if (o.value !== String(value ?? "")) onChange?.({ target: { value: o.value } });
    list.current?.hidePopover();
    button.current?.focus();
  };

  function show(at = picked) {
    const menu = list.current;
    if (!menu || disabled) return;
    const r = button.current.getBoundingClientRect();
    const height = Math.min(options.length * 36 + 12, 288);
    const up = innerHeight - r.bottom < height + 8 && r.top > innerHeight - r.bottom;
    Object.assign(menu.style, {
      left: `${Math.max(8, Math.min(r.left, innerWidth - Math.max(r.width, 176) - 8))}px`,
      minWidth: `${r.width}px`,
      top: up ? "auto" : `${r.bottom + 6}px`,
      bottom: up ? `${innerHeight - r.top + 6}px` : "auto",
    });
    menu.dataset.side = up ? "top" : "bottom";
    setActive(at >= 0 ? at : options.findIndex((o) => !o.disabled));
    menu.showPopover();
    menu.focus({ preventScroll: true });
  }

  // a scroll or resize outside the menu would leave it floating in the wrong place: close it, as <select> does
  useEffect(() => {
    if (!open) return;
    const close = (e) => !list.current?.contains(e.target) && list.current?.hidePopover();
    addEventListener("scroll", close, true);
    addEventListener("resize", close);
    return () => {
      removeEventListener("scroll", close, true);
      removeEventListener("resize", close);
    };
  }, [open]);

  useEffect(() => {
    if (open && active >= 0) list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function move(from, step) {
    for (let i = from + step; i >= 0 && i < options.length; i += step) if (!options[i].disabled) return i;
    return from;
  }

  function onKey(e) {
    const k = e.key;
    if (k === "ArrowDown" || k === "ArrowUp") setActive((a) => move(a, k === "ArrowDown" ? 1 : -1));
    else if (k === "Home") setActive(move(-1, 1));
    else if (k === "End") setActive(move(options.length, -1));
    else if (k === "Enter" || k === " ") choose(active);
    else if (k === "Tab") list.current?.hidePopover();
    else if (k.length === 1) {
      // type to jump, as in a native select
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : "") + k.toLowerCase(), at: now };
      const hit = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(typed.current.text));
      if (hit >= 0) setActive(hit);
      return;
    } else return;
    e.preventDefault();
  }

  return (
    <span className="relative block">
      <button
        ref={button}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        id={`${id}-button`}
        {...aria}
        onClick={() => (open ? list.current?.hidePopover() : performance.now() - closedAt.current > 250 && show())}
        onKeyDown={(e) => {
          if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
            e.preventDefault();
            show();
          }
        }}
        className={`${className} group flex items-center justify-between gap-2 text-left`}
      >
        <span className={`truncate ${shown ? "" : "text-muted"}`}>{shown || placeholder || " "}</span>
        {multiple && value?.length > 1 && <span className="shrink-0 rounded-full bg-navy px-1.5 text-xs font-medium text-cream tabular-nums">{value.length}</span>}
        <ChevronDown aria-hidden className={`size-4 shrink-0 text-muted transition-transform duration-200 ease-[var(--ease-out)] ${open ? "rotate-180" : ""}`} />
      </button>
      {/* keeps the form's own "please choose" check */}
      {required && <select tabIndex={-1} aria-hidden required value={value} onChange={() => {}} className="pointer-events-none absolute inset-x-0 bottom-0 h-px opacity-0">{children}</select>}
      {host &&
        createPortal(
          <ul
            ref={list}
            id={id}
            popover="auto"
            role="listbox"
            tabIndex={-1}
            aria-label={aria["aria-label"]}
            aria-labelledby={aria["aria-label"] ? undefined : aria.id ?? `${id}-button`}
            aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
            aria-multiselectable={multiple || undefined}
            onToggle={(e) => {
              setOpen(e.newState === "open");
              if (e.newState === "closed") closedAt.current = performance.now();
              if (e.newState === "closed" && document.activeElement === list.current) button.current?.focus();
            }}
            onKeyDown={onKey}
            className="menu max-h-72 max-w-[min(24rem,calc(100vw-1rem))] overflow-y-auto rounded-lg border border-line bg-surface p-1 text-sm text-fg shadow-[0_12px_32px_-8px_rgb(12_21_38/0.28),0_2px_6px_rgb(12_21_38/0.06)] outline-none"
          >
            {options.map((o, i) => (
              <li key={i} role="presentation">
                {o.group && o.group !== options[i - 1]?.group && <p className="label px-2.5 pt-2 pb-1 text-muted">{o.group}</p>}
                <div
                  id={`${id}-${i}`}
                  data-i={i}
                  role="option"
                  aria-selected={isPicked(o, i)}
                  aria-disabled={o.disabled || undefined}
                  onPointerMove={() => !o.disabled && active !== i && setActive(i)}
                  onClick={() => choose(i)}
                  className={`relative flex cursor-default items-center gap-2 rounded-md px-2.5 py-2 select-none ${o.disabled ? "opacity-45" : ""} ${isPicked(o, i) ? "font-medium text-ink" : ""}`}
                >
                  {i === active && <motion.span layoutId={`${id}-hl`} transition={{ type: "spring", stiffness: 700, damping: 45 }} className="absolute inset-0 rounded-md bg-sunken" />}
                  <span className="relative min-w-0 flex-1 truncate">{o.label || " "}</span>
                  <Check aria-hidden className={`relative size-4 shrink-0 text-gold-ink ${isPicked(o, i) ? "" : "invisible"}`} />
                </div>
              </li>
            ))}
          </ul>,
          host
        )}
    </span>
  );
}

/**
 * The dashboard's tab bar (from Kokonut UI smooth-tab, MIT): a copy of the labels in the active
 * colours is clipped to the selected tab, and the clip moves like a worm: the leading edge leaves
 * first and the trailing edge catches up. Only the active panel mounts; the caller renders it.
 */
/** What a tab shows: give it key={the tab} and each switch fades the new content up into place. */
export function TabPanel({ children, className }) {
  return (
    <motion.div initial={{ opacity: 0, transform: "translateY(8px)" }} animate={{ opacity: 1, transform: "translateY(0px)" }} transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }} className={className}>
      {children}
    </motion.div>
  );
}

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
