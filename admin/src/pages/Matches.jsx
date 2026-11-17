// On a lead: the inventory that fits what they want (admin/src/match.js), best first. Each wish
// they named shows as a chip in its own colour when the property meets it, grey and struck through
// when it doesn't, so a glance says why a property is on the list.
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { supabase, run } from "../supabase";
import { SkeletonRows } from "../motion";
import { Empty, ErrorNote, btnGhost, card } from "../ui";
import { LOOKING_TO, matches } from "../match";

const TONES = {
  navy: "bg-navy/10 text-navy",
  violet: "bg-violet-600/12 text-violet-800",
  sky: "bg-sky-600/12 text-sky-800",
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
  ["furnishing", "Furnishing", "emerald"],
  ["budget", "Budget", "gold"],
  ["when", "Free in time", "burgundy"],
];
const START = { "pre-selling": ["Pre-selling"], rentals: ["For Rent", "Rented"], brokerage: ["For Sale", "For Assume"] };
const peso = (n) => `₱${n.toLocaleString("en-PH")}`;

export default function Matches({ lead }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [all, setAll] = useState(false);
  const statuses = lead.looking_to?.length ? lead.looking_to.flatMap((w) => LOOKING_TO[w] ?? []) : START[lead.category];
  const key = JSON.stringify([statuses, lead.property_types, lead.areas, lead.furnishings, lead.budget_max, lead.needed_by]);

  useEffect(() => {
    if (!statuses.length) return setList([]);
    run(supabase.from("inventory").select("id, status, type, location, price, price_text, furnishing, available, available_from").overlaps("status", statuses)).then(
      (rows) => setList(matches(lead, rows, 50)),
      (e) => setError(e.message)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const asked = CRITERIA.filter(([k]) => list?.some((m) => m.f[k] !== null));
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
      <div className={`${card} mt-3`}>
        {!list ? (
          <SkeletonRows n={3} />
        ) : !list.length ? (
          <Empty>{statuses.length ? "Nothing on offer fits yet. Widen what they want, or check back as inventory comes in." : "They're selling or leasing out: there's nothing to match. Add their property to the Inventory."}</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map(({ p, f }) => (
              <li key={p.id}>
                <Link to={`/inventory?open=${p.id}`} className="group grid gap-2 px-4 py-3 text-sm transition-colors hover:bg-bg sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-fg group-hover:text-accent-ink">{p.type || "Property"}</p>
                    <p className="truncate text-xs text-muted">{p.location}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {asked.filter(([k]) => f[k] !== null).map(([k, label, tone]) => (
                        <Chip key={k} tone={f[k] ? tone : "off"}>{label}</Chip>
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
