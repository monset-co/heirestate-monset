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
// when it, or one of its other names, appears in it. Buildings are their own wish, listed from
// the inventory itself (each property's Building), so a new one is a choice as soon as it's in.
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
export const AREA = Object.assign({}, ...Object.values(AREAS));

export const WISHES = ["kind", "size", "area", "building", "near", "furnishing", "budget", "when"];

// Places a client may want to be near, positioned by OpenStreetMap (scripts/inventory_geocode.py
// --landmarks). Distances are straight-line, as "within 2 km of IT Park" is meant.
export const LANDMARKS = {
  "Business districts": {
    "Cebu IT Park": [10.3308, 123.90683],
    "Cebu Business Park": [10.31617, 123.90586],
    "South Road Properties (SRP)": [10.28655, 123.887],
    "Cebu Provincial Capitol": [10.31629, 123.89001],
    "Fuente Osmeña Circle": [10.30997, 123.89248],
  },
  Malls: {
    "Ayala Center Cebu": [10.31781, 123.90458],
    "SM City Cebu": [10.3114, 123.91778],
    "SM Seaside City Cebu": [10.28127, 123.87958],
    "Robinsons Galleria Cebu": [10.30437, 123.91128],
    "Il Corso": [10.26643, 123.87781],
  },
  Hospitals: {
    "Cebu Doctors' University Hospital": [10.31446, 123.89193],
    "Chong Hua Hospital": [10.31005, 123.89111],
    "Perpetual Succour Hospital": [10.31499, 123.89963],
  },
  Schools: {
    "University of San Carlos (Talamban)": [10.35594, 123.90715],
    "University of Cebu (Banilad)": [10.33815, 123.91147],
    "Cebu International School": [10.39312, 123.9209],
  },
  Travel: {
    "Mactan-Cebu Airport": [10.31034, 123.97931],
  },
};
export const LANDMARK = Object.assign({}, ...Object.values(LANDMARKS));
export const RADII = [0.5, 1, 2, 3, 5, 10];

// kilometres between two [lat, lng] points (haversine)
export function km([a, b], [c, d]) {
  const r = (x) => (x * Math.PI) / 180;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
// how far a property is from a landmark, or null when either has no position
export const distance = (p, place) => (p.lat != null && LANDMARK[place] ? km([p.lat, p.lng], LANDMARK[place]) : null);
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
    // a building they prefer, by the property's Building
    building: lead.buildings?.length ? lead.buildings.includes(p.building) : null,
    // a property with no position yet can't be shown near; it doesn't count against, it just doesn't count
    near: lead.near && lead.near_km ? (distance(p, lead.near) ?? Infinity) <= lead.near_km : null,
    furnishing: lead.furnishings?.length ? lead.furnishings.includes(p.furnishing) : null,
    budget: lead.budget_max ? p.price != null && p.price <= lead.budget_max : null,
    // free by the day they need it: available now, or freeing up on or before it
    when: p.available_from ? (lead.needed_by ? p.available_from <= lead.needed_by : p.available_from <= today) : p.available !== false,
  };
  // still on offer, of a kind they asked for; the rest only ranks
  const offered = p.status.some((s) => ["Pre-selling", "For Rent", "For Sale", "For Assume"].includes(s)) || p.available_from > today;
  r.ok = offered && r.status !== false;
  r.km = lead.near ? distance(p, lead.near) : null;
  r.score = WISHES.filter((k) => r[k] === true).length; // wishes met, for ranking
  // the wishes the team marked as what matters most: how many are met, and whether all are
  const prio = (lead.priorities ?? []).filter((k) => r[k] !== null);
  r.prio = prio.filter((k) => r[k]).length;
  r.allPrio = r.prio === prio.length;
  return r;
}

// the best fits first: most priorities met, then most wishes, then the cheapest; with
// `onlyPriorities`, just those meeting every priority
export const matches = (lead, inventory, limit = 12, onlyPriorities = false) =>
  inventory
    .map((p) => ({ p, f: fit(lead, p) }))
    .filter((x) => x.f.ok && (!onlyPriorities || x.f.allPrio))
    .sort((a, b) => b.f.prio - a.f.prio || b.f.score - a.f.score || (a.p.price ?? Infinity) - (b.p.price ?? Infinity))
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
