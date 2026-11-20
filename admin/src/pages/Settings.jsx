import { Download } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useInstall, device } from "../install";
import { supabase, run, every } from "../supabase";
import { Skeleton, toast } from "../motion";
import { ErrorNote, Field, PageHeader, btn, btnGhost, card, input, Select } from "../ui";
import { toCsv, download } from "../csv";
import { usePush } from "../push";

const KEYS = ["contract_effective_date", "broker_name", "broker_prc_no", "broker_prc_valid_until", "broker_firm", "default_agent_id"];

// Installing the admin as an app, with the steps for each kind of device; this device's first
const STEPS = {
  ios: ["iPhone or iPad", ["Open admin.heirestates.com in Safari.", "Tap the Share button (the square with an arrow pointing up).", "Scroll down and tap Add to Home Screen, then Add."]],
  android: ["Android phone", ["Open admin.heirestates.com in Chrome.", "Tap Install app below, or the ⋮ menu → Install app (or Add to Home screen).", "Tap Install."]],
  desktop: ["Windows or Mac, in Chrome or Edge", ["Click Install app below, or the install icon at the right of the address bar.", "Or open the browser menu → Cast, save and share → Install page as app (Chrome), or Apps → Install this site as an app (Edge)."]],
  "mac-safari": ["Mac, in Safari", ["Open the File menu (or the Share button) → Add to Dock.", "Click Add."]],
};

function InstallApp() {
  const install = useInstall();
  const here = device();
  const box = useRef(null);
  useEffect(() => {
    if (location.hash === "#install") box.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  const order = [here, ...Object.keys(STEPS).filter((k) => k !== here)];
  return (
    <section ref={box} id="install" className={`${card} grid scroll-mt-6 gap-4 p-5`} aria-labelledby="install-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="install-title" className="font-display text-xl text-ink">Install the app</h2>
          <p className="mt-1 max-w-prose text-sm text-muted">
            The admin installs like an app: its own icon on the home screen or dock, its own window, and it opens fast. Sign-in and every change work exactly as in the browser.
          </p>
        </div>
        {install.installed ? (
          <span className="rounded-full bg-emerald-600/12 px-3 py-1 text-sm font-medium text-emerald-800">Installed on this device</span>
        ) : (
          install.canPrompt && (
            <button type="button" className={btn} onClick={() => install.prompt().then((ok) => ok && toast("Installed. Open it from your home screen or apps."))}>
              <Download className="size-4" aria-hidden /> Install app
            </button>
          )
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {order.map((k, i) => (
          <div key={k} className={`rounded-lg border p-4 ${i === 0 ? "border-gold bg-gold/8" : "border-line"}`}>
            <p className="text-sm font-semibold text-fg">
              {STEPS[k][0]}
              {i === 0 && <span className="label ml-2 text-gold-ink">This device</span>}
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-charcoal">
              {STEPS[k][1].map((s) => <li key={s}>{s}</li>)}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}

// Everything, as CSV (contract 8.5 and 11.4): each table in full, page by page
const everything = (table, select = "*") => every(() => supabase.from(table).select(select).order("id"));
const EXPORTS = [
  ["Listings", "listings"],
  ["Leads", "leads", "Holds people's personal details: keep the file safe and delete it when done."],
  ["Commission log", "commissions"],
];

// the effective date plus six months, on the same day of the month or that month's last day
function gratuityStart(date) {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  const last = new Date(Date.UTC(y, m + 6, 0)).getUTCDate();
  return new Date(Date.UTC(y, m + 5, Math.min(d, last))).toISOString().slice(0, 10);
}

function Section({ title, sub, children }) {
  return (
    <fieldset className={`${card} grid gap-4 p-5 sm:grid-cols-2`}>
      <legend className="sr-only">{title}</legend>
      <div className="sm:col-span-2">
        <h2 aria-hidden className="font-display text-xl text-ink">{title}</h2>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {children}
    </fieldset>
  );
}

// Notifications on this device (push.js)
function Alerts() {
  const { supported, on, busy, error, turnOn, turnOff } = usePush();

  return (
    <section className={`${card} grid gap-3 p-5`} aria-labelledby="alerts-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="alerts-title" className="font-display text-xl text-ink">Notifications</h2>
          <p className="mt-1 max-w-prose text-sm text-muted">
            Get an alert on this device when a task is given to you, a new inquiry comes in, a client messages on WhatsApp, or a reminder comes due. Turn it on for each phone and computer you use.
          </p>
        </div>
        {on === null ? null : on ? (
          <button type="button" className={btnGhost} onClick={turnOff} disabled={busy}>Turn off on this device</button>
        ) : (
          supported && <button type="button" className={btn} onClick={turnOn} disabled={busy}>{busy ? "Turning on…" : "Turn on notifications"}</button>
        )}
      </div>
      {on && <p className="text-sm font-medium text-emerald-800">On for this device</p>}
      {!supported && (
        <p className="text-sm text-charcoal">
          {device() === "ios" ? "On iPhone and iPad, install the app first (above), then open it from the home screen and turn notifications on here." : "This browser can't receive notifications. Try Chrome, Edge, Firefox or Safari."}
        </p>
      )}
      <ErrorNote error={error} />
    </section>
  );
}

export default function Settings() {
  const [s, setS] = useState(null);
  const [saved, setSaved] = useState(null);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [exportError, setExportError] = useState(""); // shown by the Download buttons, not atop the form
  const [exporting, setExporting] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([run(supabase.from("settings").select("key, value")), run(supabase.from("admin_users").select("id, name").eq("active", true).order("name"))]).then(([rows, u]) => {
      const v = Object.fromEntries(KEYS.map((k) => [k, rows.find((r) => r.key === k)?.value ?? ""]));
      setS(v);
      setSaved(v);
      setUsers(u);
    }, (e) => setError(e.message));
  }, []);

  if (!s)
    return (
      <>
        <PageHeader title="Settings" />
        <div className="mt-6 grid max-w-3xl gap-4">
          <ErrorNote error={error} />
          {!error && <Skeleton className="h-40 w-full" />}
        </div>
      </>
    );

  const set = (k) => (e) => setS({ ...s, [k]: e.target.value });
  const dirty = KEYS.some((k) => s[k] !== saved[k]);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      // only the settings that changed, so the activity log shows real changes
      const changed = KEYS.filter((k) => s[k].trim() !== saved[k]).map((key) => ({ key, value: s[key].trim() }));
      if (changed.length) await run(supabase.from("settings").upsert(changed));
      const next = { ...s, ...Object.fromEntries(changed.map((c) => [c.key, c.value])) };
      setS(next);
      setSaved(next);
      toast("Settings saved");
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  return (
    <>
      <PageHeader title="Settings" sub="Used across the admin and the public listing pages. Every change is kept in the activity log." />
      <form onSubmit={save} className="stagger mt-6 grid max-w-3xl gap-6">
        <ErrorNote error={error} />
        <Section title="Licensed broker" sub="Shown on every public listing page. Listings can't be published until the name and licence no. are in.">
          <Field label="Broker's name">
            <input value={s.broker_name} onChange={set("broker_name")} maxLength={120} className={input} />
          </Field>
          <Field label="PRC licence no.">
            <input value={s.broker_prc_no} onChange={set("broker_prc_no")} maxLength={40} className={input} />
          </Field>
          <Field label="Licence valid until">
            <input type="date" value={s.broker_prc_valid_until} onChange={set("broker_prc_valid_until")} className={input} />
          </Field>
          <Field label="Brokerage">
            <input value={s.broker_firm} onChange={set("broker_firm")} maxLength={120} className={input} />
          </Field>
        </Section>

        <Section title="Inquiries">
          <Field label="Default agent" hint="Gets new inquiries no one else is assigned to">
            <Select value={s.default_agent_id} onChange={set("default_agent_id")} className={input}>
              <option value="">Not set</option>
              {users.map((u) => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
            </Select>
          </Field>
        </Section>

        <Section title="Contract">
          <Field label="Contract effective date">
            <input type="date" value={s.contract_effective_date} onChange={set("contract_effective_date")} className={input} />
          </Field>
          <Field label="Gratuity start" hint="Six months after the effective date">
            <output className={`${input} block min-h-[38px] bg-sunken/60 tabular-nums`}>{gratuityStart(s.contract_effective_date) || "—"}</output>
          </Field>
        </Section>

        <div className={dirty ? "sticky bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+0.75rem)]" : ""}>
          <button className={`${btn} shadow-[0_8px_24px_-8px_rgb(12_21_38/0.5)]`} disabled={busy || !dirty}>
            {busy ? "Saving…" : "Save settings"}
          </button>
        </div>
      </form>
      <div className="mt-6 grid max-w-3xl gap-6">
        <InstallApp />
        <Alerts />
        <Section title="Export all data" sub="Every listing, lead and commission row, as CSV files that open in Excel or Google Sheets.">
          <div className="sm:col-span-2">
            <ErrorNote error={exportError} />
          </div>
          {EXPORTS.map(([label, table, warn]) => (
            <div key={table} className="flex items-center justify-between gap-3 sm:col-span-2">
              <span className="text-sm">
                <span className="font-medium text-fg">{label}</span>
                {warn && <span className="block text-xs text-muted">{warn}</span>}
              </span>
              <button
                type="button"
                className={btnGhost}
                disabled={exporting === table}
                onClick={async () => {
                  setExportError("");
                  setExporting(table);
                  try {
                    const rows = await everything(table);
                    download(`heir-estates-${table}-${new Date().toISOString().slice(0, 10)}.csv`, rows.length ? toCsv(rows, Object.keys(rows[0])) : "none");
                  } catch (e) {
                    setExportError(`${label}: ${e.message}`);
                  }
                  setExporting("");
                }}
              >
                {exporting === table ? "Preparing…" : "Download"}
              </button>
            </div>
          ))}
        </Section>
      </div>
    </>
  );
}
