// /listings, /listings/<slug>, /photos/<key> and each site's sitemap.xml, for worker.js. The data
// comes from Supabase with the publishable (anon) key, which can only call public_listings() and
// public_listing() and read the photos of public listings (supabase/migrations): this Worker holds
// no secret and never sees a draft, a lead or a user. Pages are cached for a minute at Cloudflare's
// edge, so an edit in the admin is live within a minute, with no redeploy.
//
// Each listing has one address: a listing with a project lives on that project's site
// (wave.<domain>/listings/<slug>), the rest on the collection; the other hosts redirect there.
import { TYPES, indexBody, listingBody, esc, price } from "./render.js";
import { projects } from "../projects.js";

const MINUTE = "public, max-age=60";

// Supabase, as the public: SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in wrangler.jsonc's vars
function supabase(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) return null;
  const key = env.SUPABASE_PUBLISHABLE_KEY;
  // a legacy anon key is a JWT and goes as the bearer too; a publishable key goes alone
  const headers = { apikey: key, ...(key.startsWith("eyJ") && { Authorization: `Bearer ${key}` }) };
  const rpc = async (fn, args) => {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!r.ok) throw new Error(`Supabase ${fn}: ${r.status}`);
    return r.json();
  };
  return {
    listings: (project) => rpc("public_listings", { p_project: project }),
    listing: (slug) => rpc("public_listing", { p_slug: slug }),
    // the bucket is private; its policy lets the public read a photo only while its listing is public
    async photo(key) {
      if (!/^\d+\/[0-9a-f-]{36}\.webp$/.test(key)) return null;
      const r = await fetch(`${env.SUPABASE_URL}/storage/v1/object/authenticated/listing-photos/${key}`, { headers });
      return r.ok ? { body: r.body, type: r.headers.get("Content-Type") ?? "image/webp" } : null;
    },
  };
}

export async function serve(req, env, ctx, { url, site, apex, preview }) {
  const path = url.pathname;
  const db = supabase(env);
  // previews (*.workers.dev) have no subdomains: every page is served where it is asked for
  const at = (project, p) => (preview ? `${url.origin}${p}` : `https://${project ? `${project}.` : ""}${apex}${p}`);
  const home = (l) => l.project ?? null;
  // a plain request (no If-None-Match from the visitor), so the shell always comes back whole
  const asset = (p) => env.ASSETS.fetch(new URL(site ? `/${site}${p}` : p, url));
  const notFound = () => env.ASSETS.fetch(new URL("/listings/__none__", url)); // the house 404 page, with a 404

  if (path === "/sitemap.xml") {
    const xml = await (await asset("/sitemap.xml")).text();
    const all = db ? await db.listings(site).catch(() => []) : [];
    const mine = all.filter((l) => l.status !== "sold" && (preview || home(l) === site));
    const urls = [`<url><loc>${at(site, "/listings")}</loc></url>`].concat(
      mine.map(
        (l) =>
          `<url><loc>${esc(at(site, `/listings/${l.slug}`))}</loc><lastmod>${l.updated_at.slice(0, 10)}</lastmod>${
            l.cover ? `<image:image><image:loc>${esc(at(site, `/photos/${l.cover}`))}</image:loc></image:image>` : ""
          }</url>`
      )
    );
    return new Response(xml.replace("</urlset>", `${urls.join("")}</urlset>`), {
      headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": MINUTE },
    });
  }
  if (!db || (req.method !== "GET" && req.method !== "HEAD")) return notFound();

  // keyed by address alone, so HEAD (crawlers, link checkers) shares GET's copy
  const cache = caches.default;
  const key = url.toString();
  const hit = await cache.match(key);
  if (hit) return hit;

  let res;
  if (path.startsWith("/photos/")) {
    const photo = await db.photo(decodeURIComponent(path.slice(8)));
    if (!photo) return notFound();
    // a photo's name never changes (a new picture gets a new name)
    res = new Response(photo.body, {
      headers: { "Content-Type": photo.type, "Cache-Control": "public, max-age=604800", "X-Content-Type-Options": "nosniff" },
    });
  } else if (path === "/listings" || path === "/listings/") {
    const all = (await db.listings(site)).filter((l) => l.status !== "sold");
    const name = site ? `Units at ${projects[site].name}` : "Listings";
    res = await page(asset, {
      title: `${name} | Heir Estates`,
      description: site
        ? `Pre-selling and ready-for-occupancy units at ${projects[site].name}, with prices, floor areas and photos.`
        : "Condos, homes, rentals and lots in Cebu from Heir Estates, with prices, floor areas and photos.",
      canonical: at(site, "/listings"),
      body: indexBody({
        site,
        home: at(site, "/"),
        listings: all,
        hrefOf: (l) => at(home(l), `/listings/${l.slug}`),
        photoOf: (l) => l.cover && at(home(l), `/photos/${l.cover}`),
      }),
    });
  } else {
    const slug = path.slice("/listings/".length).replace(/\/$/, "");
    const found = /^[a-z0-9-]+$/.test(slug) && (await db.listing(slug));
    if (!found) return notFound();
    const { listing: l, photos, broker, agent } = found;
    if (!preview && home(l) !== site) return Response.redirect(at(home(l), `/listings/${l.slug}`), 301);
    const photoUrl = (key) => at(home(l), `/photos/${key}`);
    const canonical = at(home(l), `/listings/${l.slug}`);
    const where = [l.unit_type, l.project && projects[l.project]?.name, l.location].filter(Boolean).join(", ");
    res = await page(asset, {
      title: `${l.title}${l.location ? `, ${l.location}` : ""} | Heir Estates`,
      description: `${TYPES[l.type].label}${where ? `: ${where}` : ""}. ${price(l)}.`.slice(0, 300),
      canonical,
      image: photos[0] && photoUrl(photos[0].key),
      ld: {
        "@context": "https://schema.org",
        "@type": "RealEstateListing",
        name: l.title,
        url: canonical,
        datePosted: l.published_at?.slice(0, 10),
        image: photos.map((p) => photoUrl(p.key)),
        ...(l.description && { description: l.description.slice(0, 500) }),
        ...(l.price_min != null && {
          offers: {
            "@type": "Offer",
            priceCurrency: "PHP",
            ...(l.price_max != null && l.price_max !== l.price_min ? { lowPrice: l.price_min, highPrice: l.price_max } : { price: l.price_min }),
            availability: l.status === "available" ? "https://schema.org/InStock" : l.status === "reserved" ? "https://schema.org/LimitedAvailability" : "https://schema.org/SoldOut",
          },
        }),
        ...(l.floor_area && { about: { "@type": "Accommodation", floorSize: { "@type": "QuantitativeValue", value: l.floor_area, unitCode: "MTK" } } }),
      },
      body: listingBody({ site, home: at(site, "/"), l, photos, photoUrl, broker, agent }),
    });
  }
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

// The site's own page (its head, palette and fonts) with this page's title, description, address
// and content in place of the app: no scripts, nothing to hydrate.
async function page(asset, { title, description, canonical, image, ld, body }) {
  const shell = await asset("/");
  const set = (attr, v) => ({ element: (e) => (v ? e.setAttribute(attr, v) : e.remove()) });
  const out = new HTMLRewriter()
    .on("title", { element: (e) => e.setInnerContent(title) })
    .on('meta[name="description"], meta[property="og:description"]', set("content", description))
    .on('meta[property="og:title"]', set("content", title))
    .on('meta[property="og:url"]', set("content", canonical))
    .on('link[rel="canonical"]', set("href", canonical))
    .on('meta[property="og:image"]', set("content", image))
    .on('meta[property="og:image:alt"]', set("content", image && title))
    .on('link[rel="preload"][as="image"]', { element: (e) => e.remove() })
    // the app's scripts go; the analytics beacon stays, so listing visits count
    .on("script:not([data-cf-beacon])", { element: (e) => e.remove() })
    .on("head", {
      element: (e) => ld && e.append(`<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`, { html: true }),
    })
    .on("body", { element: (e) => e.setInnerContent(body, { html: true }) })
    .transform(shell);
  const res = new Response(out.body, out);
  res.headers.set("Cache-Control", MINUTE);
  res.headers.delete("ETag");
  return res;
}
