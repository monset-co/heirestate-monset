// The admin's frame, after the Monset dashboard's Shell (dashboard-monset/src/components/Shell.tsx):
// a navy rail whose active pill springs between items on desktop; on phones, a tab bar whose active
// tab grows into a labelled pill, with everything else under More, a bottom sheet the page eases
// back behind. Each page rises in on navigation.
import Bell from "./Bell";
import { BookOpen, Boxes, FolderOpen, Presentation, Building2, CalendarDays, Download, Mail, Inbox, LayoutDashboard, LogOut, Menu, MessageCircle, Receipt, Settings, StickyNote, Users } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useInstall } from "./install";
import { supabase } from "./supabase";
import { useMe } from "./me";
import { spring, Toaster } from "./motion";
import { Confirmer } from "./ui";

// tab: on the phone tab bar (the rest live under More); quick: also on the thumb gear
export const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, tab: true },
  { to: "/leads", label: "Leads", icon: Inbox, tab: true },
  { to: "/whatsapp", label: "WhatsApp", icon: MessageCircle, tab: true },
  { to: "/notes", label: "Notes", icon: StickyNote, quick: true },
  { to: "/documents", label: "Documents", icon: FolderOpen, quick: true },
  { to: "/presentations", label: "Presentations", icon: Presentation, quick: true },
  { to: "/email", label: "Email", icon: Mail, quick: true },
  { to: "/inventory", label: "Inventory", icon: Boxes, quick: true },
  { to: "/calendar", label: "Calendar", icon: CalendarDays, quick: true },
  { to: "/listings", label: "Listings", icon: Building2, tab: true },
  { to: "/commissions", label: "Commissions", icon: Receipt },
  { to: "/users", label: "Users", icon: Users },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/guide", label: "Guide", icon: BookOpen },
];

const signOut = () => supabase.auth.signOut();

// "Install app": the browser's own prompt where there is one (Chrome, Edge, Android), otherwise
// the steps for this device in Settings. Gone once the admin runs as an installed app.
function InstallButton({ className }) {
  const install = useInstall();
  const navigate = useNavigate();
  if (install.installed) return null;
  const go = async () => {
    if (install.canPrompt) await install.prompt();
    else navigate("/settings#install");
  };
  return (
    <button onClick={go} className={className}>
      <Download className="size-4" aria-hidden />
      Install app
    </button>
  );
}

function Mark() {
  return (
    <div className="leading-none">
      <p className="font-display text-[1.35rem] text-cream">Heir Estates</p>
      <p className="label mt-1 text-champagne">Admin</p>
    </div>
  );
}

export default function Shell() {
  const me = useMe();
  const { pathname } = useLocation();
  const section = "/" + (pathname.split("/")[1] ?? "");
  const [more, setMore] = useState(false);
  const moreActive = !nav.some((n) => n.tab && n.to === section);

  return (
    <div data-sheet={more ? "open" : undefined} className="min-h-dvh transition-colors duration-300 [--tabbar-h:4rem] data-[sheet=open]:bg-navy-deep md:grid md:grid-cols-[15rem_1fr] md:[--tabbar-h:0px] print:block">
      <div className="app-page bg-bg md:contents">
        <aside className="sticky top-0 z-20 flex flex-col print:hidden bg-side pt-[env(safe-area-inset-top)] text-cream md:h-dvh md:pt-0">
          <div className="flex h-16 items-center justify-between gap-2 px-4 md:h-20 md:px-5">
            <Mark />
            <Bell />
          </div>

          {/* Desktop rail: the active pill springs between items */}
          <nav aria-label="Main" className="mt-2 hidden flex-col gap-0.5 px-3 md:flex">
            {nav.map(({ to, label, icon: Icon }) => {
              const active = to === section;
              return (
                <NavLink key={to} to={to} end={to === "/"} className={`press relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${active ? "text-cream" : "text-cream/60 hover:text-cream"}`}>
                  {active && (
                    <motion.span layoutId="nav-pill" transition={spring} className="absolute inset-0 rounded-md bg-side-2 ring-1 ring-cream/8">
                      <span className="absolute top-1/2 left-0 h-4 w-[3px] -translate-y-1/2 rounded-full bg-gold" />
                    </motion.span>
                  )}
                  <Icon className={`relative size-4 transition-colors ${active ? "text-gold" : ""}`} aria-hidden />
                  <span className="relative">{label}</span>
                </NavLink>
              );
            })}
          </nav>

          <div className="mt-auto hidden border-t border-cream/10 p-3 md:block">
            <div className="px-1 text-sm">
              <div className="truncate font-medium">{me.name}</div>
              <div className="truncate text-xs text-cream/50">{me.email}</div>
            </div>
            <InstallButton className="press mt-2 flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-gold hover:bg-side-2 hover:text-champagne" />
            <button onClick={signOut} className="press flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-cream/65 hover:bg-side-2 hover:text-cream">
              <LogOut className="size-4" aria-hidden />
              Sign out
            </button>
          </div>
        </aside>

        <main className="mx-auto w-full max-w-[90rem] min-w-0 px-4 py-6 print:p-0 pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+5.5rem)] md:px-10 md:py-10">
          <div key={pathname} className="page-in">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Phone tab bar: the active tab grows into a pill and its label slides out */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 print:hidden border-t border-cream/10 bg-side/95 pb-[env(safe-area-inset-bottom)] text-cream backdrop-blur md:hidden">
        <div className="flex h-16 items-center gap-1 px-2">
          {[...nav.filter((n) => n.tab), { to: "#more", label: "More", icon: Menu }].map(({ to, label, icon: Icon }) => {
            const isMore = to === "#more";
            const active = isMore ? moreActive : to === section;
            const pill = (
              <motion.span layout transition={spring} className={`flex h-10 items-center gap-1.5 rounded-full px-3 ${active ? "bg-gold/20 text-champagne" : "text-cream/60"}`}>
                <motion.span layout="position" transition={spring} className="grid place-items-center">
                  <Icon className="size-5" aria-hidden />
                </motion.span>
                <AnimatePresence initial={false} mode="popLayout">
                  {active && (
                    <motion.span
                      key="label"
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0, transition: { ...spring, delay: 0.06 } }}
                      exit={{ opacity: 0, transition: { duration: 0.1 } }}
                      className="text-xs font-semibold whitespace-nowrap"
                    >
                      {label}
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.span>
            );
            const cls = `press flex h-full min-w-11 items-center justify-center ${active ? "flex-[2.2]" : "flex-1"}`;
            return isMore ? (
              <button key={to} onClick={() => setMore(true)} aria-expanded={more} aria-label="More" className={cls}>
                {pill}
              </button>
            ) : (
              <NavLink key={to} to={to} end={to === "/"} aria-label={label} className={cls}>
                {pill}
              </NavLink>
            );
          })}
        </div>
      </nav>

      <QuickGear items={nav.filter((n) => n.quick)} />
      <MoreSheet open={more} onClose={() => setMore(false)} items={nav.filter((n) => !n.tab)} />
      <Toaster />
      <Confirmer />
    </div>
  );
}

// Phones: a gear by the right thumb, above the tab bar. Tap it and it turns, and the shortcuts
// rise out of it, nearest the thumb first.
function QuickGear({ items }) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const esc = (e) => e.key === "Escape" && setOpen(false);
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [open]);
  return (
    <div className="print:hidden md:hidden">
      <AnimatePresence>
        {open && (
          <motion.div key="veil" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} className="fixed inset-0 z-30 bg-navy-deep/40 backdrop-blur-[2px]" aria-hidden />
        )}
      </AnimatePresence>
      <div className="fixed right-4 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+1rem)] z-40 flex flex-col items-end gap-2.5">
        <AnimatePresence>
          {open && (
            <motion.ul id="quick-gear" className="flex flex-col items-end gap-2.5">
              {items.map(({ to, label, icon: Icon }, i) => {
                const n = items.length - 1 - i; // the one nearest the gear comes out first
                return (
                  <motion.li key={to} initial={{ opacity: 0, y: 16, scale: 0.8 }} animate={{ opacity: 1, y: 0, scale: 1, transition: { ...spring, delay: n * 0.03 } }} exit={{ opacity: 0, y: 10, scale: 0.9, transition: { duration: 0.12 } }}>
                    <NavLink to={to} className={({ isActive }) => `press flex min-h-11 items-center gap-2.5 rounded-full py-2 pr-4 pl-3 text-sm font-medium shadow-lg ring-1 ring-cream/10 ${isActive ? "bg-side-2 text-champagne" : "bg-side text-cream"}`}>
                      <Icon className="size-4 text-gold" aria-hidden /> {label}
                    </NavLink>
                  </motion.li>
                );
              })}
            </motion.ul>
          )}
        </AnimatePresence>
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="quick-gear" aria-label={open ? "Close shortcuts" : "Shortcuts"} className="press grid size-14 place-items-center rounded-full bg-navy text-gold shadow-[0_6px_20px_-4px_rgb(20_33_58/0.5)] ring-1 ring-gold/30">
          <motion.span animate={{ rotate: open ? 120 : 0 }} transition={spring} className="grid place-items-center">
            <Settings className="size-6" aria-hidden />
          </motion.span>
        </button>
      </div>
    </div>
  );
}

function MoreSheet({ open, onClose, items }) {
  const ref = useRef(null);
  const me = useMe();
  const { pathname } = useLocation();
  useEffect(() => {
    const d = ref.current;
    if (open && d && !d.open) d.showModal();
    if (!open && d?.open) d.close();
  }, [open]);
  useEffect(onClose, [pathname]); // close after navigating
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => e.target === e.currentTarget && onClose()} className="sheet rounded-t-2xl border-t border-cream/10 bg-side p-0 text-cream md:hidden">
      <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-cream/20" aria-hidden />
      <div className="px-5 pt-4 pb-3 text-sm">
        <div className="truncate font-medium">{me.name}</div>
        <div className="truncate text-xs text-cream/50">{me.email}</div>
      </div>
      <ul className="grid grid-cols-2 gap-2 px-4 pb-3">
        {items.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <NavLink to={to} className={({ isActive }) => `press flex items-center gap-3 rounded-xl px-4 py-3.5 text-sm font-medium ${isActive ? "bg-side-2 text-cream" : "bg-side-2/50 text-cream/75"}`}>
              {({ isActive }) => (
                <>
                  <Icon className={`size-4 ${isActive ? "text-gold" : ""}`} aria-hidden /> {label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
      <InstallButton className="press mx-4 mb-2 flex w-[calc(100%-2rem)] items-center justify-center gap-2 rounded-xl bg-gold/15 px-4 py-3 text-sm font-medium text-champagne" />
      <button onClick={signOut} className="press mx-4 mb-4 flex w-[calc(100%-2rem)] items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm text-cream/65 ring-1 ring-cream/10 hover:text-cream">
        <LogOut className="size-4" aria-hidden /> Sign out
      </button>
    </dialog>
  );
}
