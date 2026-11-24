// One deployment, one site per host name: wave.<domain>/ serves /wave/ (and its own robots.txt and
// sitemap.xml), www.<domain> goes to the bare domain, and a project's page asked for at a path on
// any other host (<domain>/wave/, alto.<domain>/wave/) goes to its own subdomain for good, so each
// page has one address. Only these paths reach the worker (run_worker_first in wrangler.jsonc,
// which build.js checks lists every project); everything else is served straight from dist/all.
import { order } from "./src/projects.js";
import { serve } from "./src/listings/serve.js";
import { inquiry } from "./src/listings/inquiry.js";

// public/_headers only reaches the static files; what this Worker makes itself (listing pages,
// photos, the sitemap, the form's answers, redirects) gets the same baseline here. A header the
// response already has (from _headers, or set on purpose) is left as it is.
const BASELINE = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};

export default {
  async fetch(req, env, ctx) {
    const res = await route(req, env, ctx);
    const out = new Response(res.body, res); // a copy: cached and redirect responses are read-only
    for (const [k, v] of Object.entries(BASELINE)) if (!out.headers.has(k)) out.headers.set(k, v);
    return out;
  },
};

function route(req, env, ctx) {
  const url = new URL(req.url);
  const [sub, ...rest] = url.hostname.split(".");
  const apex = order.includes(sub) || sub === "www" ? rest.join(".") : url.hostname;
  if (sub === "www") return Response.redirect(`https://${apex}${url.pathname}${url.search}`, 301);

  // previews (*.workers.dev) have no subdomains to send anyone to
  const preview = url.hostname.endsWith("workers.dev");
  // the enquiry form on every site (src/listings/inquiry.js)
  if (url.pathname === "/api/inquiries") return inquiry(req, env, { url, site: order.includes(sub) ? sub : null });
  // the listings, drawn from the admin's database on every host (src/listings/serve.js)
  if (/^\/(listings(\/|$)|photos\/|sitemap\.xml$)/.test(url.pathname))
    return serve(req, env, ctx, { url, site: order.includes(sub) ? sub : null, apex, preview });

  const first = url.pathname.split("/")[1];
  if (order.includes(first) && !preview) {
    const path = url.pathname.slice(first.length + 1).replace(/^\/?index\.html$/, "/") || "/";
    return Response.redirect(`https://${first}.${apex}${path}${url.search}`, 301);
  }

  if (order.includes(sub)) url.pathname = `/${sub}${url.pathname}`;
  return env.ASSETS.fetch(new Request(url, req));
}
