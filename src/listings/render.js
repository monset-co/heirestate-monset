// The public listing pages, written by worker.js (src/listings/serve.js) from the admin's database
// and laid into each site's own page shell, so they wear that site's palette and type. This file
// sits under src/ so Tailwind sees its classes; it also runs in the Worker, so it imports nothing
// that needs a browser or Vite.
import { projects } from "../projects.js";
import { TYPES, STATUSES, NOTICE, price } from "./types.js";

export { TYPES, STATUSES, NOTICE, price };

const area = (l) => (l.floor_area ? `${Number(l.floor_area).toLocaleString("en-PH")} sqm` : "");
const projectName = (id) => projects[id]?.name ?? "";

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const paragraphs = (s) =>
  String(s ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");

const GUTTER = "px-[clamp(16px,4vw,64px)]";

// the bar across the top: the site's name home, and the listings
function bar(site, home) {
  return `<header class="bg-navy-deep text-paper">
  <div class="mx-auto flex max-w-[1480px] items-center justify-between gap-4 py-4 ${GUTTER}">
    <a href="${esc(home)}" class="font-display text-[1.35rem] tracking-[-0.01em] hover:text-champagne">${esc(site ? projectName(site) : "Heir Estates")}</a>
    <a href="/listings" class="font-inscription text-[0.78rem] tracking-[0.24em] uppercase hover:text-champagne">Listings</a>
  </div>
</header>`;
}

function foot(home) {
  return `<footer class="border-t border-ink/10">
  <div class="mx-auto flex max-w-[1480px] flex-wrap justify-between gap-4 py-6 text-[0.85rem] text-charcoal/70 ${GUTTER}">
    <span>© ${new Date().getFullYear()} Heir Estates</span>
    <span>${esc(NOTICE)}</span>
    <a href="${esc(home)}" class="text-ink underline-offset-4 hover:underline">Home</a>
  </div>
</footer>`;
}

const badge = (l) =>
  l.status === "reserved" || l.status === "sold"
    ? `<span class="rounded-full bg-burgundy px-2.5 py-0.5 font-inscription text-[0.7rem] tracking-[0.14em] text-paper uppercase">${STATUSES[l.status]}</span>`
    : "";

// one card in a carousel; href is the listing's one address (a project's units live on its own site)
function card(l, href, photo) {
  const meta = [l.unit_type, area(l)].filter(Boolean).join(" · ");
  return `<li class="w-[min(80vw,340px)] shrink-0 snap-start">
  <a href="${esc(href)}" class="group block">
    <div class="aspect-[4/3] overflow-hidden rounded-md bg-stone">
      ${photo ? `<img src="${esc(photo)}" alt="" loading="lazy" decoding="async" class="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]">` : ""}
    </div>
    <div class="mt-3 flex items-start justify-between gap-3">
      <h3 class="font-display text-[1.3rem] leading-tight text-ink">${esc(l.title)}</h3>${badge(l)}
    </div>
    ${l.location ? `<p class="mt-1 text-[0.9rem]">${esc(l.location)}</p>` : ""}
    <p class="mt-2 font-medium text-ink tabular-nums">${esc(price(l))}</p>
    ${meta ? `<p class="mt-0.5 text-[0.85rem] text-charcoal/75">${esc(meta)}</p>` : ""}
  </a>
</li>`;
}

// The listings page: one carousel per type that has anything in it.
// hrefOf(l) and photoOf(l) give each listing's address and cover picture.
export function indexBody({ site, home, listings, hrefOf, photoOf }) {
  const groups = Object.entries(TYPES)
    .map(([type, t]) => [t, listings.filter((l) => l.type === type)])
    .filter(([, ls]) => ls.length);
  const heading = site ? `Units at ${projectName(site)}` : "Listings";
  return `${bar(site, home)}
<main class="pb-24">
  <div class="mx-auto max-w-[1480px] pt-[clamp(40px,8vh,96px)] ${GUTTER}">
    <p class="font-inscription text-[0.78rem] tracking-[0.3em] text-gold-ink uppercase">Heir Estates</p>
    <h1 class="mt-3 font-display text-[clamp(2.6rem,6vw,5rem)] leading-[0.95] tracking-[-0.02em] text-ink">${esc(heading)}</h1>
    <p class="mt-4 max-w-prose">${esc(NOTICE)}</p>
  </div>
  ${
    groups.length
      ? groups
          .map(
            ([t, ls]) => `<section class="mt-[clamp(40px,7vh,80px)]" aria-label="${esc(t.plural)}">
    <h2 class="mx-auto max-w-[1480px] font-display text-[clamp(1.8rem,3vw,2.4rem)] text-ink ${GUTTER}">${esc(t.plural)}</h2>
    <ul class="mx-auto mt-5 flex max-w-[1480px] snap-x snap-mandatory scroll-px-[clamp(16px,4vw,64px)] gap-6 overflow-x-auto pb-4 ${GUTTER}">
      ${ls.map((l) => card(l, hrefOf(l), photoOf(l))).join("")}
    </ul>
  </section>`
          )
          .join("")
      : `<p class="mx-auto mt-12 max-w-[1480px] ${GUTTER}">Nothing is listed right now. <a href="${esc(home)}#enquiry" class="text-ink underline underline-offset-4">Ask the agents</a> what's coming.</p>`
  }
</main>
${foot(home)}`;
}

// One listing's page. photoUrl(key) is a photo's address; broker is the settings' broker.
export function listingBody({ site, home, l, photos, photoUrl, broker, agent }) {
  const t = TYPES[l.type];
  const facts = [
    ["Type", t.label],
    ["Project", projectName(l.project)],
    ["Location", l.location],
    ["Unit type", l.unit_type],
    ["Floor area", area(l)],
    ["Status", STATUSES[l.status]],
    ["License to Sell no.", t.project ? l.lts_no : ""],
  ].filter(([, v]) => v);
  const [first, ...rest] = photos;
  return `${bar(site, home)}
<main class="mx-auto max-w-[1480px] pb-24 ${GUTTER}">
  <nav aria-label="Breadcrumb" class="pt-6 text-[0.9rem]"><a href="/listings" class="underline-offset-4 hover:underline">All listings</a> <span aria-hidden="true">/</span> <span aria-current="page">${esc(l.title)}</span></nav>
  <header class="mt-[clamp(24px,5vh,56px)]">
    <p class="font-inscription text-[0.78rem] tracking-[0.3em] text-gold-ink uppercase">${esc([t.label, projectName(l.project)].filter(Boolean).join(" · "))}</p>
    <h1 class="mt-3 font-display text-[clamp(2.4rem,5.5vw,4.6rem)] leading-[0.98] tracking-[-0.02em] text-ink">${esc(l.title)}</h1>
    ${l.location ? `<p class="mt-3 text-[1.05rem]">${esc(l.location)}</p>` : ""}
  </header>
  ${
    first
      ? `<figure class="mt-8 aspect-[3/2] max-h-[78vh] w-full overflow-hidden rounded-md bg-stone">
    <img src="${esc(photoUrl(first.key))}" alt="${esc(first.alt || l.title)}" fetchpriority="high" class="h-full w-full object-cover">
  </figure>`
      : ""
  }
  ${
    rest.length
      ? `<ul class="mt-4 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-3" aria-label="More photos">
    ${rest.map((p) => `<li class="w-[min(70vw,320px)] shrink-0 snap-start"><a href="${esc(photoUrl(p.key))}" class="block aspect-[4/3] overflow-hidden rounded-md bg-stone"><img src="${esc(photoUrl(p.key))}" alt="${esc(p.alt || "")}" loading="lazy" decoding="async" class="h-full w-full object-cover"></a></li>`).join("")}
  </ul>`
      : ""
  }
  <div class="mt-12 grid gap-12 lg:grid-cols-[1fr_24rem]">
    <div class="max-w-prose space-y-4 text-[1.05rem] leading-relaxed">${paragraphs(l.description) || `<p>Ask the agents for this listing's details.</p>`}</div>
    <aside class="h-fit rounded-lg bg-stone/60 p-6 lg:sticky lg:top-6">
      <div class="flex items-center justify-between gap-3">
        <p class="font-display text-[1.9rem] leading-tight text-ink tabular-nums">${esc(price(l))}</p>${badge(l)}
      </div>
      <dl class="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[0.92rem]">
        ${facts.map(([k, v]) => `<dt class="text-charcoal/75">${esc(k)}</dt><dd class="text-ink">${esc(v)}</dd>`).join("")}
      </dl>
      ${l.status === "sold" ? "" : `<a href="${esc(home)}?listing=${esc(l.slug)}#enquiry" class="mt-6 flex min-h-12 items-center justify-center rounded-md bg-navy px-5 text-paper transition-colors hover:bg-navy-raised">Ask about this listing</a>`}
      ${agent ? `<p class="mt-4 text-[0.9rem]">${esc(agent.name)}${agent.phone ? `, <a href="tel:${esc(agent.phone.replace(/[^\d+]/g, ""))}" class="underline underline-offset-4">${esc(agent.phone)}</a>` : ""}</p>` : ""}
      <div class="mt-6 border-t border-ink/10 pt-4 text-[0.85rem] leading-relaxed">
        <p>${esc(broker.name)}, licensed real estate broker, PRC licence no. ${esc(broker.prc)}${
          broker.valid_until ? `, valid until ${esc(new Date(`${broker.valid_until}T12:00:00`).toLocaleDateString("en-PH", { dateStyle: "long" }))}` : ""
        }${broker.firm ? `, ${esc(broker.firm)}` : ""}.</p>
        <p class="mt-2">${esc(NOTICE)}</p>
      </div>
    </aside>
  </div>
</main>
${foot(home)}`;
}
