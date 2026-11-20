import { useEffect, useState } from "react";
import { supabase, run } from "../supabase";
import { Live, LiveLi, SkeletonRows } from "../motion";
import { Empty, ErrorNote, card } from "../ui";
import { when } from "../crm";

// field names as people say them
const NAMES = {
  title: "Title", slug: "Address", type: "Type", project: "Project", location: "Location", price_min: "Price", price_max: "Price up to",
  unit_type: "Unit type", floor_area: "Floor area", description: "Description", status: "Status", lts_no: "License to Sell no.",
  owner_authority: "Owner's authority", published: "Published", published_at: "First published", agent_id: "Agent", alt: "Description", sort: "Order",
  storage_key: "Photo", name: "Name", email: "Email", phone: "Mobile", active: "Active", value: "Value",
  stage: "Stage", lost_reason: "Lost because", mobile: "Mobile", interest: "Interest", budget: "Budget", viewing_time: "Viewing",
  message: "Message", body: "Text", due_at: "Due", done_at: "Done", emailed_at: "Emailed",
};
// what each kind of row is, when it's added or removed
const KINDS = { listing_photos: ["Added a photo", "Removed a photo"], lead_notes: ["Added a note", "Removed a note"], reminders: ["Set a reminder", "Removed a reminder"], leads: ["Inquiry received", "Deleted it"] };
const QUIET = new Set(["id", "created_at", "updated_at", "listing_id", "lead_id", "emailed_at"]);
const show = (v) => {
  if (v == null || v === "") return "empty";
  if (typeof v === "boolean") return v ? "yes" : "no";
  const s = String(v);
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
};

// The activity log for one record (and, with `also`, its children, e.g. a listing's photos), or for
// a lead with its notes and reminders: who changed what, newest first.
export default function Activity({ entity, id, also, lead }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const cols = "id, entity, entity_id, user_email, action, changes, at";
    Promise.all([
      lead
        ? run(supabase.from("activity").select(cols).eq("lead_id", lead).order("at", { ascending: false }).limit(300))
        : run(supabase.from("activity").select(cols).eq("entity", entity).eq("entity_id", String(id)).order("at", { ascending: false }).limit(200)),
      also ? run(supabase.from("activity").select(cols).eq("entity", also.entity).eq(`changes->>${also.parent}`, String(id)).limit(200)) : [],
    ]).then(([a, b]) => setRows([...a, ...b].sort((x, y) => y.at.localeCompare(x.at))), (e) => setError(e.message));
  }, [entity, id, lead]);

  const what = (r) => {
    const photo = r.entity === "listing_photos";
    const [added, removed] = KINDS[r.entity] ?? ["Created it", "Deleted it"];
    if (r.action === "insert") return r.entity === "lead_notes" ? `${added}: ${show(r.changes?.body)}` : added;
    if (r.action === "delete") return removed;
    const changes = Object.entries(r.changes ?? {}).filter(([k]) => !QUIET.has(k));
    return (
      <ul className="mt-1 grid gap-0.5">
        {changes.map(([k, [from, to]]) => (
          <li key={k}>
            <span className="text-muted">{photo ? `Photo ${(NAMES[k] ?? k).toLowerCase()}` : NAMES[k] ?? k}:</span> {show(from)} <span aria-label="to">→</span> <span className="text-fg">{show(to)}</span>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className={`${card} max-w-3xl`}>
      <ErrorNote error={error} />
      {!rows ? (
        <SkeletonRows />
      ) : !rows.length ? (
        <Empty>No changes recorded yet.</Empty>
      ) : (
        <ul className="divide-y divide-line">
          <Live>
            {rows.map((r, i) => (
              <LiveLi key={r.id} i={i} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-fg">{r.user_email ?? (r.entity === "leads" ? "Website form" : "The system")}</span>
                  <time dateTime={r.at} className="text-xs text-muted tabular-nums">{when(r.at)}</time>
                </div>
                <div className="text-charcoal">{what(r)}</div>
              </LiveLi>
            ))}
          </Live>
        </ul>
      )}
    </div>
  );
}
