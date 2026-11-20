// A lead added by hand (someone who wrote on WhatsApp, Rent.ph, Filipino Homes, Facebook, a
// referral or a walk-in), or any lead's details corrected. What they want is picked from fixed
// choices (admin/src/match.js), never typed, so the lead can be matched against the inventory and
// the same wish always reads the same way.
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { supabase, run, every } from "../supabase";
import { toast } from "../motion";
import { ErrorNote, Field, Select, btn, input } from "../ui";
import { CATEGORIES, SOURCES, peso } from "../crm";
import { AREAS, FURNISHING, KINDS, LANDMARKS, LOOKING_TO, RADII, SIZES, pesos, tidyMobile } from "../match";

const START = { "pre-selling": ["Buy pre-selling"], rentals: ["Rent"], brokerage: ["Buy resale"] };
// Looking to leads, Kind follows: the kind (Leads sub-tab) each wish belongs to
const KIND_OF = { Rent: "rentals", "Buy resale": "brokerage", "Buy pre-selling": "pre-selling", "Assume balance": "brokerage", "Sell or lease out": "brokerage" };
// keep the kind while it still fits one of the wishes; otherwise the first wish's
export const kindFor = (lookingTo, kind) => {
  const kinds = lookingTo.map((w) => KIND_OF[w]).filter(Boolean);
  return !kinds.length || kinds.includes(kind) ? kind : kinds[0];
};

// Someone who's already a lead with this mobile (its last 10 digits, however it's written) or this
// email, so a second lead for the same person isn't made by mistake. It warns; it doesn't stop.
export function useSameLead(mobile, email, except) {
  const [hit, setHit] = useState(null);
  useEffect(() => {
    const d = String(mobile ?? "").replace(/\D/g, "").slice(-10);
    const e = String(email ?? "").trim().toLowerCase();
    const ors = [d.length >= 9 && `mobile.ilike.*${d.split("").join("*")}`, /^[^\s@",()]+@[^\s@",()]+\.[^\s@",()]+$/.test(e) && `email.eq."${e}"`].filter(Boolean);
    if (!ors.length) return setHit(null);
    let live = true; // typing on: an older answer can't overwrite a newer one
    const t = setTimeout(() => run(supabase.from("leads").select("id, name").or(ors.join(",")).neq("id", except ?? 0).limit(1)).then((r) => live && setHit(r[0] ?? null), () => live && setHit(null)), 400);
    return () => ((live = false), clearTimeout(t));
  }, [mobile, email, except]);
  return hit;
}
export const SameLead = ({ lead, className = "" }) =>
  lead && (
    <p role="status" className={`rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-sm text-fg ${className}`}>
      Already a lead: <Link to={`/leads/${lead.id}`} className="font-medium underline underline-offset-2">{lead.name}</Link>. Open them instead of adding them again?
    </p>
  );

export default function LeadForm({ lead, onSaved }) {
  const isNew = !lead.id;
  const category = lead.category ?? "pre-selling";
  const [f, setF] = useState(() => ({
    name: lead.name ?? "",
    mobile: lead.mobile ?? "",
    email: lead.email ?? "",
    message: lead.message ?? "",
    category,
    source_site: lead.source_site ?? "whatsapp",
    looking_to: lead.looking_to?.length ? lead.looking_to : isNew ? START[category] : [],
    property_types: lead.property_types ?? [],
    areas: lead.areas ?? [],
    buildings: lead.buildings ?? [],
    furnishings: lead.furnishings ?? [],
    budget: lead.budget_max ? peso(lead.budget_max) : "",
    needed_by: lead.needed_by ?? "",
    near: lead.near ?? "",
    near_km: lead.near_km ? String(lead.near_km) : "2",
  }));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // the buildings in the inventory today: a new one there is a choice here at once
  const [buildings, setBuildings] = useState([]);
  useEffect(() => {
    every(() => supabase.from("inventory").select("building").not("building", "is", null).order("id")).then(
      (rows) => setBuildings([...new Set(rows.map((r) => r.building))].sort((a, b) => a.localeCompare(b))),
      () => {}
    );
  }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const handAdded = isNew || lead.source_site in SOURCES; // a site's form keeps its source
  const budget = pesos(f.budget);
  const same = useSameLead(f.mobile, f.email, lead.id);
  const mobile = f.mobile.trim() ? tidyMobile(f.mobile) : "";

  async function save(e) {
    e.preventDefault();
    setError("");
    if (mobile === null) return setError("That mobile number doesn't look right. Use 0917 123 4567, or + and the country code for numbers abroad.");
    if (f.budget.trim() && budget === null) return setError("Write the budget as an amount: 45000, 45k or 1.5M.");
    const out = {
      name: f.name.trim(),
      mobile: mobile ?? "",
      email: f.email.trim().toLowerCase() || null,
      message: f.message.trim() || null,
      category: f.category,
      looking_to: f.looking_to,
      property_types: f.property_types,
      areas: f.areas,
      buildings: f.buildings,
      furnishings: f.furnishings,
      budget_max: budget,
      needed_by: f.needed_by || null,
      near: f.near || null,
      near_km: f.near ? Number(f.near_km) : null,
    };
    if (handAdded) out.source_site = f.source_site;
    setBusy(true);
    try {
      const q = isNew ? supabase.from("leads").insert(out) : supabase.from("leads").update(out).eq("id", lead.id);
      const row = await run(q.select().single());
      toast(isNew ? `${row.name} added` : "Saved");
      onSaved(row);
    } catch (err) {
      setError(/lead_lengths/.test(err.message) ? "The name needs at least 2 letters." : err.message);
    }
    setBusy(false);
  }

  return (
    <form onSubmit={save} className="grid gap-4">
      <ErrorNote error={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Looking to">
          <Select multiple value={f.looking_to} onChange={(e) => setF({ ...f, looking_to: e.target.value, category: kindFor(e.target.value, f.category) })} placeholder="Choose…" className={input}>
            {Object.keys(LOOKING_TO).map((k) => <option key={k} value={k}>{k}</option>)}
          </Select>
        </Field>
        <Field label="Kind" hint="Follows Looking to. Change it if this lead belongs in another tab.">
          <Select value={f.category} onChange={set("category")} className={input}>
            {Object.entries(CATEGORIES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </Select>
        </Field>
        {handAdded && (
          <Field label="Came from">
            <Select value={f.source_site} onChange={set("source_site")} className={input}>
              {Object.entries(SOURCES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Name">
          <input value={f.name} onChange={set("name")} required minLength={2} maxLength={100} autoComplete="off" className={input} />
        </Field>
        <Field label="Mobile (optional)" hint={mobile ? `Saved as ${mobile}` : mobile === null ? "Not a mobile number yet" : "0917 123 4567, or + and the country code. Can be added later."}>
          <input type="tel" inputMode="tel" value={f.mobile} onChange={set("mobile")} onBlur={() => mobile && setF({ ...f, mobile })} maxLength={40} className={`${input} tabular-nums`} />
        </Field>
        <Field label="Email (optional)" hint="Can be added later.">
          <input type="email" inputMode="email" autoComplete="off" value={f.email} onChange={set("email")} maxLength={254} className={input} />
        </Field>
        <SameLead lead={same} className="sm:col-span-2" />
      </div>

      <h3 className="mt-2 font-display text-lg text-ink">What they want</h3>
      <p className="-mt-2 text-xs text-muted">Pick as many as fit. The lead's Overview lists the inventory that matches.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Property type">
          <Select multiple value={f.property_types} onChange={set("property_types")} placeholder="Any" className={input}>
            <optgroup label="Kind">{Object.keys(KINDS).map((k) => <option key={k} value={k}>{k}</option>)}</optgroup>
            <optgroup label="Size">{Object.keys(SIZES).map((k) => <option key={k} value={k}>{k}</option>)}</optgroup>
          </Select>
        </Field>
        <Field label="Where">
          <Select multiple value={f.areas} onChange={set("areas")} placeholder="Anywhere" className={input}>
            {Object.entries(AREAS).map(([g, list]) => (
              <optgroup key={g} label={g}>{Object.keys(list).map((k) => <option key={k} value={k}>{k}</option>)}</optgroup>
            ))}
                    </Select>
        </Field>
        <Field label="Building" hint="A condo or development they prefer">
          <Select multiple value={f.buildings} onChange={set("buildings")} placeholder={buildings.length ? "Any" : "No buildings in the inventory yet"} className={input}>
            {[...new Set([...buildings, ...f.buildings])].sort((a, b) => a.localeCompare(b)).map((b) => <option key={b} value={b}>{b}</option>)}
          </Select>
        </Field>
        <Field label="Near" hint="A place they want to be close to">
          <Select value={f.near} onChange={set("near")} className={input}>
            <option value="">Nowhere in particular</option>
            {Object.entries(LANDMARKS).map(([g, list]) => (
              <optgroup key={g} label={g}>{Object.keys(list).map((k) => <option key={k} value={k}>{k}</option>)}</optgroup>
            ))}
          </Select>
        </Field>
        <Field label="Within">
          <Select value={f.near_km} onChange={set("near_km")} disabled={!f.near} className={input}>
            {RADII.map((k) => <option key={k} value={String(k)}>{k < 1 ? `${k * 1000} m` : `${k} km`}</option>)}
          </Select>
        </Field>
        <Field label="Furnishing">
          <Select multiple value={f.furnishings} onChange={set("furnishings")} placeholder="Any" className={input}>
            {FURNISHING.map((k) => <option key={k} value={k}>{k}</option>)}
          </Select>
        </Field>
        <Field label={f.looking_to.includes("Rent") ? "Budget a month, at most" : "Budget, at most"} hint={budget ? peso(budget) : "45000, 45k or 1.5M"}>
          <span className="relative block">
            <span aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted">₱</span>
            <input inputMode="decimal" value={f.budget.replace(/^₱/, "")} onChange={set("budget")} onBlur={() => budget && setF({ ...f, budget: peso(budget) })} className={`${input} pl-7 tabular-nums`} />
          </span>
        </Field>
        <Field label="Needed by" hint="Move-in or purchase date">
          <input type="date" value={f.needed_by} onChange={set("needed_by")} className={input} />
        </Field>
      </div>
      <Field label="Notes" hint="Must-haves, occupants, pets, anything else they said">
        <textarea value={f.message} onChange={set("message")} rows={4} maxLength={2000} className={input} />
      </Field>
      <button className={btn} disabled={busy}>{busy ? "Saving…" : isNew ? "Add lead" : "Save"}</button>
    </form>
  );
}
