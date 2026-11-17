// On a lead: the inventory that fits what they want (admin/src/match.js), best first. Each wish
// they named shows as a chip in its own colour when the property meets it, grey and struck through
// when it doesn't, so a glance says why a property is on the list.
import { Star } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { supabase, run } from "../supabase";
import { SkeletonRows, toast } from "../motion";
import { Empty, ErrorNote, btnGhost, card } from "../ui";
import { LOOKING_TO, fit, matches } from "../match";

const TONES = {
  navy: "bg-navy/10 text-navy",
  violet: "bg-violet-600/12 text-violet-800",
  sky: "bg-sky-600/12 text-sky-800",
  teal: "bg-teal-600/12 text-teal-800",
  emerald: "bg-emerald-600/12 text-emerald-800",
  gold: "bg-gold/25 text-gold-ink",
  burgundy: "bg-burgundy/12 text-burgundy",
  off: "bg-sunken text-muted/80 line-through decoration-muted/50",
};
export const Chip = ({ tone, children }) => <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;

// the wishes, in the colours the lead's "What they want" uses
const CRITERIA = [
  ["kind", "Type", "violet"],
  ["size", "Size", "violet"],
  ["area", "Where", "sky"],
  ["building", "Building", "teal"],
  ["near", "Near", "sky"],
  ["furnishing", "Furnishing", "emerald"],
  ["budget", "Budget", "gold"],
  ["when", "Free in time", "burgundy"],
];
const START = { "pre-selling": ["Pre-selling"], rentals: ["For Rent", "Rented"], brokerage: ["For Sale", "For Assume"] };
const peso = (n) => `₱${n.toLocaleString("en-PH")}`;

export default function Matches({ lead }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [all, setAll] = useState(false);
  const [priorities, setPriorities] = useState(lead.priorities ?? []);
  const [onlyPrio, setOnlyPrio] = useState(false);
  const statuses = lead.looking_to?.length ? lead.looking_to.flatMap((w) => LOOKING_TO[w] ?? []) : START[lead.category];
  const key = JSON.stringify([statuses, lead.property_types, lead.areas, lead.buildings, lead.furnishings, lead.budget_max, lead.needed_by, lead.near, lead.near_km]);

  useEffect(() => {
    if (!statuses.length) return setList([]);
    run(supabase.from("inventory").select("id, status, type, location, building, price, price_text, furnishing, available, available_from, lat, lng, geo").overlaps("status", statuses)).then(
      setRows,
      (e) => setError(e.message)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const list = useMemo(() => rows && matches({ ...lead, priorities }, rows, 50, onlyPrio && priorities.length > 0), [rows, priorities, onlyPrio, lead]);
  // a wish counts as asked when they named it; "Free in time" always applies
  const named = fit(lead, { status: [], type: "", location: "" }); // which wishes are null depends only on the lead
  const asked = CRITERIA.filter(([k]) => named[k] !== null);

  // star a wish to make it a priority; saved on the lead, so the whole team sees the same order
  async function star(k) {
    const next = priorities.includes(k) ? priorities.filter((x) => x !== k) : [...priorities, k];
    setPriorities(next);
    try {
      await run(supabase.from("leads").update({ priorities: next }).eq("id", lead.id));
    } catch (e) {
      setPriorities(priorities);
      setError(e.message);
      return;
    }
    toast(next.includes(k) ? `${CRITERIA.find((c) => c[0] === k)[1]} is a priority` : "Priority removed");
  }
  const shown = all ? list : list?.slice(0, 6);
  return (
    <section className="mt-6 max-w-5xl" aria-labelledby="matches-title">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 id="matches-title" className="font-display text-xl text-ink">
          Inventory that fits {list?.length ? <span className="font-body text-sm text-muted tabular-nums">· {list.length}</span> : null}
        </h2>
        {/* the legend: what the chips mean */}
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <Chip tone="sky">Fits</Chip>
          <Chip tone="off">Doesn't fit</Chip>
          <span>Only what they asked for is checked</span>
        </p>
      </div>
      <ErrorNote error={error} />
      {asked.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">What matters most:</span>
          {asked.map(([k, label]) => {
            const on = priorities.includes(k);
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() => star(k)}
                className={`press inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-150 ${on ? "border-gold bg-gold/20 text-gold-ink" : "border-line bg-surface text-muted hover:text-fg"}`}
              >
                <Star aria-hidden className={`size-3.5 transition-transform duration-200 ${on ? "scale-110 fill-gold text-gold" : ""}`} /> {label}
              </button>
            );
          })}
          {priorities.length > 0 && (
            <label className="ml-auto flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" checked={onlyPrio} onChange={(e) => setOnlyPrio(e.target.checked)} className="size-4 accent-navy" /> Only ones that meet every priority
            </label>
          )}
        </div>
      )}
      <div className={`${card} mt-3`}>
        {!list ? (
          <SkeletonRows n={3} />
        ) : !list.length ? (
          <Empty>{onlyPrio ? "Nothing meets every priority. Untick “Only ones that meet every priority” to see the closest." : statuses.length ? "Nothing on offer fits yet. Widen what they want, or check back as inventory comes in." : "They're selling or leasing out: there's nothing to match. Add their property to the Inventory."}</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map(({ p, f }) => (
              <li key={p.id}>
                <Link to={`/inventory?open=${p.id}`} className="group grid gap-2 px-4 py-3 text-sm transition-colors hover:bg-bg sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-fg group-hover:text-accent-ink">{p.type || "Property"}</p>
                    <p className="truncate text-xs text-muted">
                      {f.km != null && <span className="font-medium text-fg tabular-nums">{f.km.toFixed(1)} km{p.geo === "approx" ? " ≈" : ""} from {lead.near} · </span>}
                      {p.location}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {asked.filter(([k]) => f[k] !== null).map(([k, label, tone]) => (
                        <Chip key={k} tone={f[k] ? tone : "off"}>
                          {priorities.includes(k) && <Star aria-label="priority" className="mr-0.5 size-3 fill-current" />}
                          {label}
                        </Chip>
                      ))}
                    </div>
                  </div>
                  <div className="text-right tabular-nums">
                    <p className="font-medium text-fg">{p.price != null ? peso(p.price) : p.price_text ?? "—"}</p>
                    <p className="text-xs text-muted">{f.score} of {asked.filter(([k]) => f[k] !== null).length} wishes</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      {list?.length > 6 && (
        <button type="button" className={`${btnGhost} mt-3`} onClick={() => setAll(!all)}>
          {all ? "Show the best 6" : `Show all ${list.length}`}
        </button>
      )}
    </section>
  );
}
