// Mons, the team's assistant (admin/worker/mons.js), as a Messenger-style chat. One chat the whole
// team shares for now: everyone's messages and Mons's answers arrive live for everyone. She reads the
// admin's data to answer; she doesn't change anything yet.
import { Check, Send, Sparkles } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { supabase, run } from "../supabase";
import { api } from "../api";
import { useMe } from "../me";
import { SkeletonRows } from "../motion";
import { ErrorNote, btn, btnGhost, card, input } from "../ui";
import { when } from "../crm";
import MonsUsage from "../MonsUsage";

const merge = (list, row) => [...list.filter((x) => x.id !== row.id), row].sort((a, b) => a.created_at.localeCompare(b.created_at));
const STARTERS = ["Brief me on today", "Which hot leads need a follow-up?", "Any 2BR for rent under ₱30,000?", "What's on the calendar this week?"];

// Mons writes a little Markdown: [links](/leads/12) to the admin's own pages, **bold** and lists.
// Only links inside the admin become links; anything else stays text.
function Rich({ text }) {
  // the odd heading, divider or "* " bullet she slips in, made plain
  text = text.replace(/^#{1,6}\s+/gm, "").replace(/^\s*(---+|\*\*\*+)\s*$/gm, "").replace(/^(\s*)[*-]\s+/gm, "$1• ").replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1$2").replace(/\n{3,}/g, "\n\n");
  return text.split(/(\[[^\]]+\]\(\/[^)\s]*\)|\*\*[^*]+\*\*)/g).map((s, i) => {
    const link = s.match(/^\[([^\]]+)\]\((\/[^)\s]*)\)$/);
    if (link)
      return (
        <Link key={i} to={link[2]} className="font-medium underline decoration-gold/60 underline-offset-2 hover:decoration-gold">
          {link[1]}
        </Link>
      );
    if (/^\*\*[^*]+\*\*$/.test(s)) return <strong key={i}>{s.slice(2, -2)}</strong>;
    return <Fragment key={i}>{s}</Fragment>;
  });
}

// A bigger change she proposed: Confirm runs it as whoever presses it; anyone in the chat can.
const STATE = { done: "Done", declined: "Not done", failed: "Didn't go through" };
function Proposal({ p, onAnswer }) {
  const [busy, setBusy] = useState(false);
  const answer = async (ok) => {
    setBusy(true);
    await onAnswer(ok);
    setBusy(false);
  };
  return (
    <div className="mt-2 rounded-lg border border-line bg-bg/60 p-2.5 text-xs">
      <p className="font-medium text-fg">
        <Link to={p.url} className="hover:underline">
          {p.summary}
        </Link>
      </p>
      {p.state === "pending" ? (
        <div className="mt-2 flex gap-2">
          <button type="button" className={`${btn} !px-3 !py-1.5 !text-xs`} disabled={busy} onClick={() => answer(true)}>
            Confirm
          </button>
          <button type="button" className={`${btnGhost} !px-3 !py-1.5 !text-xs`} disabled={busy} onClick={() => answer(false)}>
            Not now
          </button>
        </div>
      ) : (
        <p className={`mt-1 ${p.state === "failed" ? "text-danger" : "text-muted"}`}>
          {STATE[p.state] ?? p.state}
          {p.by && ` · ${p.by}`}
          {p.state === "failed" && p.note && `: ${p.note}`}
        </p>
      )}
    </div>
  );
}

// What a reply cost, small after the time; the full split on hover (mons_messages.usage)
const kfmt = new Intl.NumberFormat("en-PH", { notation: "compact", maximumFractionDigits: 1 });
function Cost({ u, total }) {
  const cached = u.prompt ? Math.round((u.cached / u.prompt) * 100) : 0;
  const tools = Object.entries(u.tools ?? {}).map(([k, v]) => `${k} ${kfmt.format(v)} chars`);
  const detail = [`Read ${u.prompt.toLocaleString("en-PH")} (${cached}% cached)`, `wrote ${u.output.toLocaleString("en-PH")}`, `thought ${u.thoughts.toLocaleString("en-PH")}`, `${u.rounds} round${u.rounds > 1 ? "s" : ""}`, ...tools].join(" · ");
  return (
    <span className="tabular-nums" title={detail}>
      {" "}
      · {kfmt.format(total)} tokens{cached > 0 && ` · ${cached}% cached`}
    </span>
  );
}

// While she works: three bouncing dots and a line that moves on every couple of seconds
const THINKING = ["Mons is thinking", "Looking it up", "Checking the records", "Putting it together"];
function Typing() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => Math.min(n + 1, THINKING.length - 1)), 2500);
    return () => clearInterval(t);
  }, []);
  return (
    <p className="flex items-center gap-2 rounded-xl rounded-bl-sm border border-gold/40 bg-surface px-3 py-2 text-sm text-muted" role="status">
      <span className="flex gap-1" aria-hidden>
        {[0, 150, 300].map((d) => (
          <span key={d} className="size-1.5 rounded-full bg-gold motion-safe:animate-bounce" style={{ animationDelay: `${d}ms` }} />
        ))}
      </span>
      <span key={i} className="motion-safe:animate-[fade-in_300ms_ease-out]">
        {THINKING[i]}…
      </span>
    </p>
  );
}

export default function Mons() {
  const me = useMe();
  const [msgs, setMsgs] = useState(null);
  const [people, setPeople] = useState({});
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const end = useRef(null);

  useEffect(() => {
    run(supabase.from("mons_messages").select("*").order("created_at", { ascending: false }).limit(200)).then((l) => setMsgs(l.reverse()), (e) => setError(e.message));
    run(supabase.from("admin_users").select("email,name")).then((l) => setPeople(Object.fromEntries(l.map((p) => [p.email, p.name]))), () => {});
    const ch = supabase
      .channel(`mons-${crypto.randomUUID()}`) // its own name: see Bell.jsx
      // INSERT: a new message; UPDATE: a proposal confirmed or turned down
      .on("postgres_changes", { event: "*", schema: "public", table: "mons_messages" }, ({ new: n }) => n?.id && setMsgs((l) => l && merge(l, n)))
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  // braces: Chrome's scrollIntoView now returns a Promise, which React would call as the cleanup
  useLayoutEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [msgs?.length, busy]);

  async function send(e, said = text) {
    e?.preventDefault();
    const body = said.trim();
    if (!body || busy) return;
    setBusy(true);
    setError("");
    setText("");
    try {
      const { messages } = await api("mons", { text: body });
      setMsgs((l) => messages.reduce(merge, l ?? []));
    } catch (err) {
      setError(err.message);
      setText(body);
    }
    setBusy(false);
  }

  async function decide(id, index, ok) {
    setError("");
    try {
      await api("mons/confirm", { id, index, ok });
      // the change arrives through realtime; fetch it too in case realtime is slow
      const l = await run(supabase.from("mons_messages").select("*").gte("id", id).order("id"));
      setMsgs((m) => l.reduce(merge, m ?? []));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section
      aria-label="Mons"
      className={`${card} flex h-[calc(100dvh-var(--tabbar-h)-env(safe-area-inset-top)-env(safe-area-inset-bottom)-7.5rem)] min-h-[26rem] flex-col overflow-hidden md:h-[calc(100dvh-5rem)]`}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3">
        <span className="grid size-10 place-items-center rounded-full bg-navy text-gold" aria-hidden>
          <Sparkles className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-xl text-ink">Mons</h1>
          <p className="text-xs text-muted">Your assistant. She looks things up and handles notes, reminders and tasks; bigger changes wait for your Confirm. The whole team shares this chat.</p>
        </div>
        <MonsUsage className="w-full sm:w-64" />
      </header>

      <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-bg/60 px-3 py-4 sm:px-5" aria-live="polite">
        {!msgs ? (
          <SkeletonRows n={3} />
        ) : (
          msgs.map((m) => {
            const mine = !m.from_mons && m.author === me?.email;
            return (
              <li key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-xl px-3 py-2 text-sm shadow-sm sm:max-w-[70%] ${
                    m.from_mons ? "rounded-bl-sm border border-gold/40 bg-surface text-fg" : mine ? "rounded-br-sm bg-navy text-cream" : "rounded-bl-sm border border-line bg-surface text-fg"
                  }`}
                >
                  <p className="break-words whitespace-pre-wrap">{m.from_mons ? <Rich text={m.body} /> : m.body}</p>
                  {m.changes?.length > 0 && (
                    <ul className="mt-2 space-y-1 border-t border-line pt-2 text-xs" aria-label="What Mons changed">
                      {m.changes.map((c, i) => (
                        <li key={i} className="flex gap-1.5">
                          <Check className="mt-0.5 size-3.5 shrink-0 text-gold-ink" aria-hidden />
                          <Link to={c.url} className="hover:underline">
                            {c.text}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  {m.proposals?.map((p, i) => (
                    <Proposal key={i} p={p} onAnswer={(ok) => decide(m.id, i, ok)} />
                  ))}
                  <p className={`mt-1 text-right text-[0.7rem] ${mine ? "text-cream/60" : "text-muted"}`}>
                    {m.from_mons ? "Mons" : mine ? "You" : (people[m.author] ?? m.author.split("@")[0])} ·{" "}
                    <time dateTime={m.created_at} title={when(m.created_at)}>
                      {new Date(m.created_at).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}
                    </time>
                    {m.usage?.rounds > 0 && <Cost u={m.usage} total={m.tokens} />}
                  </p>
                </div>
              </li>
            );
          })
        )}
        {msgs?.length === 0 && !busy && (
          <li className="px-2 py-8 text-center text-sm text-muted">
            <p>Hello! I'm Mons. Ask me about your leads, listings, schedule or files.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {STARTERS.map((s) => (
                <button key={s} type="button" onClick={() => send(null, s)} className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm text-fg hover:border-muted/50">
                  {s}
                </button>
              ))}
            </div>
          </li>
        )}
        {busy && (
          <li className="flex justify-start">
            <Typing />
          </li>
        )}
        <li ref={end} aria-hidden />
      </ol>

      <div className="border-t border-line p-3">
        <ErrorNote error={error} />
        <form onSubmit={send} className="flex items-end gap-2">
          <label className="flex-1">
            <span className="sr-only">Message Mons</span>
            <textarea
              rows={Math.min(6, text.split("\n").length)}
              maxLength={4000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              // Enter sends only with a real keyboard: a phone's Enter is the new line
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && matchMedia("(pointer: fine)").matches && send(e)}
              placeholder="Ask Mons… (Shift+Enter for a new line)"
              className={`${input} resize-none`}
            />
          </label>
          <button className={btn} disabled={busy || !text.trim()} aria-label="Send">
            <Send className="size-4" aria-hidden />
          </button>
        </form>
      </div>
    </section>
  );
}
