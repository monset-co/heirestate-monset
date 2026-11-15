// What a listing needs before it can be saved, and before it can go public. The admin app checks
// here first to say why in plain words; the database enforces the same rules whatever sends the
// change (supabase/migrations: its CHECK constraints and the listings_guard trigger).
import { TYPES, STATUSES } from "./types.js";

const str = (v, max) => (v == null ? null : String(v).trim().slice(0, max) || null);
const num = (v, int) => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? (int ? Math.round(n) : n) : NaN;
};
export const slugify = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");

// the form's fields laid over the listing as it was (or a new one's defaults), as the columns hold them
export function shape(b, before = {}) {
  const pick = (k, f) => (b[k] === undefined ? before[k] ?? null : f(b[k]));
  const l = {
    title: pick("title", (v) => str(v, 150)),
    slug: pick("slug", (v) => str(v, 80)),
    type: pick("type", (v) => str(v, 20)),
    project: pick("project", (v) => str(v, 40)),
    location: pick("location", (v) => str(v, 200)),
    price_min: pick("price_min", (v) => num(v, true)),
    price_max: pick("price_max", (v) => num(v, true)),
    unit_type: pick("unit_type", (v) => str(v, 80)),
    floor_area: pick("floor_area", (v) => num(v)),
    description: pick("description", (v) => str(v, 8000)),
    status: pick("status", (v) => str(v, 20)) ?? "available",
    lts_no: pick("lts_no", (v) => str(v, 60)),
    owner_authority: pick("owner_authority", (v) => !!v) ?? false,
    published: pick("published", (v) => !!v) ?? false,
    agent_id: pick("agent_id", (v) => num(v, true)),
  };
  if (!l.slug) l.slug = slugify(l.title);
  if (TYPES[l.type] && !TYPES[l.type].project) l.project = null;
  if (l.price_min != null && l.price_max === l.price_min) l.price_max = null;
  return l;
}

// why this listing can't be saved as it is, or "". projects: the project ids in src/projects.js
export function check(l, before, broker, projects) {
  if (!l.title || l.title.length < 2) return "Enter a title";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(l.slug ?? "")) return "The address can only use lowercase letters, numbers and single hyphens";
  if (before?.published_at && l.slug !== before.slug) return "The address can't change once the listing has been published";
  if (!TYPES[l.type]) return "Choose a listing type";
  if (l.project && !projects.includes(l.project)) return "Choose a project from the list";
  if (l.type === "project_unit" && !l.project) return "A project unit needs its project";
  if ([l.price_min, l.price_max, l.floor_area, l.agent_id].some(Number.isNaN)) return "Prices and floor area must be numbers";
  if (l.price_max != null && l.price_min == null) return "Enter the lowest price, or a single price";
  if (l.price_max != null && l.price_max < l.price_min) return "The highest price is below the lowest";
  if (!STATUSES[l.status]) return "Choose a status";
  if (l.published) {
    if (TYPES[l.type].project && !l.lts_no) return "Add the DHSUD License to Sell no. before publishing";
    if (!TYPES[l.type].project && !l.owner_authority) return "The owner's authority must be on file before publishing";
    if (!broker.broker_name || !broker.broker_prc_no) return "Add the broker's name and PRC licence no. in Settings before publishing";
  }
  return "";
}
