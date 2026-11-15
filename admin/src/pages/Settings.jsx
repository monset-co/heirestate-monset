import { useEffect, useState } from "react";
import { supabase, run } from "../supabase";
import { Skeleton, toast } from "../motion";
import { ErrorNote, Field, PageHeader, btn, btnGhost, card, input } from "../ui";
import { toCsv, download } from "../csv";

const KEYS = ["contract_effective_date", "broker_name", "broker_prc_no", "broker_prc_valid_until", "broker_firm", "default_agent_id"];

// Everything, as CSV (contract 8.5 and 11.4): each table in full, page by page
async function everything(table, select = "*") {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const page = await run(supabase.from(table).select(select).order("id").range(from, from + 999));
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}
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

export default function Settings() {
  const [s, setS] = useState(null);
  const [saved, setSaved] = useState(null);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
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
            <select value={s.default_agent_id} onChange={set("default_agent_id")} className={input}>
              <option value="">Not set</option>
              {users.map((u) => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
            </select>
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
        <Section title="Export all data" sub="Every listing, lead and commission row, as CSV files that open in Excel or Google Sheets.">
          {EXPORTS.map(([label, table, warn]) => (
            <div key={table} className="flex items-center justify-between gap-3 sm:col-span-2">
              <span className="text-sm">
                <span className="font-medium text-fg">{label}</span>
                {warn && <span className="block text-xs text-muted">{warn}</span>}
              </span>
              <button
                type="button"
                className={btnGhost}
                onClick={async () => {
                  try {
                    const rows = await everything(table);
                    download(`heir-estates-${table}-${new Date().toISOString().slice(0, 10)}.csv`, rows.length ? toCsv(rows, Object.keys(rows[0])) : "none");
                  } catch (e) {
                    setError(e.message);
                  }
                }}
              >
                Download
              </button>
            </div>
          ))}
        </Section>
      </div>
    </>
  );
}
