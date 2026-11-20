// The notification bell, at the top of the app: the alerts the admin Worker sends (a task given to
// you, a new inquiry, a WhatsApp message, a reminder come due; admin/worker/push.js), whether or not
// this device has push turned on. New ones arrive live; opening one marks it read.
import { Bell as BellIcon, CheckCheck } from "lucide-react";
import { AnimatePresence, m as motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { supabase, run } from "./supabase";
import { useMe } from "./me";
import { ago } from "./crm";
import { useDismiss } from "./ui";

const COLS = "id, title, body, url, read_at, created_at";

export default function Bell() {
  const me = useMe();
  const navigate = useNavigate();
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const unread = list.filter((n) => !n.read_at).length;

  useEffect(() => {
    run(supabase.from("notifications").select(COLS).order("created_at", { ascending: false }).limit(30)).then(setList, () => {});
    // a channel of its own: Supabase hands back an open channel of the same name, and adding to one
    // that's subscribed throws (two bells on screen, or one remounting before the last has closed)
    const ch = supabase
      .channel(`bell-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `email=eq.${me.email}` }, ({ new: n }) => setList((l) => [n, ...l].slice(0, 30)))
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [me.email]);

  useDismiss(box, open, () => setOpen(false)); // a click elsewhere, or Esc, closes it

  const markRead = (ids) => {
    const at = new Date().toISOString();
    setList((l) => l.map((n) => (ids.includes(n.id) ? { ...n, read_at: n.read_at ?? at } : n)));
    run(supabase.from("notifications").update({ read_at: at }).in("id", ids).is("read_at", null)).catch(() => {});
  };

  function go(n) {
    if (!n.read_at) markRead([n.id]);
    setOpen(false);
    if (n.url) navigate(n.url);
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        className="press relative grid size-10 place-items-center rounded-full text-cream/75 hover:bg-side-2 hover:text-cream"
      >
        <BellIcon className="size-5" aria-hidden />
        <AnimatePresence>
          {unread > 0 && (
            <motion.span
              key={unread}
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0 }}
              className="absolute top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full bg-burgundy px-1 text-[0.625rem] font-bold text-cream tabular-nums"
            >
              {unread > 9 ? "9+" : unread}
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
            className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+4.25rem)] z-50 origin-top overflow-hidden rounded-xl border border-line bg-surface text-fg shadow-[0_18px_40px_-12px_rgb(12_21_38/0.45)] md:absolute md:inset-x-auto md:top-0 md:left-[calc(100%+0.5rem)] md:w-96 md:origin-top-left"
          >
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <h2 className="font-semibold text-ink">Notifications</h2>
              {unread > 0 && (
                <button type="button" onClick={() => markRead(list.filter((n) => !n.read_at).map((n) => n.id))} className="press ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-sunken hover:text-fg">
                  <CheckCheck className="size-3.5" aria-hidden /> Mark all read
                </button>
              )}
            </div>
            {!list.length ? (
              <p className="px-4 py-8 text-center text-sm text-muted">Nothing yet. Tasks given to you, new inquiries, WhatsApp messages and reminders show up here.</p>
            ) : (
              <ul className="max-h-[min(28rem,70dvh)] divide-y divide-line overflow-y-auto">
                {list.map((n) => (
                  <li key={n.id}>
                    <button type="button" onClick={() => go(n)} className={`flex w-full gap-3 px-4 py-3 text-left hover:bg-sunken ${n.read_at ? "" : "bg-gold/8"}`}>
                      <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read_at ? "" : "bg-gold"}`} />
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm ${n.read_at ? "text-charcoal" : "font-semibold text-ink"}`}>{n.title}</span>
                        {n.body && <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{n.body}</span>}
                        <span className="mt-1 block text-[0.7rem] text-muted">{ago(n.created_at)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
