// The Notes board, after dashboard-monset's task board (src/pages/tasks/TaskKanban.tsx): a column of
// sticky notes per person. "My notes" is private to whoever is signed in (the database keeps it so):
// reminders, a listing seen on Facebook, a number to call back. Every other column is the team's: a
// note there is a task for that person, "Anyone" holds what's up for grabs. Tear a note off the pad
// onto a column, or drag a note from one column to another to hand it over; into the bin to throw it out.
import { Check, Flag, Lock, Trash2, UserRound } from "lucide-react";
import { animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { supabase, run } from "../supabase";
import { useMe } from "../me";
import { api } from "../api";
import { Live, LiveLi, SkeletonRows, spring, toast } from "../motion";
import { ErrorNote, PageHeader, Select, ask, input } from "../ui";
import { Pad, over } from "./StickyNotes";

const TASK = "id, body, color, private, assignee, due_on, urgent, done_at, lead_id, created_by, created_at, lead:leads(id, name)";
const COLORS = ["yellow", "pink", "blue", "green"];
const TILT = [-1.2, 0.8, -0.4, 1.4];
const MINE = "#mine";
const ANYONE = "#anyone";
const tool = "press rounded p-1.5 opacity-60 hover:bg-black/5 hover:opacity-100";
const today = () => new Date().toLocaleDateString("en-CA"); // yyyy-mm-dd, local
const day = new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric" });
const URL_RE = /(https?:\/\/[^\s]+)/g;

// which column a note sits in
const columnOf = (t) => (t.private ? MINE : t.assignee ?? ANYONE);
// what a note becomes when dropped in a column
const placeIn = (col) => (col === MINE ? { private: true, assignee: null } : { private: false, assignee: col === ANYONE ? null : col });

export default function Notes() {
  const me = useMe();
  const [tasks, setTasks] = useState(null);
  const [people, setPeople] = useState([]);
  const [leads, setLeads] = useState([]);
  const [draft, setDraft] = useState(null); // { col, from } while a new note is being written
  const [hover, setHover] = useState(null); // the column (or "bin") something is dragged over
  const [error, setError] = useState("");
  const cols = useRef({});
  const bin = useRef(null);

  useEffect(() => {
    Promise.all([
      run(supabase.from("tasks").select(TASK).order("created_at", { ascending: false })),
      run(supabase.from("admin_users").select("email, name").eq("active", true).order("name")),
      run(supabase.from("leads").select("id, name").order("name")),
    ]).then(([t, p, l]) => (setTasks(t), setPeople(p), setLeads(l)), (e) => setError(e.message));
  }, []);

  const columns = [
    { key: MINE, name: "My notes", hint: "Only you can see these" },
    ...[...people].sort((a, b) => (b.email === me?.email) - (a.email === me?.email)).map((p) => ({ key: p.email, name: p.email === me?.email ? `${p.name} (me)` : p.name, hint: "Tasks for them" })),
    { key: ANYONE, name: "Anyone", hint: "Up for grabs" },
  ];
  const colAt = (p) => columns.find((c) => over(cols.current[c.key], p))?.key ?? null;
  const dragOver = (p) => setHover(over(bin.current, p) ? "bin" : colAt(p));

  async function add(fields) {
    const t = await run(supabase.from("tasks").insert({ ...fields, ...placeIn(draft.col) }).select(TASK).single());
    setTasks((ts) => [t, ...ts]);
    setDraft(null);
    tell(t);
    toast(t.private ? "Kept in your notes" : t.assignee && t.assignee !== me?.email ? "Task given" : "Stuck on the board");
  }

  // a task given to someone else: a push notification to them (the Worker checks it's really so)
  const tell = (t) => t.assignee && t.assignee !== me?.email && api("push/task", { id: t.id }).catch(() => undefined);

  async function change(t, patch) {
    setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, ...patch } : x)));
    try {
      await run(supabase.from("tasks").update(patch).eq("id", t.id));
    } catch (err) {
      setTasks((ts) => ts.map((x) => (x.id === t.id ? t : x)));
      setError(err.message);
    }
  }

  // dropped on another column: hand it over (or keep it private, if it's yours)
  async function move(t, col) {
    if (!col || col === columnOf(t)) return;
    if (col === MINE && t.created_by !== me?.email) return toast("Only notes you wrote can go in your private notes");
    const who = columns.find((c) => c.key === col)?.name;
    if (t.private && !(await ask({ title: `Share this note with ${col === ANYONE ? "the team" : who}?`, body: "It leaves your private notes, and everyone on the team can see it.", yes: "Share it" }))) return;
    await change(t, placeIn(col));
    tell({ ...t, ...placeIn(col) });
    toast(col === MINE ? "Moved to your notes" : col === ANYONE ? "Up for grabs" : `Given to ${who}`);
  }

  // binned at once; Undo puts the same note back
  async function throwAway(t) {
    setTasks((ts) => ts.filter((x) => x.id !== t.id));
    try {
      await run(supabase.from("tasks").delete().eq("id", t.id));
      const { id, lead, ...rest } = t;
      toast("Note in the bin", {
        ms: 6000,
        action: {
          label: "Undo",
          run: () =>
            run(supabase.from("tasks").insert(rest).select(TASK).single()).then(
              (back) => setTasks((ts) => [back, ...ts].sort((a, b) => b.created_at.localeCompare(a.created_at))),
              (err) => setError(err.message)
            ),
        },
      });
    } catch (err) {
      setTasks((ts) => [t, ...ts]);
      setError(err.message);
    }
  }

  return (
    <div className="grid gap-6">
      <PageHeader title="Notes" sub="Your private notes, and a column of tasks for each of the team. Drag a note onto someone to give it to them." />
      <ErrorNote error={error} />
      {/* ponytail: columns wrap instead of scrolling sideways, so a dragged note is never clipped */}
      <div className="grid items-start gap-5 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
        {columns.map((c) => {
          const notes = tasks?.filter((t) => columnOf(t) === c.key).sort((a, b) => !!a.done_at - !!b.done_at || b.urgent - a.urgent) ?? [];
          return (
            <section
              key={c.key}
              ref={(el) => (cols.current[c.key] = el)}
              aria-label={c.name}
              className={`grid min-h-48 content-start gap-4 rounded-xl border p-3 transition-colors duration-150 ${hover === c.key ? "border-gold/60 bg-gold/10" : c.key === MINE ? "border-dashed border-line bg-sunken/50" : "border-line bg-surface/60"}`}
            >
              <header className="flex items-center gap-2">
                {c.key === MINE ? <Lock className="size-4 text-muted" aria-hidden /> : <UserRound className="size-4 text-muted" aria-hidden />}
                <h2 className="font-semibold text-ink">{c.name}</h2>
                <span className="text-xs text-muted tabular-nums">{notes.filter((t) => !t.done_at).length || ""}</span>
                <button type="button" onClick={() => setDraft({ col: c.key })} className="press ml-auto rounded-md px-2 py-0.5 text-lg leading-none text-muted hover:bg-sunken hover:text-ink" aria-label={`New note in ${c.name}`}>
                  +
                </button>
              </header>
              <p className="-mt-3 text-xs text-muted">{c.hint}</p>
              {draft?.col === c.key && <Draft from={draft.from} leads={leads} onSave={add} onCancel={() => setDraft(null)} />}
              {!tasks ? (
                <SkeletonRows n={2} />
              ) : (
                <ul className="grid gap-4">
                  <Live>
                    {notes.map((t, i) => (
                      <LiveLi key={t.id} i={i}>
                        <Note
                          t={t}
                          me={me?.email}
                          people={people}
                          columns={columns}
                          onMove={(col) => move(t, col)}
                          onDrag={dragOver}
                          onRelease={(p) => {
                            setHover(null);
                            if (over(bin.current, p)) return bin.current.getBoundingClientRect();
                            move(t, colAt(p));
                            return null;
                          }}
                          onBinned={() => throwAway(t)}
                          onChange={(patch) => change(t, patch)}
                        />
                      </LiveLi>
                    ))}
                  </Live>
                </ul>
              )}
              {tasks && !notes.length && draft?.col !== c.key && <p className="py-4 text-center text-xs text-muted">Drop a note here</p>}
            </section>
          );
        })}
      </div>

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
          hint="Drag onto a column, or click to write one in your notes"
          onDrag={(p) => setHover(colAt(p))}
          onDrop={(p) => {
            setHover(null);
            const col = colAt(p);
            if (!col) return false;
            setDraft({ col, from: p });
            return true;
          }}
          onTap={() => setDraft({ col: MINE })}
        />
      </div>
    </div>
  );
}

/** A blank note being written. Dropped from the pad, it flies from where it was let go. */
function Draft({ from, leads, onSave, onCancel }) {
  const [f, setF] = useState({ body: "", color: "yellow", due_on: "", urgent: false, lead_id: "" });
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
      await onSave({ ...f, body: f.body.trim(), due_on: f.due_on || null, lead_id: f.lead_id ? Number(f.lead_id) : null });
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
      className={`sticky-note sticky-${f.color} relative z-10 grid gap-3 rounded-sm p-4`}
    >
      <label>
        <span className="sr-only">Note</span>
        <textarea
          value={f.body}
          onChange={(e) => setF({ ...f, body: e.target.value })}
          rows={4}
          maxLength={4000}
          placeholder="A reminder, a task, a listing link…"
          className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-fg/45"
        />
      </label>
      <div className="grid gap-2 text-xs">
        <label className="flex items-center gap-2">
          <span className="w-14 opacity-70">Due</span>
          <input type="date" value={f.due_on} onChange={(e) => setF({ ...f, due_on: e.target.value })} className={`${input} min-w-0 flex-1 bg-white/50 py-1 text-xs`} />
        </label>
        <label className="flex items-center gap-2">
          <span className="w-14 opacity-70">Client</span>
          <Select value={f.lead_id} onChange={(e) => setF({ ...f, lead_id: e.target.value })} placeholder="None" className={`${input} min-w-0 flex-1 bg-white/50 py-1 text-xs`} aria-label="About a client">
            <option value="">None</option>
            {leads.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </Select>
        </label>
      </div>
      {error && <ErrorNote error={error} />}
      <div className="flex items-center gap-1.5">
        {COLORS.map((c) => (
          <button key={c} type="button" onClick={() => setF({ ...f, color: c })} aria-label={`${c} note`} aria-pressed={f.color === c} className={`sticky-${c} size-5 rounded-full border border-black/15 ${f.color === c ? "ring-2 ring-navy ring-offset-1" : ""}`} />
        ))}
        <button type="button" onClick={() => setF({ ...f, urgent: !f.urgent })} aria-pressed={f.urgent} title="Urgent" className={`${tool} ml-auto ${f.urgent ? "bg-burgundy text-cream opacity-100 hover:bg-burgundy" : ""}`}>
          <Flag className="size-4" aria-hidden />
          <span className="sr-only">Urgent</span>
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

/** A note on the board. Let go over the bin and it flies in; over another column, it's handed over. */
function Note({ t, me, people, columns, onMove, onDrag, onRelease, onBinned, onChange }) {
  const tilt = TILT[t.id % 4];
  const ref = useRef(null);
  const [lifted, setLifted] = useState(false);
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const scale = useMotionValue(1);
  const rotate = useMotionValue(tilt);
  const opacity = useMotionValue(1);
  const late = !t.done_at && t.due_on && t.due_on < today();
  const from = t.created_by !== (t.assignee ?? me) && people.find((p) => p.email === t.created_by);

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
      className={`sticky-note sticky-${t.color} relative flex cursor-grab touch-none flex-col rounded-sm p-4 text-sm active:cursor-grabbing ${lifted ? "z-40 shadow-[0_18px_30px_-12px_rgb(12_21_38/0.45)]" : ""} ${t.done_at ? "opacity-60" : ""}`}
    >
      {t.urgent && !t.done_at && <span className="mb-2 inline-flex w-fit items-center gap-1 rounded bg-burgundy px-1.5 py-0.5 text-[0.65rem] font-semibold tracking-wide text-cream uppercase"><Flag className="size-3" aria-hidden /> Urgent</span>}
      <p className={`whitespace-pre-wrap break-words ${t.done_at ? "line-through" : ""}`}>
        {t.body.split(URL_RE).map((part, i) =>
          i % 2 ? (
            <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline decoration-1 underline-offset-2 hover:text-navy" onPointerDown={(e) => e.stopPropagation()}>
              {part.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)}
            </a>
          ) : (
            part
          )
        )}
      </p>
      <div className="mt-3 flex flex-wrap gap-x-2 gap-y-1 text-[0.7rem] opacity-70">
        {t.due_on && <span className={late ? "font-semibold text-burgundy opacity-100" : ""}>{late ? "Overdue · " : "Due "}{day.format(new Date(`${t.due_on}T00:00`))}</span>}
        {t.lead && (
          <Link to={`/leads/${t.lead.id}`} onPointerDown={(e) => e.stopPropagation()} className="underline underline-offset-2">
            {t.lead.name}
          </Link>
        )}
        {from && <span>from {from.name.split(" ")[0]}</span>}
      </div>
      <div className="mt-2 flex items-center gap-1 border-t border-black/10 pt-2">
        <button type="button" onClick={() => onChange({ done_at: t.done_at ? null : new Date().toISOString() })} className={`${tool} ${t.done_at ? "opacity-100" : ""}`} aria-label={t.done_at ? "Not done" : "Done"} aria-pressed={!!t.done_at}>
          <Check className="size-4" />
        </button>
        <button type="button" onClick={() => onChange({ urgent: !t.urgent })} className={`${tool} ${t.urgent ? "opacity-100" : ""}`} aria-label={t.urgent ? "Not urgent" : "Urgent"} aria-pressed={t.urgent}>
          <Flag className="size-4" />
        </button>
        <button type="button" onClick={() => onChange({ color: COLORS[(COLORS.indexOf(t.color) + 1) % 4] })} className={tool} aria-label="Change colour">
          <span className={`sticky-${COLORS[(COLORS.indexOf(t.color) + 1) % 4]} block size-4 rounded-full border border-black/20`} />
        </button>
        {/* moving and binning without a drag: for phones, keyboards and screen readers */}
        <span onPointerDown={(e) => e.stopPropagation()} className="ml-auto">
          <Select value="" onChange={(e) => onMove(e.target.value)} placeholder="Move to…" aria-label="Move to" className="rounded px-1.5 py-1 text-[0.7rem] opacity-70 hover:bg-black/5 hover:opacity-100">
            {columns.filter((c) => c.key !== columnOf(t)).map((c) => (
              <option key={c.key} value={c.key}>{c.name}</option>
            ))}
          </Select>
        </span>
        <button type="button" onClick={onBinned} className={tool} aria-label="Throw away note">
          <Trash2 className="size-4" />
        </button>
      </div>
    </motion.div>
  );
}
