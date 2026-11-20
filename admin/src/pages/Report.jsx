import { ChevronLeft, Download, Printer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { supabase, run } from "../supabase";
import { useMe } from "../me";
import { SkeletonRows } from "../motion";
import { ErrorNote, Field, btn, btnGhost, card, input } from "../ui";
import { toCsv, download } from "../csv";
import { money, day, whereOf } from "./Commissions";
import { annexB } from "../annexb";

// last month, as YYYY-MM: the report goes out by the 5th for the month before
const lastMonth = () => {
  const d = new Date();
  d.setDate(0);
  return d.toISOString().slice(0, 7);
};
const label = (m) => new Date(`${m}-01T12:00:00`).toLocaleDateString("en-PH", { month: "long", year: "numeric" });

export default function Report() {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const month = /^\d{4}-\d{2}$/.test(params.get("month") ?? "") ? params.get("month") : lastMonth();
  const [all, setAll] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    run(supabase.from("commissions").select("id, sale_date, received_on, project, listing_id, unit_code, gross, cancelled, listing:listings(title)")).then(setAll, (e) => setError(e.message));
  }, []);

  const rows = useMemo(() => (all ? annexB(all, month) : []), [all, month]);
  const total = rows.filter((r) => r.paid).reduce((s, r) => s + Number(r.gross), 0);
  const sent = new Date().toLocaleDateString("en-PH", { dateStyle: "medium" });

  const csv = () =>
    download(
      `annex-b-${month}.csv`,
      [
        `Month covered,${label(month)}`,
        `Prepared by,${me.name}`,
        `Date sent,${sent}`,
        "",
        rows.length
          ? toCsv(
              [...rows, { total: true }],
              [
                ["Date of sale", (r) => (r.total ? "Total" : r.sale_date)],
                ["Paid on", (r) => (r.paid ? r.received_on : "")],
                ["Project", (r) => (r.total ? "" : whereOf(r))],
                ["Unit code", (r) => r.unit_code ?? ""],
                ["Sale no. in Season", () => ""],
                ["Gross commission", (r) => (r.total ? total.toFixed(2) : r.paid ? Number(r.gross).toFixed(2) : "")],
                ["Fee due (1% / 8.5%)", () => ""],
              ]
            )
          : "none",
      ].join("\r\n")
    );

  return (
    <>
      <div className="print:hidden">
        <Link to="/commissions" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
          <ChevronLeft className="size-4" aria-hidden />
          Commissions
        </Link>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Field label="Month">
            <input type="month" value={month} onChange={(e) => e.target.value && setParams({ month: e.target.value }, { replace: true })} className={`${input} w-48`} />
          </Field>
          <button className={`${btnGhost} ml-auto`} onClick={csv} disabled={!all}>
            <Download className="size-4" aria-hidden /> CSV
          </button>
          <button className={btn} onClick={() => print()} disabled={!all}>
            <Printer className="size-4" aria-hidden /> Print or save as PDF
          </button>
        </div>
        <p className="mt-3 max-w-prose text-sm text-muted">
          Annex B, for the report due by the 5th: every sale made in the month and every commission received in it. The sale number and fee columns are left blank to fill in.
        </p>
        <div className="mt-3">
          <ErrorNote error={error} />
        </div>
      </div>

      <article className={`${card} mt-6 max-w-5xl p-6 print:mt-0 print:max-w-none print:border-0 print:p-0 print:shadow-none`}>
        <h1 className="font-display text-2xl text-ink">Annex B. Monthly sales and fee report</h1>
        <p className="mt-1 text-sm">
          Month covered: <b>{label(month)}</b> · Prepared by: <b>{me.name}</b> · Date sent: <b>{sent}</b>
        </p>
        {!all ? (
          <SkeletonRows n={3} />
        ) : !rows.length ? (
          <p className="mt-6 font-display text-xl text-ink">none</p>
        ) : (
          <div className="mt-5 overflow-x-auto print:overflow-visible">
          <table className="w-full text-sm">
            <thead className="border-b border-ink/30 text-left">
              <tr>
                {["Date of sale", "Paid on", "Project", "Unit code", "Sale no. in Season", "Gross commission", "Fee due (1% / 8.5%)"].map((h, i) => (
                  <th key={h} className={`px-2 py-2 font-semibold text-fg ${i >= 4 ? "text-right" : ""}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-2 py-2 whitespace-nowrap">{day(r.sale_date)}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{r.paid ? day(r.received_on) : ""}</td>
                  <td className="px-2 py-2">{whereOf(r)}</td>
                  <td className="px-2 py-2">{r.unit_code}</td>
                  <td className="px-2 py-2" />
                  <td className="px-2 py-2 text-right tabular-nums">{r.paid ? money(r.gross) : ""}</td>
                  <td className="px-2 py-2" />
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-ink">
              <tr>
                <th className="px-2 py-2 text-left">Total</th>
                <td colSpan={4} />
                <td className="px-2 py-2 text-right font-semibold tabular-nums">{money(total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
          </div>
        )}
        <p className="mt-5 text-xs text-muted">
          No buyer names or personal details are entered in this report. If no commission was received this month, write "none". Sent by email under Section 14.4.
        </p>
      </article>
    </>
  );
}
