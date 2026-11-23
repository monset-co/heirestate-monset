import { lazy, useEffect, useState } from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { MotionConfig } from "motion/react";
import { supabase, run, SETTING_PASSWORD } from "./supabase";
import { api } from "./api";
import { Me } from "./me";
import { ErrorNote, Field, btn, btnGhost, card, input } from "./ui";
import Shell from "./Shell";
import Dashboard from "./pages/Dashboard";
const Leads = lazy(() => import("./pages/Leads"));
const LeadDetail = lazy(() => import("./pages/LeadDetail"));
const Listings = lazy(() => import("./pages/Listings"));
const ListingDetail = lazy(() => import("./pages/ListingDetail"));
const Commissions = lazy(() => import("./pages/Commissions"));
const Report = lazy(() => import("./pages/Report"));
const Users = lazy(() => import("./pages/Users"));
const Settings = lazy(() => import("./pages/Settings"));
const WhatsApp = lazy(() => import("./pages/WhatsApp"));
const Guide = lazy(() => import("./pages/Guide"));
const Calendar = lazy(() => import("./pages/Calendar"));
const Inventory = lazy(() => import("./pages/Inventory"));
const Email = lazy(() => import("./pages/Email"));
const Notes = lazy(() => import("./pages/Notes"));
const Library = lazy(() => import("./pages/Library"));
const Mons = lazy(() => import("./pages/Mons"));

// pages load when first opened, so the phone downloads the dashboard first, not the whole admin
const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "leads", element: <Leads /> },
      { path: "leads/:id", element: <LeadDetail /> },
      { path: "whatsapp", element: <WhatsApp /> },
      { path: "whatsapp/:id", element: <WhatsApp /> },
      { path: "calendar", element: <Calendar /> },
      { path: "notes", element: <Notes /> },
      { path: "documents", element: <Library shelf="documents" key="documents" /> },
      { path: "presentations", element: <Library shelf="presentations" key="presentations" /> },
      { path: "inventory", element: <Inventory /> },
      { path: "email", element: <Email /> },
      { path: "listings", element: <Listings /> },
      { path: "listings/:id", element: <ListingDetail /> },
      { path: "commissions", element: <Commissions /> },
      { path: "commissions/report", element: <Report /> },
      { path: "users", element: <Users /> },
      { path: "settings", element: <Settings /> },
      { path: "guide", element: <Guide /> },
      { path: "mons", element: <Mons /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

// Fades out index.html's opening screen once the app has something to show, not before the
// logo's build has finished on a first open
function hideSplash() {
  const s = document.getElementById("splash");
  if (!s || s.dataset.out) return;
  s.dataset.out = "1";
  setTimeout(() => {
    s.style.opacity = "0";
    setTimeout(() => s.remove(), 450);
  }, Math.max(0, Number(s.dataset.until) - performance.now()));
}

// Signing in takes two steps: their password, then a code emailed to them (admin/worker). The
// database lets a session see nothing until it has passed both (is_admin in supabase/migrations).
export default function App() {
  const [session, setSession] = useState(undefined); // undefined: not known yet
  const [settingPassword, setSettingPassword] = useState(SETTING_PASSWORD);
  const [me, setMe] = useState(null); // their admin_users row, once both steps are done
  const [checked, setChecked] = useState(false); // looked for that row in this session

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "PASSWORD_RECOVERY") setSettingPassword(true);
      setSession(s);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const sessionId = session?.access_token && JSON.parse(atob(session.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).session_id;
  const lookUp = () =>
    run(supabase.from("admin_users").select("id, email, name").eq("email", session.user.email.toLowerCase()).maybeSingle())
      .then(setMe, () => setMe(null))
      .finally(() => setChecked(true));
  useEffect(() => {
    setMe(null);
    setChecked(false);
    if (sessionId && !settingPassword) lookUp();
  }, [sessionId, settingPassword]);

  const ready = session !== undefined && (!session || settingPassword || checked);
  useEffect(() => void (ready && hideSplash()), [ready]);

  if (session === undefined) return <div className="min-h-dvh bg-navy" aria-busy="true" />;
  if (!session) return <SignIn />;
  if (settingPassword) return <SetPassword email={session.user.email} onDone={() => setSettingPassword(false)} />;
  if (!checked) return <div className="min-h-dvh bg-navy" aria-busy="true" />;
  if (!me) return <SecondStep email={session.user.email} onDone={lookUp} />;
  return (
    <Me.Provider value={me}>
      {/* "reduce motion" on the device: Motion's springs and slides become fades */}
      <MotionConfig reducedMotion="user">
        <RouterProvider router={router} />
      </MotionConfig>
    </Me.Provider>
  );
}

const Centre = ({ title, children }) => (
  <main className="grid min-h-dvh place-items-center bg-navy px-4 py-16">
    <div className="page-in w-full max-w-sm">
      <div className="mb-8 text-center text-cream">
        <img src="/logo.svg" alt="Heir Estates" className="mx-auto h-28 w-auto" />
        <p className="label mt-3 text-champagne">Admin</p>
      </div>
      <div className={`${card} p-6`}>
        {title && <h1 className="mb-4 font-display text-xl text-ink">{title}</h1>}
        {children}
      </div>
    </div>
  </main>
);

const useBusy = () => {
  const [state, setState] = useState({ busy: false, error: "", note: "" });
  const go = async (fn) => {
    setState({ busy: true, error: "", note: "" });
    try {
      const note = await fn();
      setState({ busy: false, error: "", note: note ?? "" });
    } catch (e) {
      setState({ busy: false, error: e.message, note: "" });
    }
  };
  return [state, go];
};

function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [{ busy, error, note }, go] = useBusy();
  const address = email.trim().toLowerCase();

  const signIn = (e) => {
    e.preventDefault();
    go(() => run(supabase.auth.signInWithPassword({ email: address, password })));
  };
  const forgot = () =>
    address
      ? go(async () => {
          await run(supabase.auth.resetPasswordForEmail(address, { redirectTo: location.origin }));
          return `If ${address} is on the admin list, a link to set a new password is on its way.`;
        })
      : go(async () => {
          throw new Error("Enter your email first");
        });

  return (
    <Centre>
      <form onSubmit={signIn} className="grid gap-4">
        <ErrorNote error={error} />
        {note && <p role="status" className="rounded-md bg-sunken px-3 py-2.5 text-sm text-fg">{note}</p>}
        <Field label="Email">
          <input type="email" required autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
        </Field>
        <Field label="Password">
          <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
        </Field>
        <button className={btn} disabled={busy}>{busy ? "One moment…" : "Continue"}</button>
        <button type="button" onClick={forgot} className="text-sm text-muted underline underline-offset-4 hover:text-fg">
          Forgot your password, or first time here?
        </button>
      </form>
    </Centre>
  );
}

// from an invitation or a "forgot password" link
function SetPassword({ email, onDone }) {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [{ busy, error }, go] = useBusy();
  const save = (e) => {
    e.preventDefault();
    go(async () => {
      if (password.length < 10) throw new Error("Use at least 10 characters");
      if (password !== again) throw new Error("The two passwords don't match");
      await run(supabase.auth.updateUser({ password }));
      onDone();
    });
  };
  return (
    <Centre title="Set your password">
      <form onSubmit={save} className="grid gap-4">
        <p className="text-sm text-muted">For {email}. After this, each sign-in also asks for a code sent to this email.</p>
        <ErrorNote error={error} />
        <input type="email" value={email} autoComplete="username" readOnly hidden />
        <Field label="New password" hint="At least 10 characters">
          <input type="password" required minLength={10} autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
        </Field>
        <Field label="The same again">
          <input type="password" required autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className={input} />
        </Field>
        <button className={btn} disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
      </form>
    </Centre>
  );
}

// the second step: a code emailed to them
function SecondStep({ email, onDone }) {
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [blocked, setBlocked] = useState(""); // not on the admin list
  const [{ busy, error, note }, go] = useBusy();

  const send = () =>
    go(async () => {
      try {
        const r = await api("second-factor/send", {});
        if (r.verified) return onDone();
        setSent(true);
        return `A code is on its way to ${email}.`;
      } catch (e) {
        if (e.status === 403) setBlocked(e.message);
        throw e;
      }
    });
  useEffect(() => {
    send();
  }, []);

  const verify = (e) => {
    e.preventDefault();
    go(async () => {
      await api("second-factor/verify", { code: code.trim() });
      onDone();
    });
  };

  if (blocked)
    return (
      <Centre>
        <ErrorNote error={blocked} />
        <button className={`${btnGhost} mt-4 w-full`} onClick={() => supabase.auth.signOut()}>Sign out</button>
      </Centre>
    );
  return (
    <Centre title="Check your email">
      <form onSubmit={verify} className="grid gap-4">
        {note && <p role="status" className="text-sm text-muted">{note}</p>}
        <ErrorNote error={error} />
        <Field label="Code" hint="Six digits. It works once, for 10 minutes.">
          <input required inputMode="numeric" autoComplete="one-time-code" autoFocus pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className={`${input} text-center text-lg tracking-[0.4em] tabular-nums`} />
        </Field>
        <button className={btn} disabled={busy || code.length !== 6}>{busy && sent ? "Checking…" : "Sign in"}</button>
        <div className="flex justify-between text-sm">
          <button type="button" onClick={send} disabled={busy} className="text-muted underline underline-offset-4 hover:text-fg">Send a new code</button>
          <button type="button" onClick={() => supabase.auth.signOut()} className="text-muted underline underline-offset-4 hover:text-fg">Sign out</button>
        </div>
      </form>
    </Centre>
  );
}
