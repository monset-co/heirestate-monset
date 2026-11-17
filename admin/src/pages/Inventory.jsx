// Inventory: every property the team can offer, from owners and other brokers (supabase/migrations
// …_inventory.sql), in tabs for pre-selling, rentals and sales. Not the public listings: nothing here
// shows on a site. A row opens its full record to read, copy the post summary from, or edit.
import { Copy, ExternalLink, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { supabase, run } from "../supabase";
import { SkeletonRows, toast } from "../motion";
import { Badge, Empty, ErrorNote, Field, Modal, PageHeader, Tabs, btn, btnDanger, btnGhost, card, input, th } from "../ui";

const STATUSES = ["Pre-selling", "For Rent", "Rented", "For Sale", "Sold", "For Assume", "Reserved", "Unavailable"];
const TABS = [
  { id: "all", label: "All", has: null, start: [] },
  { id: "pre-selling", label: "Pre-selling", has: ["Pre-selling"], start: ["Pre-selling"] },
  { id: "rentals", label: "Rentals", has: ["For Rent", "Rented"], start: ["For Rent"] },
  { id: "sale", label: "For sale", has: ["For Sale", "Sold", "For Assume"], start: ["For Sale"] },
];
const TONE = { "Pre-selling": "new", "For Rent": "available", "For Sale": "available", "For Assume": "reserved", Reserved: "reserved", Rented: "lost", Sold: "sold", Unavailable: "hidden" };
const OPEN = ["Pre-selling", "For Rent", "For Sale", "For Assume"]; // still on offer
const peso = (n) => `₱${n.toLocaleString("en-PH")}`;
const rentOnly = (r) => r.status.some((s) => s === "For Rent" || s === "Rented") && !r.status.some((s) => s === "For Sale" || s === "Sold" || s === "Pre-selling");
const priceOf = (r) => (r.price != null ? `${peso(r.price)}${rentOnly(r) ? "/mo" : ""}` : r.price_text ?? "—");
const date = (d) => d && new Date(`${d}T00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });

export default function Inventory() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.id === params.get("tab")) ?? TABS[2];
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState({ text: "", status: "open", max: "" });
  const [open, setOpen] = useState(null); // the row being read or edited; {} for a new one

  useEffect(() => {
    run(supabase.from("inventory").select("*").order("updated_at", { ascending: false })).then(setList, (e) => setError(e.message));
  }, []);

  const inTab = (t, r) => !t.has || r.status.some((s) => t.has.includes(s));
  // ponytail: the whole inventory filtered in the browser; move to SQL past a few thousand rows
  const shown = useMemo(() => {
    const words = q.text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const max = Number(q.max.replace(/\D/g, "")) || 0;
    return (list ?? []).filter(
      (r) =>
        inTab(tab, r) &&
        (q.status === "" || (q.status === "open" ? r.status.some((s) => OPEN.includes(s)) && r.available !== false : r.status.includes(q.status))) &&
        (!max || (r.price != null && r.price <= max)) &&
        words.every((w) => [r.type, r.location, r.source, r.specs, r.furnishing, r.rph_code, r.fh_code, r.price_text].join(" ").toLowerCase().includes(w))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, q, tab.id]);
  const set = (k) => (e) => setQ({ ...q, [k]: e.target.value });

  const saved = (row, gone) => {
    setList((all) => (gone ? all.filter((r) => r.id !== row.id) : all.some((r) => r.id === row.id) ? all.map((r) => (r.id === row.id ? row : r)) : [row, ...all]));
    setOpen(null);
  };

  return (
    <>
      <PageHeader title="Inventory" sub="Every property on offer from owners and brokers. Private to the team: nothing here shows on the sites (that's Listings).">
        <button className={btn} onClick={() => setOpen({ status: tab.start })}>
          <Plus className="size-4" aria-hidden /> Add property
        </button>
      </PageHeader>

      <div className="mt-6">
        <Tabs
          label="Kind of property"
          items={TABS.map((t) => ({ id: t.id, label: list ? `${t.label} ${list.filter((r) => inTab(t, r)).length}` : t.label }))}
          value={tab.id}
          onChange={(id) => setParams({ tab: id }, { replace: true })}
        />
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <label className="relative sm:max-w-xs sm:flex-1">
          <span className="sr-only">Search inventory</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input type="search" placeholder="Search place, type, owner, code…" value={q.text} onChange={set("text")} className={`${input} pl-9`} />
        </label>
        <select aria-label="Filter by status" value={q.status} onChange={set("status")} className={`${input} sm:w-48`}>
          <option value="open">Still available</option>
          <option value="">Every status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input aria-label="Highest price" inputMode="numeric" placeholder="Up to ₱ (their budget)" value={q.max} onChange={set("max")} className={`${input} sm:w-48`} />
      </div>

      <div className="mt-4">
        <ErrorNote error={error} />
      </div>

      <div className={`${card} mt-4 overflow-x-auto`}>
        {!list ? (
          <SkeletonRows />
        ) : !shown.length ? (
          <Empty>{list.length ? "Nothing matches." : "No properties yet. Add your first one."}</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line">
              <tr>
                <th className={th}>Property</th>
                <th className={`${th} text-right`}>Price</th>
                <th className={`${th} hidden md:table-cell`}>Furnishing</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((r) => (
                <tr key={r.id} onClick={() => setOpen(r)} className="group cursor-pointer transition-colors hover:bg-bg active:bg-sunken">
                  <td className="w-full max-w-0 px-4 py-3">
                    <button type="button" onClick={() => setOpen(r)} className="block max-w-full truncate text-left font-medium text-fg outline-offset-4 group-hover:text-accent-ink">
                      {r.type || "Property"}
                    </button>
                    <p className="truncate text-xs text-muted">{[r.location, r.source].filter(Boolean).join(" · ")}</p>
                  </td>
                  <td className="max-w-48 truncate px-4 py-3 text-right tabular-nums whitespace-nowrap" title={r.price_note ?? undefined}>{priceOf(r)}</td>
                  <td className="hidden px-4 py-3 whitespace-nowrap text-muted md:table-cell">{r.furnishing ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className="flex flex-wrap gap-1">
                      {r.status.map((s) => <Badge key={s} value={TONE[s]}>{s}</Badge>)}
                      {r.available_from && <Badge value="draft">From {date(r.available_from)}</Badge>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {list && shown.length > 0 && <p className="mt-2 text-xs text-muted">{shown.length} shown</p>}

      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.id ? open.type || "Property" : "Add property"}>
        {open && <PropertyForm row={open} onSaved={saved} />}
      </Modal>
    </>
  );
}

const FURNISHING = ["", "Fully furnished", "Semi-furnished", "Furnished", "Unfurnished"];
const TEXT = ["type", "location", "price_text", "price_note", "furnishing", "specs", "inclusions", "payment_terms", "notes", "summary", "source", "source_url", "fb_post_note", "fb_post_url", "rph_code", "rph_url", "fh_code", "fh_url", "available_from", "fb_posted_on"];

function PropertyForm({ row, onSaved }) {
  const [f, setF] = useState(() => ({
    ...Object.fromEntries(TEXT.map((k) => [k, row[k] ?? ""])),
    status: row.status ?? [],
    price: row.price != null ? String(row.price) : "",
    available: row.available == null ? "" : String(row.available),
    pet_friendly: row.pet_friendly ?? "unconfirmed",
    rapa: !!row.rapa,
    ats: !!row.ats,
    pictures: !!row.pictures,
  }));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const toggle = (s) => setF({ ...f, status: f.status.includes(s) ? f.status.filter((x) => x !== s) : [...f.status, s] });

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const out = {
      ...Object.fromEntries(TEXT.map((k) => [k, f[k].trim() || null])),
      status: STATUSES.filter((s) => f.status.includes(s)),
      price: f.price.replace(/\D/g, "") ? Number(f.price.replace(/\D/g, "")) : null,
      available: f.available === "" ? null : f.available === "true",
      pet_friendly: f.pet_friendly,
      rapa: f.rapa,
      ats: f.ats,
      pictures: f.pictures,
    };
    try {
      const q = row.id ? supabase.from("inventory").update(out).eq("id", row.id) : supabase.from("inventory").insert(out);
      onSaved(await run(q.select().single()));
      toast(row.id ? "Saved" : "Property added");
    } catch (err) {
      setError(/check constraint .*url/.test(err.message) ? "Links must start with https://" : err.message);
    }
    setBusy(false);
  }

  async function remove() {
    if (!confirm("Delete this property from the inventory? This can't be undone.")) return;
    try {
      await run(supabase.from("inventory").delete().eq("id", row.id));
      onSaved(row, true);
      toast("Deleted");
    } catch (err) {
      setError(err.message);
    }
  }

  const area = (k, label, rows = 3, max = 4000) => (
    <Field label={label}>
      <textarea value={f[k]} onChange={set(k)} rows={rows} maxLength={max} className={input} />
    </Field>
  );
  const link = (k, label) => (
    <Field label={label}>
      <span className="flex gap-2">
        <input type="url" value={f[k]} onChange={set(k)} placeholder="https://" className={input} />
        {/^https?:\/\//.test(f[k]) && (
          <a href={f[k]} target="_blank" rel="noopener noreferrer" className={btnGhost} aria-label={`Open ${label}`}>
            <ExternalLink className="size-4" aria-hidden />
          </a>
        )}
      </span>
    </Field>
  );

  return (
    <form onSubmit={save} className="grid gap-4">
      <ErrorNote error={error} />
      <fieldset>
        <legend className="label mb-1.5 text-ink">Status</legend>
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <label key={s} className={`press cursor-pointer rounded-full border px-3 py-1 text-sm ${f.status.includes(s) ? "border-navy bg-navy text-cream" : "border-line text-fg"}`}>
              <input type="checkbox" className="sr-only" checked={f.status.includes(s)} onChange={() => toggle(s)} />
              {s}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type">
          <input value={f.type} onChange={set("type")} maxLength={200} placeholder="1BR Condo, With balcony" className={input} />
        </Field>
        <Field label="Location">
          <input value={f.location} onChange={set("location")} maxLength={500} className={input} />
        </Field>
        <Field label="Price (₱)" hint="Sale price, or rent per month">
          <input inputMode="numeric" value={f.price} onChange={set("price")} className={`${input} tabular-nums`} />
        </Field>
        <Field label="Or the price in words" hint="When it's not one number">
          <input value={f.price_text} onChange={set("price_text")} maxLength={500} placeholder="Rent: ₱35,000 / Sale: ₱5,500,000" className={input} />
        </Field>
      </div>
      <Field label="Price note">
        <input value={f.price_note} onChange={set("price_note")} maxLength={1000} placeholder="Inclusive of condo dues, NET…" className={input} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Available now">
          <select value={f.available} onChange={set("available")} className={input}>
            <option value="">Not known</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </Field>
        <Field label="Available from">
          <input type="date" value={f.available_from} onChange={set("available_from")} className={input} />
        </Field>
        <Field label="Furnishing">
          <select value={f.furnishing} onChange={set("furnishing")} className={input}>
            {(FURNISHING.includes(f.furnishing) ? FURNISHING : [...FURNISHING, f.furnishing]).map((o) => (
              <option key={o} value={o}>{o || "Not set"}</option>
            ))}
          </select>
        </Field>
      </div>
      {area("specs", "Specs")}
      {area("inclusions", "Inclusions", 2)}
      {area("payment_terms", "Payment terms", 2, 2000)}
      {area("notes", "Amenities and other notes", 3, 8000)}
      <Field label="Pet-friendly">
        <select value={f.pet_friendly} onChange={set("pet_friendly")} className={input}>
          <option value="unconfirmed">Not confirmed</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </Field>
      <div>
        {area("summary", "Summary for posts", 4)}
        {f.summary && (
          <button type="button" className={`${btnGhost} mt-2`} onClick={() => navigator.clipboard.writeText(f.summary).then(() => toast("Summary copied"))}>
            <Copy className="size-4" aria-hidden /> Copy summary
          </button>
        )}
      </div>

      <h3 className="mt-2 font-display text-lg text-ink">Source and posts</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Owner or broker">
          <input value={f.source} onChange={set("source")} maxLength={300} className={input} />
        </Field>
        {link("source_url", "Their profile or post")}
        <Field label="Posted on Facebook">
          <input type="date" value={f.fb_posted_on} onChange={set("fb_posted_on")} className={input} />
        </Field>
        {link("fb_post_url", "Facebook post")}
        <Field label="Rent.ph code">
          <input value={f.rph_code} onChange={set("rph_code")} maxLength={100} className={input} />
        </Field>
        {link("rph_url", "Rent.ph page")}
        <Field label="Filipino Homes code">
          <input value={f.fh_code} onChange={set("fh_code")} maxLength={100} className={input} />
        </Field>
        {link("fh_url", "Filipino Homes page")}
      </div>
      <Field label="Posting note">
        <input value={f.fb_post_note} onChange={set("fb_post_note")} maxLength={300} placeholder="tbp, owner no reply yet…" className={input} />
      </Field>

      <fieldset className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <legend className="label mb-1.5 text-ink">Papers in hand</legend>
        {[["rapa", "RAPA"], ["ats", "ATS"], ["pictures", "Pictures folder"]].map(([k, l]) => (
          <label key={k} className="flex items-center gap-2">
            <input type="checkbox" checked={f[k]} onChange={set(k)} className="size-4 accent-navy" /> {l}
          </label>
        ))}
      </fieldset>

      <div className="sticky bottom-0 -mx-1 flex items-center gap-2 bg-surface px-1 pt-2">
        <button className={btn} disabled={busy}>{busy ? "Saving…" : row.id ? "Save" : "Add property"}</button>
        {row.id && (
          <button type="button" className={`${btnDanger} ml-auto`} onClick={remove}>
            <Trash2 className="size-4" aria-hidden /> Delete
          </button>
        )}
      </div>
    </form>
  );
}
