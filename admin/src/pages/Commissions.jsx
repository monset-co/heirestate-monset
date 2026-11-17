import { FileText, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { supabase, run } from "../supabase";
import { Live, LiveTr, SkeletonRows, toast } from "../motion";
import { Badge, Empty, ErrorNote, Field, Modal, PageHeader, btn, btnGhost, card, input, th, Select } from "../ui";
import { order, projects } from "../../../src/projects.js";

export const MODES = { full_cash: "Full cash", bank_financing: "Bank financing", installment: "Installment" };
const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
export const money = (n) => (n == null ? "—" : peso.format(n));
export const day = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-PH", { dateStyle: "medium" }) : "—");
// a row's project or listing, as people say it
export const whereOf = (c) => projects[c.project]?.name ?? c.listing?.title ?? c.project ?? "—";

const COLS = "id, sale_date, received_on, project, listing_id, unit_code, via_sites, payment_mode, release, gross, cancelled, listing:listings(title)";

// The commission log: each sale, and each release of commission on it, for the Annex B report.
// No buyer details, and no fees worked out here.
export default function Commissions() {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // a row, a new row's starting values, or null
  const load = () => run(supabase.from("commissions").select(COLS).order("sale_date", { ascending: false }).order("id", { ascending: false })).then(setList, (e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const year = new Date().getFullYear();
  const totals = useMemo(() => {
    const rows = (list ?? []).filter((c) => !c.cancelled);
    const sales = new Set(rows.filter((c) => c.sale_date.startsWith(String(year))).map((c) => `${c.project ?? c.listing_id}:${c.unit_code}`));
    const received = rows.filter((c) => c.received_on?.startsWith(String(year))).reduce((s, c) => s + Number(c.gross), 0);
    return { sales: sales.size, received };
  }, [list]);

  return (
    <>
      <PageHeader title="Commissions" sub="Every sale, and every release of commission on it. No buyer names or personal details go here.">
        <Link to="/commissions/report" className={btnGhost}>
          <FileText className="size-4" aria-hidden /> Monthly report
        </Link>
        <button className={btn} onClick={() => setEditing({})}>
          <Plus className="size-4" aria-hidden /> Record a sale
        </button>
      </PageHeader>

      {list && (
        <dl className={`${card} mt-6 grid divide-line sm:grid-cols-2 sm:divide-x max-sm:divide-y`}>
          <div className="p-5">
            <dt className="label text-muted">Sales in {year}</dt>
            <dd className="mt-2 font-display text-3xl text-ink tabular-nums">{totals.sales}</dd>
          </div>
          <div className="p-5">
            <dt className="label text-muted">Commission received in {year}</dt>
            <dd className="mt-2 font-display text-3xl text-ink tabular-nums">{money(totals.received)}</dd>
          </div>
        </dl>
      )}

      <div className="mt-4">
        <ErrorNote error={error} />
      </div>
      <div className={`${card} mt-4 overflow-x-auto`}>
        {!list ? (
          <SkeletonRows />
        ) : !list.length ? (
          <Empty>No sales recorded yet.</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line">
              <tr>
                <th className={th}>Date of sale</th>
                <th className={th}>Unit</th>
                <th className={`${th} hidden md:table-cell`}>Payment</th>
                <th className={th}>Paid on</th>
                <th className={`${th} text-right`}>Gross</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              <Live>
                {list.map((c, i) => (
                  <LiveTr key={c.id} i={i} onClick={() => setEditing(c)} className={`cursor-pointer transition-colors hover:bg-bg ${c.cancelled ? "text-muted" : ""}`}>
                    <td className="px-4 py-3 whitespace-nowrap">{day(c.sale_date)}</td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-fg">{c.unit_code}</span>
                      <span className="block text-xs text-muted">
                        {whereOf(c)}
                        {c.via_sites && " · through the sites"}
                      </span>
                      {c.cancelled && <Badge value="lost">Cancelled</Badge>}
                    </td>
                    <td className="hidden px-4 py-3 text-muted md:table-cell">
                      {MODES[c.payment_mode]}
                      {c.release && ` · ${c.release} release`}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{c.received_on ? day(c.received_on) : <span className="text-muted">Not yet</span>}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">{money(c.gross)}</td>
                  </LiveTr>
                ))}
              </Live>
            </tbody>
          </table>
        )}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "Commission" : "Record a sale"}>
        {editing && (
          <CommissionForm
            row={editing}
            onSaved={(msg) => {
              setEditing(null);
              load();
              toast(msg);
            }}
            onAnother={(base) => setEditing(base)}
          />
        )}
      </Modal>
    </>
  );
}

function CommissionForm({ row, onSaved, onAnother }) {
  const [f, setF] = useState({
    sale_date: row.sale_date ?? "",
    where: row.listing_id ? `listing:${row.listing_id}` : row.project ? `project:${row.project}` : "",
    unit_code: row.unit_code ?? "",
    via_sites: row.via_sites ?? true,
    payment_mode: row.payment_mode ?? "bank_financing",
    received_on: row.received_on ?? "",
    gross: row.gross ?? "",
    release: row.release ?? "",
    cancelled: row.cancelled ?? false,
  });
  const [listings, setListings] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    run(supabase.from("listings").select("id, title").is("project", null).order("title")).then(setListings, () => {});
  }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  async function save(e) {
    e.preventDefault();
    setError("");
    if (!f.where) return setError("Choose the project or listing");
    if (!!f.received_on !== (f.gross !== "")) return setError("Enter both the date the commission was paid and its amount, or neither");
    const [kind, ref] = f.where.split(":");
    const data = {
      sale_date: f.sale_date,
      project: kind === "project" ? ref : null,
      listing_id: kind === "listing" ? Number(ref) : null,
      unit_code: f.unit_code.trim(),
      via_sites: f.via_sites,
      payment_mode: f.payment_mode,
      received_on: f.received_on || null,
      gross: f.gross === "" ? null : Number(f.gross),
      release: f.received_on ? f.release || "full" : null,
      cancelled: f.cancelled,
    };
    setBusy(true);
    try {
      await run(row.id ? supabase.from("commissions").update(data).eq("id", row.id) : supabase.from("commissions").insert(data));
      onSaved(row.id ? "Saved" : "Sale recorded");
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <ErrorNote error={error} />
      </div>
      <Field label="Date of sale" hint="When the buyer signed">
        <input type="date" required value={f.sale_date} onChange={set("sale_date")} className={input} />
      </Field>
      <Field label="Unit code">
        <input required maxLength={60} value={f.unit_code} onChange={set("unit_code")} placeholder="T1-12F-05" className={input} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Project or listing">
          <Select required value={f.where} onChange={set("where")} className={input}>
            <option value="">Choose…</option>
            <optgroup label="Projects">
              {order.map((id) => <option key={id} value={`project:${id}`}>{projects[id].name}</option>)}
            </optgroup>
            {listings.length > 0 && (
              <optgroup label="Other listings">
                {listings.map((l) => <option key={l.id} value={`listing:${l.id}`}>{l.title}</option>)}
              </optgroup>
            )}
          </Select>
        </Field>
      </div>
      <Field label="Payment mode">
        <Select value={f.payment_mode} onChange={set("payment_mode")} className={input}>
          {Object.entries(MODES).map(([k, m]) => <option key={k} value={k}>{m}</option>)}
        </Select>
      </Field>
      <label className="flex items-center gap-3 self-end py-2 text-sm text-fg">
        <input type="checkbox" checked={f.via_sites} onChange={set("via_sites")} className="size-4 accent-navy" />
        Came through the sites
      </label>

      <fieldset className="grid gap-4 rounded-lg border border-line p-4 sm:col-span-2 sm:grid-cols-3">
        <legend className="label px-1 text-muted">Commission received</legend>
        <Field label="Paid on">
          <input type="date" value={f.received_on} onChange={set("received_on")} className={input} />
        </Field>
        <Field label="Gross (₱)" hint="Before withholding tax">
          <input inputMode="decimal" pattern="\d+(\.\d{1,2})?" value={f.gross} onChange={set("gross")} className={`${input} tabular-nums`} />
        </Field>
        <Field label="Release">
          <Select value={f.release} onChange={set("release")} className={input}>
            <option value="">Full</option>
            <option value="partial">Partial</option>
          </Select>
        </Field>
      </fieldset>

      <label className="flex items-center gap-3 text-sm text-fg sm:col-span-2">
        <input type="checkbox" checked={f.cancelled} onChange={set("cancelled")} className="size-4 accent-navy" />
        Cancelled before any commission was received
      </label>

      <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
        {row.id && (
          <button
            type="button"
            className={btnGhost}
            onClick={() => onAnother({ sale_date: row.sale_date, project: row.project, listing_id: row.listing_id, unit_code: row.unit_code, via_sites: row.via_sites, payment_mode: row.payment_mode, release: "partial" })}
          >
            Add another release
          </button>
        )}
        <button className={btn} disabled={busy}>{busy ? "Saving…" : row.id ? "Save" : "Record sale"}</button>
      </div>
    </form>
  );
}
