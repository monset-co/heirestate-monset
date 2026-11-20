// The admin's frame, after the Monset dashboard's Shell (dashboard-monset/src/components/Shell.tsx):
// a navy rail whose active pill springs between items on desktop; on phones, a tab bar whose active
// tab grows into a labelled pill, with everything else under More, a bottom sheet the page eases
// back behind. Each page rises in on navigation.
import Bell from "./Bell";
import { BookOpen, Boxes, FolderOpen, Presentation, Building2, CalendarDays, Download, Mail, Inbox, LayoutDashboard, LogOut, Menu, Plus, Sparkles, MessageCircle, Receipt, Settings, StickyNote, Users } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Suspense, useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useInstall } from "./install";
import { supabase } from "./supabase";
import { useMe } from "./me";
import { SkeletonRows, spring, Toaster } from "./motion";
import { Confirmer } from "./ui";

// tab: on the phone tab bar (the rest live under More); quick: also in the thumb ring
export const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, tab: true },
  { to: "/leads", label: "Leads", icon: Inbox, tab: true },
  { to: "/whatsapp", label: "WhatsApp", icon: MessageCircle, tab: true },
  { to: "/notes", label: "Notes", icon: StickyNote, quick: true },
  { to: "/documents", label: "Documents", icon: FolderOpen },
  { to: "/presentations", label: "Presentations", icon: Presentation },
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
    <div className="flex items-center gap-2.5 leading-none">
      <img src="/logo.svg" alt="Heir Estates" className="h-12 w-auto md:h-14" />
      <p className="label text-champagne">Admin</p>
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
          <nav aria-label="Main" className="mt-2 hidden min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 md:flex">
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
            <Suspense fallback={<SkeletonRows />}>
              <Outlet />
            </Suspense>
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

      <QuickRing items={nav.filter((n) => n.quick)} />
      <MoreSheet open={more} onClose={() => setMore(false)} items={nav.filter((n) => !n.tab)} />
      <Toaster />
      <Confirmer />
    </div>
  );
}

// Phones: a button by the right thumb, above the tab bar. Press and hold: the shortcuts fan out in
// a ring around it; slide onto one and let go to open it. A quick tap opens the ring to tap instead.
const RING = 150; // px from the button's centre to each shortcut's
function QuickRing({ items }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(null); // the shortcut under the finger
  const press = useRef(null); // when the current press began
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return setHover(null);
    const esc = (e) => e.key === "Escape" && setOpen(false);
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [open]);
  const buzz = () => navigator.vibrate?.(8);
  const last = items.length - 1;
  const angleOf = (i) => Math.PI - (i / last) * (Math.PI / 2); // from straight left round to straight up
  // the shortcut the finger points at: past a small dead zone round the button, whichever lies
  // nearest the direction of the slide, so the finger needn't reach the icon itself
  const aim = (e) => {
    const b = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - (b.left + b.width / 2);
    const dy = (b.top + b.height / 2) - e.clientY;
    if (Math.hypot(dx, dy) < 30) return null;
    const a = Math.atan2(dy, dx);
    const best = items.map((it, i) => [it.to, Math.abs(Math.atan2(Math.sin(a - angleOf(i)), Math.cos(a - angleOf(i))))]).sort((x, y) => x[1] - y[1])[0];
    return best[1] < Math.PI / 4 ? best[0] : null; // pointing well away from the fan (down, right): nothing
  };

  const down = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId); // keep getting the moves while the finger slides off
    press.current = Date.now();
    if (!open) (setOpen(true), buzz());
  };
  const move = (e) => {
    if (!press.current) return;
    const to = aim(e);
    if (to !== hover) (setHover(to), to && buzz());
  };
  const up = (e) => {
    if (!press.current) return;
    const to = aim(e);
    const tap = Date.now() - press.current < 300;
    press.current = null;
    setHover(null);
    if (to) {
      setOpen(false);
      navigate(to);
    } else if (!tap) setOpen(false); // held and let go on nothing: put it away
  };
  return (
    <div className="print:hidden md:hidden">
      <AnimatePresence>
        {open && <motion.div key="veil" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} className="fixed inset-0 z-30 bg-navy-deep/45 backdrop-blur-[2px]" aria-hidden />}
      </AnimatePresence>
      <div className="fixed right-5 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+1rem)] z-40 size-14">
        <AnimatePresence>
          {open && (
            <motion.ul key="ring" id="quick-ring" exit={{ opacity: 0, transition: { duration: 0.12 } }}>
              {items.map(({ to, label, icon: Icon }, i) => {
                const a = angleOf(i);
                const lit = hover === to;
                return (
                  <motion.li
                    key={to}
                    className="absolute top-1/2 left-1/2 -mt-6 -ml-6"
                    initial={{ x: 0, y: 0, scale: 0.4, opacity: 0 }}
                    animate={{ x: Math.cos(a) * RING, y: -Math.sin(a) * RING, scale: lit ? 1.25 : 1, opacity: 1, transition: { ...spring, delay: i * 0.025 } }}
                  >
                    <NavLink
                      to={to}
                      data-to={to}
                      aria-label={label}
                      className={({ isActive }) => `grid size-12 place-items-center rounded-full shadow-lg ring-1 transition-colors ${lit ? "bg-gold text-navy-deep ring-gold" : isActive ? "bg-side-2 text-champagne ring-gold/40" : "bg-side text-cream ring-cream/15"}`}
                    >
                      <Icon className="size-5" aria-hidden />
                    </NavLink>
                    <span className={`pointer-events-none absolute top-full left-1/2 mt-1 -translate-x-1/2 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap transition-colors ${lit ? "bg-gold text-navy-deep" : "bg-side/90 text-cream/85"}`}>{label}</span>
                  </motion.li>
                );
              })}
            </motion.ul>
          )}
        </AnimatePresence>
        <button
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={() => ((press.current = null), setOpen(false))}
          onClick={(e) => e.detail === 0 && setOpen((o) => !o)} // keyboard: Enter or Space
          onContextMenu={(e) => e.preventDefault()} // a long press mustn't open the phone's menu
          aria-expanded={open}
          aria-controls="quick-ring"
          aria-label={open ? "Close shortcuts" : "Shortcuts: press and hold, slide to one"}
          className="relative grid size-14 touch-none place-items-center rounded-full bg-gold text-navy-deep shadow-[0_8px_24px_-6px_rgb(20_33_58/0.55)] ring-4 ring-gold/25 select-none [-webkit-touch-callout:none]"
        >
          <motion.span animate={{ rotate: open ? 135 : 0, scale: open ? 0.9 : 1 }} transition={spring} className="grid place-items-center">
            {open ? <Plus className="size-6" aria-hidden /> : <Sparkles className="size-6" aria-hidden />}
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
