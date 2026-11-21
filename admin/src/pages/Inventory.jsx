// Inventory: every property the team can offer, from owners and other brokers (supabase/migrations
// …_inventory.sql), in tabs for pre-selling, rentals and sales. Not the public listings: nothing here
// shows on a site. A row opens its full record to read, copy the post summary from, or edit.
import { Copy, ExternalLink, MapPin, Pencil, Plus, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { Chip } from "./Matches";
import { AREAS, inArea, LANDMARK, LANDMARKS, RADII, distance } from "../match";
import MapView, { PIN } from "../MapView";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { supabase, run } from "../supabase";
import { api } from "../api";
import { SkeletonRows, spring, toast } from "../motion";
import { Badge, Empty, ErrorNote, Field, Modal, PageHeader, TabPanel, Tabs, btn, btnDanger, btnGhost, card, input, th, Select, ask } from "../ui";

const STATUSES = ["Pre-selling", "For Rent", "Rented", "For Sale", "Sold", "For Assume", "Reserved", "Unavailable"];
const TABS = [
  { id: "all", label: "All", has: null, start: [] },
  { id: "pre-selling", label: "Pre-selling", has: ["Pre-selling"], start: ["Pre-selling"] },
  { id: "rentals", label: "Rentals", has: ["For Rent", "Rented"], start: ["For Rent"] },
  { id: "sale", label: "For sale", has: ["For Sale", "Sold", "For Assume"], start: ["For Sale"] },
];
const TONE = { "Pre-selling": "inv-pre", "For Rent": "inv-for-rent", "For Sale": "inv-for-sale", "For Assume": "inv-assume", Reserved: "inv-reserved", Rented: "inv-rented", Sold: "inv-sold", Unavailable: "inv-unavailable" };
const OPEN = ["Pre-selling", "For Rent", "For Sale", "For Assume"]; // still on offer
// a pin's colour on the map: the same colour as its status badge (ui.jsx "inv-*"). A property with
// several statuses takes the first of these, in order: what's on offer before what's gone.
const PIN_OF = { "Pre-selling": "#16a34a", "For Rent": "#f97316", "For Sale": "#38bdf8", "For Assume": "#facc15", Reserved: "#a1a1aa", Rented: "#dc2626", Sold: "#14213a", Unavailable: "#171717" };
const pinOf = (r) => PIN_OF[Object.keys(PIN_OF).find((s) => r.status.includes(s))] ?? "#a1a1aa";
// where a place is, through the admin's Worker (OpenStreetMap)
const lookUp = (q) => api(`geo?q=${encodeURIComponent(q)}`).then((r) => r.places);
const peso = (n) => `₱${n.toLocaleString("en-PH")}`;
const rentOnly = (r) => r.status.some((s) => s === "For Rent" || s === "Rented") && !r.status.some((s) => s === "For Sale" || s === "Sold" || s === "Pre-selling");
const priceOf = (r) => (r.price != null ? `${peso(r.price)}${rentOnly(r) ? "/mo" : ""}` : r.price_text ?? "—");
const date = (d) => d && new Date(`${d}T00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });

export default function Inventory() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.id === params.get("tab")) ?? TABS[2];
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState({ text: "", status: "open", max: "", furnishing: "", when: "", pets: false, where: "", building: "", near: "", km: "2" });
  const [view, setView] = useState("table"); // or "map"
  const [open, setOpen] = useState(null); // the row being read or edited; {} for a new one
  const [editing, setEditing] = useState(false);
  const show = (row, edit = false) => {
    setOpen(row);
    setEditing(edit);
  };

  useEffect(() => {
    run(supabase.from("inventory").select("*").order("updated_at", { ascending: false })).then((rows) => {
      setList(rows);
      // from a lead's matches: open that property
      const want = rows.find((r) => r.id === Number(params.get("open")));
      if (want) show(want);
    }, (e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // every building in the inventory, A to Z: the filter's choices and the form's suggestions
  const buildings = useMemo(() => [...new Set((list ?? []).map((r) => r.building).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [list]);
  // the building filter offers only the buildings in the area picked
  const buildingsHere = useMemo(() => (q.where ? buildings.filter((b) => list.some((r) => r.building === b && inArea(q.where, r))) : buildings), [buildings, list, q.where]);
  const inTab = (t, r) => !t.has || r.status.some((s) => t.has.includes(s));
  // ponytail: the whole inventory filtered in the browser; move to SQL past a few thousand rows
  const shown = useMemo(() => {
    const words = q.text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const max = Number(q.max.replace(/\D/g, "")) || 0;
    const today = new Date().toISOString().slice(0, 10);
    const rows = (list ?? []).filter(
      (r) =>
        inTab(tab, r) &&
        (q.status === "" ||
          (q.status === "open" ? (r.status.some((s) => OPEN.includes(s)) && r.available !== false) || r.available_from > today : q.status === "both" ? r.status.includes("For Rent") && (r.status.includes("For Sale") || r.status.includes("For Assume")) : r.status.includes(q.status))) &&
        (!q.furnishing || r.furnishing === q.furnishing) &&
        (!q.where || inArea(q.where, r)) &&
        (!q.building || r.building === q.building) &&
        (!q.near || (distance(r, q.near) ?? Infinity) <= Number(q.km)) &&
        (!q.pets || r.pet_friendly === "yes") &&
        (!q.when || (q.when === "now" ? r.available === true && !(r.available_from > today) : r.available_from > today)) &&
        (!max || (r.price != null && r.price <= max)) &&
        words.every((w) => [r.type, r.building, r.location, r.source, r.specs, r.furnishing, r.rph_code, r.fh_code, r.price_text].join(" ").toLowerCase().includes(w))
    );
    // near a place: closest first; coming up: soonest first
    if (q.near) return rows.sort((a, b) => distance(a, q.near) - distance(b, q.near));
    return q.when === "later" ? rows.sort((a, b) => a.available_from.localeCompare(b.available_from)) : rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, q, tab.id]);
  const set = (k) => (e) => setQ({ ...q, [k]: e.target.value });
  // which filters are narrowing the list: those stand out, the rest sit gray at their defaults
  const on = { status: !["open", ""].includes(q.status), max: !!q.max.trim(), where: !!q.where, building: !!q.building, furnishing: !!q.furnishing, when: !!q.when, near: !!q.near, pets: q.pets };
  const active = Object.values(on).filter(Boolean).length;
  const f = (isOn) => (isOn ? `${input} border-navy! font-medium` : `${input} bg-sunken! text-muted!`);
  const [filters, setFilters] = useState(false); // phones: filters shown

  const saved = (row, gone) => {
    setList((all) => (gone ? all.filter((r) => r.id !== row.id) : all.some((r) => r.id === row.id) ? all.map((r) => (r.id === row.id ? row : r)) : [row, ...all]));
    setOpen(null);
  };

  return (
    <>
      <PageHeader title="Inventory" sub="Every property on offer from owners and brokers. Private to the team: nothing here shows on the sites (that's Listings).">
        <button className={btn} onClick={() => show({ status: tab.start }, true)}>
          <Plus className="size-4" aria-hidden /> Add property
        </button>
      </PageHeader>

      <div className="mt-6">
        <Tabs
          label="Kind of property"
          items={TABS.map((t) => ({ id: t.id, title: list ? `${t.label} ${list.filter((r) => inTab(t, r)).length}` : t.label }))}
          value={tab.id}
          onChange={(id) => setParams({ tab: id }, { replace: true })}
        />
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <div className="flex gap-3 sm:max-w-xs sm:flex-1">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search inventory</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input type="search" placeholder="Search place, type, owner, code…" value={q.text} onChange={(e) => {
            // a fresh search looks through everything: every tab, every status; narrow from there
            if (!q.text.trim() && e.target.value.trim()) {
              setQ({ ...q, text: e.target.value, status: "" });
              if (tab.id !== "all") setParams({ tab: "all" }, { replace: true });
            } else setQ({ ...q, text: e.target.value });
          }} className={`${input} pl-9`} />
        </label>
        {/* phones: the filters fold away behind this, with a count of the ones in use */}
        <button
          type="button"
          onClick={() => setFilters((f) => !f)}
          aria-expanded={filters}
          aria-controls="inv-filters inv-filters-more"
          className={`press relative inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border px-3 text-sm font-medium sm:hidden ${filters || active ? "border-navy text-fg" : "border-line text-muted"}`}
        >
          <SlidersHorizontal className="size-4" aria-hidden /> Filters
          {active > 0 && <span className="grid size-5 place-items-center rounded-full bg-navy text-[0.7rem] text-cream tabular-nums">{active}</span>}
        </button>
        </div>
        <div id="inv-filters" className={`flex-col gap-3 sm:flex sm:flex-row ${filters ? "flex" : "hidden"}`}>
        <Select aria-label="Filter by status" value={q.status} onChange={set("status")} className={`${f(on.status)} sm:w-48`}>
          <option value="open">Still available</option>
          <option value="">Every status</option>
          <option value="both">For rent and for sale</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
        <input aria-label="Highest price" inputMode="numeric" placeholder="Up to ₱ (their budget)" value={q.max} onChange={set("max")} className={`${f(on.max)} sm:w-48`} />
        </div>
      </div>
      <div id="inv-filters-more" className={`mt-3 flex-col gap-3 sm:flex sm:flex-row sm:flex-wrap sm:items-center ${filters ? "flex" : "hidden"}`}>
        <Select
          aria-label="Filter by area"
          value={q.where}
          // a building outside the new area would hide everything: let it go
          onChange={(e) => setQ({ ...q, where: e.target.value, building: !q.building || !e.target.value || list?.some((r) => r.building === q.building && inArea(e.target.value, r)) ? q.building : "" })}
          className={`${f(on.where)} sm:w-60`}
        >
          <option value="">Anywhere</option>
          {Object.entries(AREAS).map(([g, list]) => (
            <optgroup key={g} label={g}>{Object.keys(list).map((k) => <option key={k} value={k}>{k}</option>)}</optgroup>
          ))}
        </Select>
        <Select aria-label="Filter by building" value={q.building} onChange={set("building")} className={`${f(on.building)} sm:w-60`}>
          <option value="">Any building</option>
          {buildingsHere.map((b) => <option key={b} value={b}>{b}</option>)}
        </Select>
        <Select aria-label="Filter by furnishing" value={q.furnishing} onChange={set("furnishing")} className={`${f(on.furnishing)} sm:w-48`}>
          <option value="">Any furnishing</option>
          {FURNISHING.slice(1).map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
        <Select aria-label="Filter by when it's free" value={q.when} onChange={set("when")} className={`${f(on.when)} sm:w-56`}>
          <option value="">Free any time</option>
          <option value="now">Available now</option>
          <option value="later">To be available (has a date)</option>
        </Select>
        <Select aria-label="Near a place" value={q.near} onChange={set("near")} className={`${f(on.near)} sm:w-60`}>
          <option value="">Near anywhere</option>
          {Object.entries(LANDMARKS).map(([g, list]) => (
            <optgroup key={g} label={g}>{Object.keys(list).map((k) => <option key={k} value={k}>Near {k}</option>)}</optgroup>
          ))}
        </Select>
        {q.near && (
          <Select aria-label="Within" value={q.km} onChange={set("km")} className={`${f(true)} sm:w-32`}>
            {RADII.map((k) => <option key={k} value={String(k)}>within {k < 1 ? `${k * 1000} m` : `${k} km`}</option>)}
          </Select>
        )}
        <label className={`flex items-center gap-2 text-sm whitespace-nowrap ${q.pets ? "font-medium text-fg" : "text-muted"}`}>
          <input type="checkbox" checked={q.pets} onChange={(e) => setQ({ ...q, pets: e.target.checked })} className="size-4 accent-navy" /> Pet-friendly only
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <ErrorNote error={error} />
        <div role="radiogroup" aria-label="Show as" className="flex rounded-full border border-line bg-surface p-0.5">
          {[["table", "Table"], ["map", "Map"]].map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={view === k} onClick={() => setView(k)} className={`relative rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors duration-150 ${view === k ? "text-cream" : "text-muted hover:text-fg"}`}>
              {view === k && <motion.span layoutId="inv-view" transition={spring} className="absolute inset-0 rounded-full bg-navy" />}
              <span className="relative">{l}</span>
            </button>
          ))}
        </div>
        {/* the legend: what the status colours mean */}
        <p className="ml-auto flex flex-wrap items-center gap-1.5 text-xs text-muted" aria-label="Legend">
          {STATUSES.map((s) => <Badge key={s} value={TONE[s]}>{s}</Badge>)}
          <Badge value="draft">From a date</Badge>
        </p>
      </div>

      {/* keyed by tab: a new tab's rows rise in rather than snap */}
      <TabPanel key={`${tab.id}:${view}`} className={`${card} mt-4 overflow-x-auto`}>
        {view === "map" && list ? (
          <div className="grid gap-2 p-3">
            <MapView
              className="h-[65vh]"
              pins={shown.filter((r) => r.lat != null).map((r) => ({ id: r.id, lat: r.lat, lng: r.lng, color: pinOf(r), label: `${r.type || "Property"} · ${priceOf(r)}`, row: r }))}
              ring={q.near ? { at: LANDMARK[q.near], km: Number(q.km), name: q.near } : null}
              onPin={(p) => show(p.row)}
            />
            <p className="flex flex-wrap items-center gap-3 px-1 text-xs text-muted">
              {Object.entries(PIN_OF).map(([s, c]) => (
                <span key={s} className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: c }} /> {s}</span>
              ))}
              {shown.some((r) => r.lat == null) && <span className="ml-auto">{shown.filter((r) => r.lat == null).length} not on the map yet: open one and set its pin</span>}
            </p>
          </div>
        ) : !list ? (
          <SkeletonRows />
        ) : !shown.length ? (
          <Empty>{list.length ? "Nothing matches." : "No properties yet. Add your first one."}</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line">
              <tr>
                <th className={th}>Property</th>
                {q.near && <th className={`${th} text-right`}>Distance</th>}
                <th className={`${th} text-right`}>Price</th>
                <th className={`${th} hidden md:table-cell`}>Furnishing</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shown.map((r) => (
                <tr key={r.id} onClick={() => show(r)} className="group cursor-pointer transition-colors hover:bg-bg active:bg-sunken">
                  <td className="w-full max-w-0 px-4 py-3">
                    <button type="button" onClick={() => show(r)} className="block max-w-full truncate text-left font-medium text-fg outline-offset-4 group-hover:text-accent-ink">
                      {r.type || "Property"}
                    </button>
                    <p className="truncate text-xs text-muted">{[r.location, r.source].filter(Boolean).join(" · ")}</p>
                  </td>
                  {q.near && <td className="px-4 py-3 text-right whitespace-nowrap text-muted tabular-nums">{distance(r, q.near).toFixed(1)} km{r.geo === "approx" && <span title="Only the neighbourhood is known"> ≈</span>}</td>}
                  <td className="max-w-48 truncate px-4 py-3 text-right tabular-nums whitespace-nowrap" title={r.price_note ?? undefined}>{priceOf(r)}</td>
                  <td className="hidden px-4 py-3 whitespace-nowrap md:table-cell">{r.furnishing ? <Chip tone="emerald">{r.furnishing}</Chip> : <span className="text-muted">—</span>}</td>
                  <td className="px-4 py-3">
                    <span className="flex flex-wrap gap-1">
                      {r.status.map((s) => <Badge key={s} value={TONE[s]}>{s}</Badge>)}
                      {r.available_from && <Badge value="draft">From {date(r.available_from)}</Badge>}
                      {r.pet_friendly === "yes" && <Badge value="draft">Pets OK</Badge>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TabPanel>
      {list && shown.length > 0 && <p className="mt-2 text-xs text-muted">{shown.length} shown</p>}

      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.id ? open.type || "Property" : "Add property"}>
        {open && (editing ? <PropertyForm row={open} onSaved={saved} buildings={buildings} /> : <PropertyView row={open} onEdit={() => setEditing(true)} />)}
      </Modal>
    </>
  );
}

// A property at a glance: price and status up top, the facts as chips, the long text in labelled
// blocks, links as buttons. Edit opens the full form.
function PropertyView({ row: r, onEdit }) {
  const today = new Date().toISOString().slice(0, 10);
  const blocks = [
    ["Specs", r.specs],
    ["Inclusions", r.inclusions],
    ["Payment terms", r.payment_terms],
    ["Amenities and notes", r.notes],
  ].filter(([, v]) => v);
  const links = [
    [r.source ? `${r.source}` : "Owner or broker", r.source_url],
    [r.fb_posted_on ? `Facebook post · ${date(r.fb_posted_on)}` : "Facebook post", r.fb_post_url],
    [`Rent.ph${r.rph_code ? ` · ${r.rph_code}` : ""}`, r.rph_url],
    [`Filipino Homes${r.fh_code ? ` · ${r.fh_code}` : ""}`, r.fh_url],
  ].filter(([, u]) => u);
  return (
    <div className="grid gap-5 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-2xl text-ink tabular-nums">{priceOf(r)}</p>
          {r.price_note && <p className="text-xs text-muted">{r.price_note}</p>}
        </div>
        <span className="flex flex-wrap gap-1">{r.status.map((s) => <Badge key={s} value={TONE[s]}>{s}</Badge>)}</span>
      </div>
      {r.location && (
        <p className="flex items-start gap-1.5 text-charcoal">
          <MapPin className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden /> {r.location}
        </p>
      )}
      {r.lat != null ? (
        <div className="grid gap-1">
          <MapView className="h-48" zoom={16} pins={[{ id: r.id, lat: r.lat, lng: r.lng, color: pinOf(r) }]} />
          {r.geo === "approx" && <p className="text-xs text-muted">Only the neighbourhood is known. Edit to drag the pin onto the building.</p>}
        </div>
      ) : (
        <p className="text-xs text-muted">Not on the map yet. Edit to find it or drop a pin.</p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {r.building && <Chip tone="teal">{r.building}</Chip>}
        {r.furnishing && <Chip tone="emerald">{r.furnishing}</Chip>}
        <Chip tone={r.available_from > today ? "burgundy" : r.available === false ? "off" : "sky"}>
          {r.available_from > today ? `Free from ${date(r.available_from)}` : r.available === false ? "Not available" : "Available now"}
        </Chip>
        <Chip tone={r.pet_friendly === "yes" ? "violet" : "off"}>{r.pet_friendly === "yes" ? "Pets OK" : r.pet_friendly === "no" ? "No pets" : "Pets not confirmed"}</Chip>
        {[["rapa", "RAPA"], ["ats", "ATS"], ["pictures", "Pictures"]].map(([k, l]) => (
          <Chip key={k} tone={r[k] ? "navy" : "off"}>{l}</Chip>
        ))}
      </div>
      {blocks.map(([k, v]) => (
        <div key={k}>
          <p className="label mb-1 text-muted">{k}</p>
          <p className="whitespace-pre-wrap text-charcoal">{v}</p>
        </div>
      ))}
      {r.summary && (
        <div className="rounded-lg bg-sunken/60 p-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="label text-muted">Summary for posts</p>
            <button type="button" className="press inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-fg hover:bg-surface" onClick={() => navigator.clipboard.writeText(r.summary).then(() => toast("Summary copied"))}>
              <Copy className="size-3.5" aria-hidden /> Copy
            </button>
          </div>
          <p className="text-charcoal">{r.summary}</p>
        </div>
      )}
      {links.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {links.map(([l, u]) => (
            <a key={u} href={u} target="_blank" rel="noopener noreferrer" className={btnGhost}>
              <ExternalLink className="size-4" aria-hidden /> {l}
            </a>
          ))}
        </div>
      )}
      {!links.length && r.source && <p className="text-xs text-muted">From {r.source}</p>}
      <div>
        <button type="button" className={btn} onClick={onEdit}>
          <Pencil className="size-4" aria-hidden /> Edit
        </button>
      </div>
    </div>
  );
}

const FURNISHING = ["", "Fully furnished", "Semi-furnished", "Furnished", "Finished", "Unfurnished"];
const TEXT = ["type", "location", "building", "price_text", "price_note", "furnishing", "specs", "inclusions", "payment_terms", "notes", "summary", "source", "source_url", "fb_post_note", "fb_post_url", "rph_code", "rph_url", "fh_code", "fh_url", "available_from", "fb_posted_on"];

function PropertyForm({ row, onSaved, buildings = [] }) {
  const [f, setF] = useState(() => ({
    ...Object.fromEntries(TEXT.map((k) => [k, row[k] ?? ""])),
    status: row.status ?? [],
    price: row.price != null ? String(row.price) : "",
    available: row.available == null ? "" : String(row.available),
    pet_friendly: row.pet_friendly ?? "unconfirmed",
    rapa: !!row.rapa,
    ats: !!row.ats,
    pictures: !!row.pictures,
    pos: row.lat != null ? [row.lat, row.lng] : null,
    geo: row.geo ?? null,
  }));
  const [found, setFound] = useState(""); // what OpenStreetMap matched, shown under the map
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
      lat: f.pos?.[0] ?? null,
      lng: f.pos?.[1] ?? null,
      geo: f.pos ? f.geo : null,
    };
    // no building given, but the location names one the inventory knows: that's its building
    if (!out.building && out.location) out.building = buildings.find((b) => out.location.toLowerCase().includes(b.toLowerCase())) ?? null;
    // look the position up on the way in: a new property with no pin, or a changed location whose
    // pin wasn't placed by hand (quietly: no answer just means no pin, never an old, wrong one)
    const moved = row.id && out.location !== (row.location ?? null) && f.geo !== "pinned";
    if (out.location && ((!row.id && !f.pos) || moved)) {
      const hit = (await lookUp(out.location).catch(() => []))[0];
      Object.assign(out, hit ? { lat: hit.lat, lng: hit.lng, geo: hit.exact ? "exact" : "approx" } : moved ? { lat: null, lng: null, geo: null } : {});
    }
    try {
      const q = row.id ? supabase.from("inventory").update(out).eq("id", row.id) : supabase.from("inventory").insert(out);
      onSaved(await run(q.select().single()));
      toast(row.id ? "Saved" : "Property added");
    } catch (err) {
      setError(/check constraint .*url/.test(err.message) ? "Links must start with https://" : err.message);
    }
    setBusy(false);
  }

  async function find() {
    setError("");
    try {
      const [hit] = await lookUp(f.location);
      if (!hit) return setError("OpenStreetMap couldn't find that location. Click the map where it is instead.");
      setF((x) => ({ ...x, pos: [hit.lat, hit.lng], geo: hit.exact ? "exact" : "approx" }));
      setFound(`${hit.exact ? "Found" : "Only the neighbourhood was found"}: ${hit.name.split(",").slice(0, 3).join(",")}`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove() {
    if (!(await ask({ title: "Delete this property?", body: "It's removed from the inventory for good.", yes: "Delete", danger: true }))) return;
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
        <Field label="Building" hint="A condo or development: pick one, or type a new name">
          <input value={f.building} onChange={set("building")} list="inventory-buildings" maxLength={120} autoComplete="off" placeholder="None" className={input} />
          <datalist id="inventory-buildings">
            {buildings.map((b) => <option key={b} value={b} />)}
          </datalist>
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
          <Select value={f.available} onChange={set("available")} className={input}>
            <option value="">Not known</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </Select>
        </Field>
        <Field label="Available from">
          <input type="date" value={f.available_from} onChange={set("available_from")} className={input} />
        </Field>
        <Field label="Furnishing">
          <Select value={f.furnishing} onChange={set("furnishing")} className={input}>
            {(FURNISHING.includes(f.furnishing) ? FURNISHING : [...FURNISHING, f.furnishing]).map((o) => (
              <option key={o} value={o}>{o || "Not set"}</option>
            ))}
          </Select>
        </Field>
      </div>
      {area("specs", "Specs")}
      {area("inclusions", "Inclusions", 2)}
      {area("payment_terms", "Payment terms", 2, 2000)}
      {area("notes", "Amenities and other notes", 3, 8000)}
      <Field label="Pet-friendly">
        <Select value={f.pet_friendly} onChange={set("pet_friendly")} className={input}>
          <option value="unconfirmed">Not confirmed</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </Select>
      </Field>
      <div>
        {area("summary", "Summary for posts", 4)}
        {f.summary && (
          <button type="button" className={`${btnGhost} mt-2`} onClick={() => navigator.clipboard.writeText(f.summary).then(() => toast("Summary copied"))}>
            <Copy className="size-4" aria-hidden /> Copy summary
          </button>
        )}
      </div>

      <h3 className="mt-2 font-display text-lg text-ink">On the map</h3>
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={btnGhost} onClick={find} disabled={!f.location.trim()}>
            <MapPin className="size-4" aria-hidden /> Find from the location
          </button>
          {f.pos && (
            <button type="button" className={btnDanger} onClick={() => setF({ ...f, pos: null, geo: null })}>Remove pin</button>
          )}
          <span className="text-xs text-muted">{f.pos ? (f.geo === "pinned" ? "Pinned by hand" : f.geo === "approx" ? "Neighbourhood only: drag the pin onto the building" : "Found on OpenStreetMap") : "Or click the map where it is"}</span>
        </div>
        <MapView className="h-64" movable={f.pos} onMove={(pos) => setF((x) => ({ ...x, pos, geo: "pinned" }))} />
        {found && <p className="text-xs text-muted">{found}</p>}
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
