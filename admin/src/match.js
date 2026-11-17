// What a client wants, as fixed choices instead of free typing, and which inventory fits it.
// Pure, so `npm test` checks it (match.test.js). The choices are matched against the inventory's
// own words (its sheet's Type and Location), which is why each carries a pattern.

// "Looking to": each maps to the inventory statuses that could serve it
export const LOOKING_TO = {
  Rent: ["For Rent", "Rented"], // rented now counts once it has a date it frees up (see `offered`)
  "Buy resale": ["For Sale"],
  "Buy pre-selling": ["Pre-selling"],
  "Assume balance": ["For Assume"],
  "Sell or lease out": [], // they bring a property; nothing to match
};

// Property type: kinds and sizes. A client's kinds are any-of, their sizes are any-of, and a
// property must fit both (when the client picked any): "House & Lot" + "3BR+" is a 3BR house.
export const KINDS = {
  Condo: /condo|studio|loft|apartment/i,
  "House & Lot": /house|h&l|bungalow|duplex|single[ -]?(de|at)tached|mansion/i,
  Townhouse: /townhouse|rowhouse/i,
  Lot: /(^|,\s*)(corner |farm |residential )?lot\s*(,|$)/i,
  Commercial: /commercial|office|warehouse|building|hotel/i,
};
export const SIZES = {
  Studio: /studio/i,
  "1BR": /\b1\s?BR\b/i,
  "2BR": /\b2\s?BR\b/i,
  "3BR+": /\b([3-9]|1\d)\s?BR\b/i,
};

// Where: Cebu City's districts, then the other cities. A name matches a property's location
// when it, or one of its other names, appears in it.
export const AREAS = {
  "Cebu City": {
    "IT Park": /it park|apas|lahug/i,
    Lahug: /lahug|nivel/i,
    Banilad: /banilad/i,
    Talamban: /talamban/i,
    Mabolo: /mabolo/i,
    "Cebu Business Park": /business park|ayala|cbp/i,
    Kasambagan: /kasambagan/i,
    Guadalupe: /guadalupe/i,
    Banawa: /banawa/i,
    Busay: /busay/i,
    "Capitol / Fuente": /capitol|fuente|osme[ñn]a|ramos/i,
    Labangon: /labangon/i,
    Tisa: /tisa/i,
    "Anywhere in Cebu City": /cebu city/i,
  },
  "Other cities": {
    Mandaue: /mandaue/i,
    "Lapu-Lapu / Mactan": /lapu|mactan/i,
    Talisay: /talisay/i,
    Minglanilla: /minglanilla/i,
    Consolacion: /consolacion/i,
    Liloan: /liloan/i,
    Cordova: /cordova/i,
    Naga: /naga/i,
  },
};
const AREA = Object.assign({}, ...Object.values(AREAS));

export const WISHES = ["kind", "size", "area", "furnishing", "budget", "when"];
export const FURNISHING = ["Fully furnished", "Furnished", "Semi-furnished", "Finished", "Unfurnished"];

// Which of a lead's wishes a property meets: { status, kind, size, area, furnishing, budget, when },
// each true, false, or null when the client didn't say. `ok` is whether it's worth showing at all.
export function fit(lead, p, today = new Date().toISOString().slice(0, 10)) {
  const statuses = (lead.looking_to ?? []).flatMap((w) => LOOKING_TO[w] ?? []);
  const kinds = (lead.property_types ?? []).filter((t) => KINDS[t]);
  const sizes = (lead.property_types ?? []).filter((t) => SIZES[t]);
  const type = p.type ?? "";
  const r = {
    status: statuses.length ? p.status.some((s) => statuses.includes(s)) : null,
    kind: kinds.length ? kinds.some((k) => KINDS[k].test(type)) : null,
    size: sizes.length ? sizes.some((k) => SIZES[k].test(type)) : null,
    area: lead.areas?.length ? lead.areas.some((a) => AREA[a]?.test(p.location ?? "")) : null,
    furnishing: lead.furnishings?.length ? lead.furnishings.includes(p.furnishing) : null,
    budget: lead.budget_max ? p.price != null && p.price <= lead.budget_max : null,
    // free by the day they need it: available now, or freeing up on or before it
    when: p.available_from ? (lead.needed_by ? p.available_from <= lead.needed_by : p.available_from <= today) : p.available !== false,
  };
  // still on offer, of a kind they asked for; the rest only ranks
  const offered = p.status.some((s) => ["Pre-selling", "For Rent", "For Sale", "For Assume"].includes(s)) || p.available_from > today;
  r.ok = offered && r.status !== false;
  r.score = WISHES.filter((k) => r[k] === true).length; // wishes met, for ranking
  return r;
}

// the best fits first: most wishes met, then the cheapest
export const matches = (lead, inventory, limit = 12) =>
  inventory
    .map((p) => ({ p, f: fit(lead, p) }))
    .filter((x) => x.f.ok)
    .sort((a, b) => b.f.score - a.f.score || (a.p.price ?? Infinity) - (b.p.price ?? Infinity))
    .slice(0, limit);

// A mobile number, tidied so the same person is typed the same way: Philippine numbers in any
// common shape become +63 917 123 4567; others keep their + and country code. null if it can't be one.
export function tidyMobile(raw) {
  const s = String(raw ?? "").trim();
  let d = s.replace(/\D/g, "");
  if (!d) return null;
  if (!s.includes("+")) {
    if (/^09\d{9}$/.test(d)) d = `63${d.slice(1)}`;
    else if (/^9\d{9}$/.test(d)) d = `63${d}`;
    else if (!/^63\d{10}$/.test(d)) return null; // no country code and not a Philippine mobile
  }
  if (d.length < 8 || d.length > 15) return null;
  return d.startsWith("63") && d.length === 12 ? `+63 ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : `+${d}`;
}

// ₱ amounts typed loosely: "120k", "1.5M", "₱45,000" → whole pesos
export function pesos(raw) {
  const m = String(raw ?? "").replace(/[₱,\s]/g, "").match(/^(\d+(?:\.\d+)?)([km])?$/i);
  if (!m) return null;
  return Math.round(Number(m[1]) * { k: 1e3, m: 1e6 }[m[2]?.toLowerCase()] || Number(m[1]));
}
