// A lead added by hand (someone who wrote on WhatsApp, Rent.ph, Filipino Homes, Facebook, a
// referral or a walk-in), or any lead's details corrected. What they're looking for follows the
// team's CLF sheet: type, place, budget, furnishing, when.
import { useState } from "react";
import { supabase, run } from "../supabase";
import { toast } from "../motion";
import { ErrorNote, Field, btn, input } from "../ui";
import { CATEGORIES, SOURCES } from "../crm";

const TEXT = { name: 100, mobile: 40, email: 254, interest: 120, property_type: 200, location: 300, budget: 80, furnishing: 200, target_date: 120, message: 2000 };
const WANTS = { "pre-selling": ["Buying pre-selling", "Buying ready for occupancy"], rentals: ["For Rent"], brokerage: ["For Sale", "For Assume", "Selling their property"] };

export default function LeadForm({ lead, onSaved }) {
  const isNew = !lead.id;
  const [f, setF] = useState(() => ({
    ...Object.fromEntries(Object.keys(TEXT).map((k) => [k, lead[k] ?? ""])),
    category: lead.category ?? "pre-selling",
    source_site: lead.source_site ?? "whatsapp",
  }));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const handAdded = isNew || lead.source_site in SOURCES; // a site's form keeps its source

  async function save(e) {
    e.preventDefault();
    setError("");
    const out = Object.fromEntries(Object.keys(TEXT).map((k) => [k, f[k].trim() || null]));
    out.mobile ??= "";
    out.email = out.email?.toLowerCase() ?? null;
    if (!out.mobile && !out.email) return setError("Add a mobile number or an email, so the team can reach them.");
    out.category = f.category;
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
        <Field label="Kind">
          <select value={f.category} onChange={set("category")} className={input}>
            {Object.entries(CATEGORIES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
        </Field>
        {handAdded && (
          <Field label="Came from">
            <select value={f.source_site} onChange={set("source_site")} className={input}>
              {Object.entries(SOURCES).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </select>
          </Field>
        )}
        <Field label="Name">
          <input value={f.name} onChange={set("name")} required minLength={2} maxLength={100} autoComplete="off" className={input} />
        </Field>
        <Field label="Mobile">
          <input type="tel" value={f.mobile} onChange={set("mobile")} maxLength={40} placeholder="0917 123 4567" className={input} />
        </Field>
        <Field label="Email">
          <input type="email" value={f.email} onChange={set("email")} maxLength={254} className={input} />
        </Field>
        <Field label="Looking to">
          <input value={f.interest} onChange={set("interest")} maxLength={120} list="lead-wants" className={input} />
          <datalist id="lead-wants">
            {WANTS[f.category].map((w) => <option key={w} value={w} />)}
          </datalist>
        </Field>
      </div>

      <h3 className="mt-2 font-display text-lg text-ink">What they're looking for</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Property type">
          <input value={f.property_type} onChange={set("property_type")} maxLength={200} placeholder="1BR Condo, House & Lot 3BR, Lot…" className={input} />
        </Field>
        <Field label="Where">
          <input value={f.location} onChange={set("location")} maxLength={300} placeholder="Near IT Park, Talisay…" className={input} />
        </Field>
        <Field label="Budget">
          <input value={f.budget} onChange={set("budget")} maxLength={80} placeholder={f.category === "rentals" ? "₱45,000/mo max" : "₱5M–₱8M"} className={input} />
        </Field>
        <Field label="Furnishing">
          <input value={f.furnishing} onChange={set("furnishing")} maxLength={200} list="lead-furnishing" className={input} />
          <datalist id="lead-furnishing">
            {["Fully furnished", "Semi-furnished", "Unfurnished", "Any"].map((w) => <option key={w} value={w} />)}
          </datalist>
        </Field>
        <Field label="When">
          <input value={f.target_date} onChange={set("target_date")} maxLength={120} placeholder="Move in by January 2027" className={input} />
        </Field>
      </div>
      <Field label="Notes" hint="Specs, must-haves, occupants, pets, anything else they said">
        <textarea value={f.message} onChange={set("message")} rows={4} maxLength={2000} className={input} />
      </Field>
      <button className={btn} disabled={busy}>{busy ? "Saving…" : isNew ? "Add lead" : "Save"}</button>
    </form>
  );
}
