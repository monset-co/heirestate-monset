import { useEffect, useState } from "react";
import { supabase, run } from "../supabase";
import { toast } from "../motion";
import { ErrorNote, Field, btn, card, input } from "../ui";
import { STATUSES, TYPES } from "../../../src/listings/types.js";
import { shape, check } from "../../../src/listings/rules.js";
import { order, projects } from "../../../src/projects.js";

const EMPTY = { title: "", slug: "", type: "project_unit", project: "", location: "", price_min: "", price_max: "", unit_type: "", floor_area: "", description: "", status: "available", lts_no: "", owner_authority: false, published: false, agent_id: "" };
// the form holds strings; shape() turns them back into the columns' numbers and nulls
const toForm = (l) => Object.fromEntries(Object.keys(EMPTY).map((k) => [k, typeof EMPTY[k] === "boolean" ? !!l[k] : l[k] == null ? "" : String(l[k])]));

function Section({ title, children }) {
  return (
    <fieldset className={`${card} grid gap-4 p-5 sm:grid-cols-2`}>
      <legend className="sr-only">{title}</legend>
      <h2 aria-hidden className="font-display text-xl text-ink sm:col-span-2">{title}</h2>
      {children}
    </fieldset>
  );
}

// The listing's details tab: everything but its photos.
export default function ListingForm({ listing, onSaved }) {
  const [f, setF] = useState(() => toForm(listing));
  const [users, setUsers] = useState([]);
  const [broker, setBroker] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      run(supabase.from("admin_users").select("id, name").eq("active", true).order("name")),
      run(supabase.from("settings").select("key, value").in("key", ["broker_name", "broker_prc_no"])),
    ]).then(([u, b]) => {
      setUsers(u);
      setBroker(Object.fromEntries(b.map((r) => [r.key, r.value])));
    }, (e) => setError(e.message));
  }, []);

  const t = TYPES[f.type];
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const dirty = JSON.stringify(f) !== JSON.stringify(toForm(listing));

  async function save(e) {
    e.preventDefault();
    setError("");
    const l = shape(f, listing);
    const why = check(l, listing, broker, order);
    if (why) return setError(why);
    setBusy(true);
    try {
      const row = await run(supabase.from("listings").update(l).eq("id", listing.id).select().single());
      onSaved(row);
      setF(toForm(row));
      toast(row.published && !listing.published ? "Published. It's on the sites within a minute." : "Saved");
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  // what still stands between this listing and the sites
  const missing = [
    t.project && !f.lts_no.trim() && "the DHSUD License to Sell no.",
    !t.project && !f.owner_authority && "the owner's authority on file",
    (!broker.broker_name || !broker.broker_prc_no) && "the broker's details in Settings",
  ].filter(Boolean);

  return (
    <form onSubmit={save} className="stagger grid max-w-3xl gap-6">
      <ErrorNote error={error} />

      <Section title="The listing">
        <div className="sm:col-span-2">
          <Field label="Title">
            <input value={f.title} onChange={set("title")} required minLength={2} maxLength={150} className={input} />
          </Field>
        </div>
        <Field label="Type">
          <select value={f.type} onChange={set("type")} className={input}>
            {Object.entries(TYPES).map(([k, x]) => <option key={k} value={k}>{x.label}</option>)}
          </select>
        </Field>
        {t.project ? (
          <Field label="Project" hint={f.type === "rfo_unit" ? "Leave empty for an RFO unit outside these projects" : undefined}>
            <select value={f.project} onChange={set("project")} required={f.type === "project_unit"} className={input}>
              <option value="">{f.type === "rfo_unit" ? "None" : "Choose a project"}</option>
              {order.map((id) => <option key={id} value={id}>{projects[id].name}</option>)}
            </select>
          </Field>
        ) : (
          <div className="hidden sm:block" />
        )}
        <Field label="Address on the site" hint={listing.published_at ? "Fixed once published, so links keep working" : "Made from the title if left empty"}>
          <input value={f.slug} onChange={set("slug")} disabled={!!listing.published_at} pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80} className={input} />
        </Field>
        <Field label="Location">
          <input value={f.location} onChange={set("location")} maxLength={200} className={input} />
        </Field>
      </Section>

      <Section title="Price and unit">
        <Field label={f.type === "rental" ? "Monthly rent (₱)" : "Price (₱)"} hint="Leave empty for “Price on request”">
          <input value={f.price_min} onChange={set("price_min")} inputMode="numeric" pattern="\d*" className={`${input} tabular-nums`} />
        </Field>
        <Field label="Up to (₱)" hint="For a price range only">
          <input value={f.price_max} onChange={set("price_max")} inputMode="numeric" pattern="\d*" className={`${input} tabular-nums`} />
        </Field>
        <Field label="Unit type">
          <input value={f.unit_type} onChange={set("unit_type")} placeholder="Studio, 1 bedroom, 2 bedroom…" maxLength={80} className={input} />
        </Field>
        <Field label="Floor area (sqm)">
          <input value={f.floor_area} onChange={set("floor_area")} inputMode="decimal" pattern="\d*\.?\d*" className={`${input} tabular-nums`} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Description" hint="A blank line starts a new paragraph">
            <textarea value={f.description} onChange={set("description")} rows={7} maxLength={8000} className={input} />
          </Field>
        </div>
      </Section>

      <Section title="Status and publishing">
        <Field label="Status">
          <select value={f.status} onChange={set("status")} className={input}>
            {Object.entries(STATUSES).map(([k, s]) => <option key={k} value={k}>{s}</option>)}
          </select>
        </Field>
        <Field label="Agent" hint="Shown on the listing page; gets its inquiries">
          <select value={f.agent_id} onChange={set("agent_id")} className={input}>
            <option value="">None</option>
            {users.map((u) => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
          </select>
        </Field>
        {t.project ? (
          <Field label="DHSUD License to Sell no.">
            <input value={f.lts_no} onChange={set("lts_no")} maxLength={60} className={input} />
          </Field>
        ) : (
          <label className="flex items-center gap-3 self-end py-2 text-sm text-fg">
            <input type="checkbox" checked={f.owner_authority} onChange={set("owner_authority")} className="size-4 accent-navy" />
            The owner's authority to sell or lease is on file
          </label>
        )}
        <label className="flex items-center gap-3 self-end py-2 text-sm text-fg">
          <input type="checkbox" checked={f.published} onChange={set("published")} className="size-4 accent-navy" />
          Published on the sites
        </label>
        {f.published && missing.length > 0 && <p className="text-sm text-danger sm:col-span-2">To publish, add {missing.join(", ")}.</p>}
      </Section>

      {/* rides along the bottom of the screen only while there's something to save */}
      <div className={`flex items-center gap-4 ${dirty ? "sticky bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+0.75rem)]" : ""}`}>
        <button className={`${btn} shadow-[0_8px_24px_-8px_rgb(12_21_38/0.5)]`} disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save changes"}
        </button>
        {dirty && !busy && <span className="text-sm text-muted">Unsaved changes</span>}
      </div>
    </form>
  );
}
