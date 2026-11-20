import { ChevronRight, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { supabase, run, PHOTOS } from "../supabase";
import { Live, LiveTr, SkeletonRows } from "../motion";
import { Badge, Empty, ErrorNote, Field, Modal, PageHeader, btn, card, input, th, Select } from "../ui";
import { STATUSES, TYPES, price } from "../../../src/listings/types.js";
import { shape, check } from "../../../src/listings/rules.js";
import { order, projects } from "../../../src/projects.js";

export default function Listings() {
  const navigate = useNavigate();
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  // the filters live in the address, so they're still set on coming back from a listing
  const [params, setParams] = useSearchParams();
  const q = { text: params.get("q") ?? "", type: params.get("type") ?? "", status: params.get("status") ?? "" };
  const setQ = (next) => setParams(Object.fromEntries(Object.entries({ q: next.text, type: next.type, status: next.status }).filter(([, v]) => v)), { replace: true });
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    run(supabase.from("listings").select("*, listing_photos (storage_key, sort, id)").order("updated_at", { ascending: false })).then(async (ls) => {
      // each listing's cover, the first of its photos, signed for an hour (the bucket is private)
      const first = (l) => [...l.listing_photos].sort((a, b) => a.sort - b.sort || a.id - b.id)[0]?.storage_key;
      const keys = ls.map(first).filter(Boolean);
      const signed = keys.length ? await run(supabase.storage.from(PHOTOS).createSignedUrls(keys, 3600)) : [];
      const url = Object.fromEntries(signed.map((x) => [x.path, x.signedUrl]));
      setList(ls.map((l) => ({ ...l, cover: url[first(l)] })));
    }, (e) => setError(e.message));
  }, []);

  // ponytail: every listing loaded and filtered in the browser; move the search to SQL past a few thousand
  const shown = useMemo(
    () =>
      (list ?? []).filter(
        (l) =>
          (!q.type || l.type === q.type) &&
          (!q.status || l.status === q.status || (q.status === "draft" && !l.published)) &&
          (!q.text || `${l.title} ${l.location ?? ""} ${l.slug}`.toLowerCase().includes(q.text.trim().toLowerCase()))
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list, q.text, q.type, q.status]
  );
  const set = (k) => (e) => setQ({ ...q, [k]: e.target.value });

  return (
    <>
      <PageHeader title="Listings" sub="Only published listings appear on the sites, and never while hidden. Changes are live within a minute.">
        <button className={btn} onClick={() => setAdding(true)}>
          <Plus className="size-4" aria-hidden />
          Add listing
        </button>
      </PageHeader>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <label className="relative sm:max-w-xs sm:flex-1">
          <span className="sr-only">Search listings</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input type="search" placeholder="Search title, location…" value={q.text} onChange={set("text")} className={`${input} pl-9`} />
        </label>
        <Select aria-label="Filter by type" value={q.type} onChange={set("type")} className={`${input} sm:w-44`}>
          <option value="">Every type</option>
          {Object.entries(TYPES).map(([k, t]) => (
            <option key={k} value={k}>{t.label}</option>
          ))}
        </Select>
        <Select aria-label="Filter by status" value={q.status} onChange={set("status")} className={`${input} sm:w-44`}>
          <option value="">Every status</option>
          <option value="draft">Not published</option>
          {Object.entries(STATUSES).map(([k, s]) => (
            <option key={k} value={k}>{s}</option>
          ))}
        </Select>
      </div>

      <div className="mt-4">
        <ErrorNote error={error} />
      </div>

      <div className={`${card} mt-4 overflow-x-auto`}>
        {!list ? (
          <SkeletonRows />
        ) : !shown.length ? (
          <Empty>{list.length ? "No listings match." : "No listings yet. Add your first one."}</Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line">
              <tr>
                <th className={th}>Listing</th>
                <th className={`${th} hidden md:table-cell`}>Price</th>
                <th className={`${th} hidden sm:table-cell`}>On the sites</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              <Live>
                {shown.map((l, i) => (
                  // the whole row opens the listing; the title stays a real link for keyboard and new tabs
                  <LiveTr key={l.id} i={i} onClick={(e) => !e.target.closest("a") && navigate(`/listings/${l.id}`)} className="group cursor-pointer transition-colors hover:bg-bg active:bg-sunken">
                    {/* w-full max-w-0: the cell takes the spare width but lets long titles truncate */}
                    <td className="w-full max-w-0 px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-11 w-16 shrink-0 overflow-hidden rounded bg-sunken">
                          {l.cover && <img src={l.cover} alt="" loading="lazy" className="h-full w-full object-cover" />}
                        </div>
                        <div className="min-w-0">
                          <Link to={`/listings/${l.id}`} className="block truncate font-medium text-fg outline-offset-4 group-hover:text-accent-ink">
                            {l.title}
                          </Link>
                          <p className="truncate text-xs text-muted">{[TYPES[l.type]?.label, projects[l.project]?.name, l.location].filter(Boolean).join(" · ")}</p>
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 text-muted md:table-cell">{price(l)}</td>
                    <td className="hidden px-4 py-3 sm:table-cell">
                      <Badge value={l.published ? "published" : "draft"}>{l.published ? "Published" : "Not published"}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center justify-between gap-2">
                        <Badge value={l.status} />
                        <ChevronRight className="size-4 text-muted/50 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-muted" aria-hidden />
                      </span>
                    </td>
                  </LiveTr>
                ))}
              </Live>
            </tbody>
          </table>
        )}
      </div>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add listing">
        <NewListing onSaved={(l) => navigate(`/listings/${l.id}`)} />
      </Modal>
    </>
  );
}

// The essentials; the rest (prices, photos, publishing) on the listing's own page.
function NewListing({ onSaved }) {
  const [f, setF] = useState({ title: "", type: "project_unit", project: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const t = TYPES[f.type];
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function save(e) {
    e.preventDefault();
    setError("");
    const l = shape(f);
    const why = check(l, null, {}, order);
    if (why) return setError(why);
    setBusy(true);
    try {
      onSaved(await run(supabase.from("listings").insert(l).select("id").single()));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="grid gap-4">
      <ErrorNote error={error} />
      <Field label="Title" hint="e.g. Studio, Tower 1, 12F">
        <input value={f.title} onChange={set("title")} required minLength={2} maxLength={150} autoFocus className={input} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type">
          <Select value={f.type} onChange={set("type")} className={input}>
            {Object.entries(TYPES).map(([k, x]) => (
              <option key={k} value={k}>{x.label}</option>
            ))}
          </Select>
        </Field>
        {t.project && (
          <Field label="Project">
            <Select value={f.project} onChange={set("project")} required={f.type === "project_unit"} className={input}>
              <option value="">{f.type === "rfo_unit" ? "None" : "Choose a project"}</option>
              {order.map((id) => (
                <option key={id} value={id}>{projects[id].name}</option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <div className="flex justify-end">
        <button className={btn} disabled={busy}>{busy ? "Creating…" : "Create listing"}</button>
      </div>
    </form>
  );
}
