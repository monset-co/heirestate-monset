// A lead's notes as sticky notes, after the dashboard's task board (dashboard-monset/src/pages/tasks/
// TaskKanban.tsx): tear a note off the pad in the corner and drop it on the wall, or tap the pad;
// drag a note into the bin to throw it away (with Undo). Pinned notes show above every tab.
import { Pin, PinOff, Plus, Trash2 } from "lucide-react";
import { animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";
import { supabase, run } from "../supabase";
import { Live, LiveLi, SkeletonRows, spring, toast } from "../motion";
import { ErrorNote } from "../ui";
import { when } from "../crm";

export const NOTE = "id, body, author_email, created_at, pinned, color";
const COLORS = ["yellow", "pink", "blue", "green"];
const TILT = [-1.2, 0.8, -0.4, 1.4];
const tool = "press rounded p-1.5 opacity-60 hover:bg-black/5 hover:opacity-100";
const next = (c) => COLORS[(COLORS.indexOf(c) + 1) % COLORS.length];
// is a drag's page point over this element?
const over = (el, { x, y }) => {
  const r = el?.getBoundingClientRect();
  return !!r && x - scrollX >= r.left && x - scrollX <= r.right && y - scrollY >= r.top && y - scrollY <= r.bottom;
};

// the pinned notes, above the tabs on every tab: "OFW in Dubai, call after 9pm", "spouse co-borrows"
export function Pinned({ notes, onOpen }) {
  const pinned = notes?.filter((n) => n.pinned) ?? [];
  if (!pinned.length) return null;
  return (
    <section aria-label="Pinned notes" className="mt-5 flex gap-4 overflow-x-auto px-1 pt-3 pb-2">
      {pinned.map((n) => (
        <button key={n.id} type="button" onClick={onOpen} style={{ rotate: `${TILT[n.id % 4]}deg` }} className={`sticky-note sticky-${n.color} w-56 shrink-0 rounded-sm p-4 text-left text-sm transition-[rotate] duration-200 ease-out hover:!rotate-0`}>
          <span aria-hidden className="sticky-tape" />
          <p className="line-clamp-4 whitespace-pre-wrap">{n.body}</p>
          <p className="mt-2 text-[0.7rem] opacity-60">{n.author_email?.split("@")[0]} · {when(n.created_at)}</p>
        </button>
      ))}
    </section>
  );
}

export function Notes({ leadId, notes, setNotes }) {
  const [draft, setDraft] = useState(null); // { from } while a new note is being written
  const [hover, setHover] = useState(null); // "bin" or "wall" while something is dragged over it
  const [error, setError] = useState("");
  const wall = useRef(null);
  const bin = useRef(null);

  async function add(fields) {
    const n = await run(supabase.from("lead_notes").insert({ lead_id: leadId, ...fields }).select(NOTE).single());
    setNotes((ns) => [n, ...ns]);
    setDraft(null);
    toast(n.pinned ? "Pinned to the top of the lead" : "Stuck on the wall");
  }

  async function change(n, patch) {
    setNotes((ns) => ns.map((x) => (x.id === n.id ? { ...x, ...patch } : x)));
    try {
      await run(supabase.from("lead_notes").update(patch).eq("id", n.id));
    } catch (err) {
      setNotes((ns) => ns.map((x) => (x.id === n.id ? n : x)));
      setError(err.message);
    }
  }

  // binned at once; Undo puts the same note back, with its author and date
  async function throwAway(n) {
    setNotes((ns) => ns.filter((x) => x.id !== n.id));
    try {
      await run(supabase.from("lead_notes").delete().eq("id", n.id));
      const { id, ...rest } = n;
      toast("Note in the bin", {
        ms: 6000,
        action: {
          label: "Undo",
          run: () =>
            run(supabase.from("lead_notes").insert({ lead_id: leadId, ...rest }).select(NOTE).single()).then(
              (back) => setNotes((ns) => [back, ...ns].sort((a, b) => b.created_at.localeCompare(a.created_at))),
              (err) => setError(err.message)
            ),
        },
      });
    } catch (err) {
      setNotes((ns) => [n, ...ns]);
      setError(err.message);
    }
  }

  const sorted = notes && [...notes].sort((a, b) => b.pinned - a.pinned);
  return (
    <div className="grid max-w-5xl gap-6">
      <ErrorNote error={error} />
      <ul ref={wall} className={`grid min-h-64 gap-6 rounded-xl p-1 transition-colors duration-150 [grid-template-columns:repeat(auto-fill,minmax(14rem,1fr))] ${hover === "wall" ? "bg-gold/10 ring-2 ring-gold/50" : ""}`}>
        {draft && (
          <li className="relative z-10">
            <Draft from={draft.from} onSave={add} onCancel={() => setDraft(null)} />
          </li>
        )}
        {!sorted ? (
          <li><SkeletonRows n={2} /></li>
        ) : (
          <Live>
            {sorted.map((n, i) => (
              <LiveLi key={n.id} i={i}>
                <Note
                  n={n}
                  onDrag={(p) => setHover(over(bin.current, p) ? "bin" : null)}
                  onRelease={(p) => {
                    setHover(null);
                    return over(bin.current, p) && bin.current.getBoundingClientRect();
                  }}
                  onBinned={() => throwAway(n)}
                  onChange={(patch) => change(n, patch)}
                />
              </LiveLi>
            ))}
          </Live>
        )}
        {sorted && !sorted.length && !draft && <li className="col-span-full self-center text-center text-sm text-muted">No notes yet. Tear one off the pad in the corner and drop it here.</li>}
      </ul>

      <div className="fixed right-4 z-20 flex items-end gap-4 bottom-[calc(var(--tabbar-h,0px)+env(safe-area-inset-bottom)+1rem)] md:right-6 md:bottom-6">
        <motion.div
          ref={bin}
          aria-hidden
          animate={{ scale: hover === "bin" ? 1.12 : 1 }}
          transition={spring}
          className={`grid size-16 place-items-center rounded-xl border-2 border-dashed text-[0.6875rem] font-semibold transition-colors duration-150 ${hover === "bin" ? "border-danger bg-danger/10 text-danger" : "border-line bg-surface/90 text-muted backdrop-blur"}`}
        >
          <span className="grid justify-items-center gap-0.5">
            <Trash2 className="size-5" />
            Bin
          </span>
        </motion.div>
        <Pad
          onDrag={(p) => setHover(over(wall.current, p) ? "wall" : null)}
          onDrop={(p) => {
            setHover(null);
            if (!over(wall.current, p)) return false;
            setDraft({ from: p });
            return true;
          }}
          onTap={() => setDraft({})}
        />
      </div>
    </div>
  );
}

/** The pad pinned to the corner: tear the top note off and drop it on the wall, or tap it. */
function Pad({ onDrag, onDrop, onTap }) {
  const [sheet, setSheet] = useState(0); // a fresh top sheet after each one is torn off
  const dragged = useRef(false); // the pointer-up that ends a drag isn't a tap
  return (
    <div className="relative">
      <div aria-hidden className="sticky-yellow absolute inset-0 translate-x-1.5 translate-y-1.5 rotate-3 rounded-sm opacity-70" />
      <div aria-hidden className="sticky-yellow absolute inset-0 translate-x-0.5 translate-y-0.5 -rotate-2 rounded-sm opacity-85" />
      <motion.button
        key={sheet}
        type="button"
        drag
        dragSnapToOrigin
        dragElastic={1}
        initial={sheet ? { opacity: 0, scale: 0.94, y: 4 } : false}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        whileHover={{ rotate: -2, y: -2 }}
        whileDrag={{ scale: 1.08, rotate: -5, cursor: "grabbing", boxShadow: "0 18px 30px -12px rgb(12 21 38 / 0.45)" }}
        onPointerDown={() => (dragged.current = false)}
        onDragStart={() => (dragged.current = true)}
        onDrag={(_, i) => onDrag(i.point)}
        onDragEnd={(_, i) => onDrop(i.point) && setSheet((s) => s + 1)}
        onTap={() => !dragged.current && onTap()}
        title="Drag onto the wall, or click to write a note"
        aria-label="New note"
        className="sticky-note sticky-yellow relative grid size-20 cursor-grab touch-none place-items-center rounded-sm text-center text-[0.6875rem] leading-tight font-semibold"
      >
        <span>
          <Plus className="mx-auto mb-0.5 size-5" aria-hidden />
          Drag a note
        </span>
      </motion.button>
    </div>
  );
}

/** A blank note being written. Dropped from the pad, it flies from where it was let go and slaps into place. */
function Draft({ from, onSave, onCancel }) {
  const [f, setF] = useState({ body: "", color: "yellow", pinned: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const form = useRef(null);
  const reduce = useReducedMotion();

  useLayoutEffect(() => {
    const el = form.current;
    el.querySelector("textarea").focus({ preventScroll: !!from });
    const r = el.getBoundingClientRect();
    if (from && !reduce)
      animate(el, { x: [from.x - scrollX - (r.left + r.width / 2), 0], y: [from.y - scrollY - (r.top + r.height / 2), 0], scale: [0.45, 1.04, 1], rotate: [-8, 1, 0] }, { duration: 0.42, ease: [0.23, 1, 0.32, 1] });
    else animate(el, { opacity: [0, 1], scale: [0.92, 1] }, { duration: 0.18 });
  }, [from, reduce]);

  async function submit(e) {
    e?.preventDefault();
    if (!f.body.trim()) return;
    setBusy(true);
    setError("");
    try {
      await onSave({ ...f, body: f.body.trim() });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form
      ref={form}
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
        if (e.key === "Enter" && !e.shiftKey && e.target.tagName === "TEXTAREA") {
          e.preventDefault();
          submit();
        }
      }}
      className={`sticky-note sticky-${f.color} grid gap-3 rounded-sm p-4`}
    >
      <label>
        <span className="sr-only">New note</span>
        <textarea
          value={f.body}
          onChange={(e) => setF({ ...f, body: e.target.value })}
          rows={5}
          maxLength={4000}
          placeholder="What matters about them: who decides, when to call, what they're waiting for…"
          className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-fg/45"
        />
      </label>
      {error && <ErrorNote error={error} />}
      <div className="flex items-center gap-1.5">
        {COLORS.map((c) => (
          <button key={c} type="button" onClick={() => setF({ ...f, color: c })} aria-label={`${c} note`} aria-pressed={f.color === c} className={`sticky-${c} size-5 rounded-full border border-black/15 ${f.color === c ? "ring-2 ring-navy ring-offset-1" : ""}`} />
        ))}
        <button type="button" onClick={() => setF({ ...f, pinned: !f.pinned })} aria-pressed={f.pinned} className={`${tool} ml-auto ${f.pinned ? "opacity-100" : ""}`} title="Pin to the top of the lead">
          <Pin className={`size-4 ${f.pinned ? "fill-current" : ""}`} aria-hidden />
          <span className="sr-only">Pin</span>
        </button>
      </div>
      <div className="flex justify-end gap-1.5">
        <button type="button" onClick={onCancel} className="rounded px-2.5 py-1.5 text-xs font-semibold opacity-70 hover:bg-black/5">Cancel</button>
        <button className="press rounded bg-navy px-3 py-1.5 text-xs font-semibold text-cream disabled:opacity-50" disabled={busy || !f.body.trim()}>
          {busy ? "Sticking…" : "Stick it"}
        </button>
      </div>
    </form>
  );
}

/** A note on the wall. Drag it to the bin and it flies in from where it was let go; anywhere else it springs back. */
function Note({ n, onDrag, onRelease, onBinned, onChange }) {
  const tilt = TILT[n.id % 4];
  const ref = useRef(null);
  const [lifted, setLifted] = useState(false);
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const scale = useMotionValue(1);
  const rotate = useMotionValue(tilt);
  const opacity = useMotionValue(1);

  async function release(info) {
    const b = onRelease(info.point);
    if (b) {
      const r = ref.current.getBoundingClientRect();
      const fly = { duration: reduce ? 0 : 0.34, ease: [0.55, 0, 0.75, 0.2] };
      await Promise.all([
        animate(x, x.get() + b.left + b.width / 2 - (r.left + r.width / 2), fly),
        animate(y, y.get() + b.top + b.height / 2 - (r.top + r.height / 2), fly),
        animate(scale, 0.12, fly),
        animate(rotate, 24, fly),
        animate(opacity, 0, fly),
      ]);
      onBinned();
    } else {
      setLifted(false);
      animate(x, 0, spring);
      animate(y, 0, spring);
      animate(scale, 1, spring);
      animate(rotate, tilt, spring);
    }
  }

  return (
    <motion.div
      ref={ref}
      drag
      dragMomentum={false}
      onDragStart={() => {
        setLifted(true);
        animate(scale, 1.05, spring);
        animate(rotate, 3, spring);
      }}
      onDrag={(_, i) => onDrag(i.point)}
      onDragEnd={(_, i) => release(i)}
      style={{ x, y, scale, rotate, opacity }}
      className={`sticky-note sticky-${n.color} relative flex h-full cursor-grab touch-none flex-col rounded-sm p-4 text-sm active:cursor-grabbing ${lifted ? "z-40 shadow-[0_18px_30px_-12px_rgb(12_21_38/0.45)]" : ""}`}
    >
      {n.pinned && <span aria-hidden className="sticky-tape" />}
      <p className="flex-1 whitespace-pre-wrap break-words">{n.body}</p>
      <p className="mt-3 text-[0.7rem] opacity-60">
        {n.author_email?.split("@")[0]} · <time dateTime={n.created_at}>{when(n.created_at)}</time>
      </p>
      <div className="mt-2 flex items-center gap-1 border-t border-black/10 pt-2">
        <button type="button" onClick={() => onChange({ color: next(n.color) })} className={tool} aria-label="Change colour">
          <span className={`sticky-${next(n.color)} block size-4 rounded-full border border-black/20`} />
        </button>
        <button type="button" onClick={() => onChange({ pinned: !n.pinned })} className={tool} aria-label={n.pinned ? "Unpin" : "Pin to the top of the lead"}>
          {n.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
        </button>
        {/* the bin, for keyboards and screen readers */}
        <button type="button" onClick={onBinned} className={`${tool} ml-auto`} aria-label="Throw away note">
          <Trash2 className="size-4" />
        </button>
      </div>
    </motion.div>
  );
}
