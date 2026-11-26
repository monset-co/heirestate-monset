// Mons on every desktop page: a button in the bottom-right corner that opens your private chat
// with her (pages/Mons.jsx MonsChat) as a panel over the page. She's told the page that's open,
// so "this lead" means the one on screen. A dot on the button when she's written to you meanwhile.
import { BotMessageSquare } from "lucide-react";
import { AnimatePresence, m as motion } from "motion/react";
import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { supabase } from "./supabase";
import { useMe } from "./me";
import { spring } from "./motion";
import { MonsChat } from "./pages/Mons";

export default function MonsPanel() {
  const me = useMe();
  const { pathname, search } = useLocation();
  const [open, setOpen] = useState(false);
  const [news, setNews] = useState(false);

  // her reminders and suggestions land in your private chat while it's closed
  useEffect(() => {
    if (!me?.email || open) return;
    const ch = supabase
      .channel(`mons-dot-${crypto.randomUUID()}`) // its own name: see Bell.jsx
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "mons_messages", filter: `thread=eq.${me.email}` }, ({ new: n }) => n.from_mons && setNews(true))
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [me?.email, open]);

  useEffect(() => {
    if (!open) return;
    setNews(false);
    const esc = (e) => e.key === "Escape" && setOpen(false);
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [open]);

  if (pathname === "/mons") return null; // the full chat is the page itself
  return (
    <div className="fixed right-6 bottom-6 z-40 print:hidden">
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: spring }}
            exit={{ opacity: 0, y: 12, transition: { duration: 0.14 } }}
            style={{ transformOrigin: "bottom right" }}
            className="absolute right-0 bottom-0 h-[min(44rem,calc(100dvh-3rem))] w-[min(28rem,calc(100vw-var(--rail)-3rem))] shadow-2xl"
          >
            <MonsChat alone page={pathname + search} onClose={() => setOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={news ? "Mons, new message" : "Ask Mons"}
          className="press relative grid size-14 place-items-center rounded-full bg-navy text-gold shadow-lg ring-1 ring-gold/30 hover:bg-navy-deep"
        >
          <BotMessageSquare className="size-6" aria-hidden />
          {news && <span className="absolute top-1 right-1 size-3 rounded-full bg-gold ring-2 ring-navy" aria-hidden />}
        </button>
      )}
    </div>
  );
}
