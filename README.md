# Heir Estates

Showcase site for Heir Estates's projects. Vite + React + Tailwind v4, Motion, anime.js, Three.js.

```
npm install
npm run dev                  # every site at once: the collection on 5173, alto 5174, wave 5175, pristina 5176
npx vite --mode wave         # just one project's site; any id in src/projects.js `order`
npm run build                # every site, into dist/<site>/
```

## Sites and SEO

One codebase, one site per project: the collection, and each project's own page with its own title, description, canonical URL, Open Graph tags, JSON-LD, robots.txt and sitemap.xml (`sites.js`), its text written into the HTML so crawlers read it without running JavaScript.

`npm run build` builds every site into `dist/<site>/` and puts them together in `dist/all/`, which is what Cloudflare serves (`wrangler.jsonc`, deployed on every push to `main`): the collection at `/`, each project at `/<id>/`, all sharing one set of media and assets.

- **On heirestates.com** (the default, `DOMAIN` in `src/lib/links.js`): the collection on the bare domain, each project on its subdomain (`wave.heirestates.com`). `worker.js` serves `/wave/` to anyone arriving on `wave.<domain>`, and sends `www` to the bare domain.
- **On one address without subdomains:** build with `VITE_DOMAIN=""` and `SITE_HOST=<address>`; projects live at `/wave/` and links between the sites are paths.

On the main site, project links are real links to the subdomains (crawlers and new tabs follow them); a plain click still opens the project in place over the facade.

**Search and answer engines** read the same data the pages draw (`src/lib/seo.js`): each project's questions and answers, shown on its page (`Faq.jsx`) and marked up as `FAQPage`; its full account written into the HTML for crawlers that do not run scripts; and its schema.org graph (`sites.js`): the project as an `ApartmentComplex` with its address, homes, amenities and each unit type's `FloorPlan`, and on every site the house (`Organization`) and its agents (`RealEstateAgent`). Each project's `seo.title` and `seo.description` are what a search result shows. `public/privacy/` is the privacy notice the enquiry form links to; `public/404.html` answers missing addresses; `public/_headers` sets caching and HTTPS headers.

A new project needs an entry in `src/projects.js` (and `order`), its path in `run_worker_first` in `wrangler.jsonc` (the build stops if it is missing), its media in `public/media/p/`, and its subdomain added as a custom domain on the Cloudflare Worker.

- `src/projects.js`: the five facade windows and each project's page content.
- `resources/` (not in git) holds the client's raw files; web cuts live in `public/media/`.

**Hero films** (`public/media/p/<id>-hero.mp4`, used by the collection's hero and each project's): one drone shot from the developer's film, cut at 1080p and 30fps, slowed with motion interpolation (never frame-doubled), cropped clear of any burned-in logo, and looped by dissolving its last second into its first. Each has a 960px cut for phones (`-sm.mp4`, chosen by `src/lib/film.js`) and a poster (`.jpg`). The collection's hero shows one at a time, crossfading in over the one before only once the next can play.

**Between the sites**, the destination's colour grows out of what was clicked with its name settling in the middle (`leave()` in `src/lib/links.js`), and the next site's very first frame is that same card (`html[data-arrive]::before`, written by `sites.js` from the same `ARRIVE` style), which lifts once its page has drawn. Pointing at a link to another site prefetches it (`src/main.jsx`).

Credits: the floating nav follows [Skiper UI](https://skiper-ui.com) (skiper02) and VengeanceUI's notch-navbar ([MIT](https://github.com/Ashutoshx7/VengeanceUI)).

## Scroll descent frames

`public/frames/<project>/` holds the frame sequences the portfolio scrubs on scroll (`src/lib/frames.js`, counts in `COUNTS`). Cut from the films in `resources/`:

```
ffmpeg -ss 90   -t 9.3 -i "resources/Alto Ranudo/Copy of Alto Walkthrough.mp4"        -vf "reverse,fps=10"                            -c:v libwebp -quality 72 public/frames/alto/%03d.webp
ffmpeg -ss 8.4  -t 2.9 -i "resources/the wave/The Wave Towers AVP.mp4"             -vf "fps=22"                                    -c:v libwebp -quality 72 public/frames/wave/%03d.webp
ffmpeg -ss 51.6 -t 5.2 -i "resources/pristina town/Pristina Town_Walkthrough (1).mp4" -vf "crop=1920:960:0:0,fps=12" -c:v libwebp -quality 72 public/frames/pristina/%03d.webp
```

## The Wave's films

The site opens on the brand film's first 11.6 s (`src/sections/FilmHero.jsx`), with its first and last frames as stills:

```
ffmpeg -t 11.6 -i "resources/the wave/The Wave Towers AVP.mp4" -vf scale=1920:-2 -c:v libx264 -preset slow -crf 25 -g 48 -pix_fmt yuv420p -movflags +faststart -an public/media/p/wave-intro.mp4
ffmpeg -ss 0.4  -i "resources/the wave/The Wave Towers AVP.mp4" -frames:v 1 -vf scale=1920:-2 -q:v 4 public/media/p/wave-intro.jpg
ffmpeg -ss 11.4 -i "resources/the wave/The Wave Towers AVP.mp4" -frames:v 1 -vf scale=1920:-2 -q:v 4 public/media/p/wave-intro-end.jpg
```

The unit video tours (`src/sections/TourPlayer.jsx`; each stop's time in `src/projects.js`) are 720p with a keyframe every half second, so jumping to a room is quick. The one-bedroom film skips 23.5–30 s, where someone crosses the shot; each poster is the first frame (`-ss 0.3 -frames:v 1 -q:v 5`):

```
ffmpeg -i "resources/the wave/1br-walkthrough the wave.mp4" -filter_complex "[0:v]trim=0:23.5,setpts=PTS-STARTPTS[a];[0:v]trim=30:44.5,setpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=1:a=0,scale=1280:-2" -c:v libx264 -preset slow -crf 25 -g 15 -pix_fmt yuv420p -movflags +faststart -an public/media/p/wave-tour-1br.mp4
ffmpeg -i "resources/the wave/2br-walkthrough the wave.mov" -vf scale=1280:-2 -c:v libx264 -preset slow -crf 28 -g 15 -pix_fmt yuv420p -movflags +faststart -an public/media/p/wave-tour-2br.mp4
ffmpeg -i "resources/the wave/3br-walkthrough the wave.mov" -vf scale=1280:-2 -c:v libx264 -preset slow -crf 28 -g 15 -pix_fmt yuv420p -movflags +faststart -an public/media/p/wave-tour-3br.mp4
```

From the brochure (`resources/the wave/The wave.pdf`, PyMuPDF): `wave-enso.webp` is the master-plan render on page 13, laid on the brochure's navy (`#26345f`) and cropped square.

The residences (`src/sections/Residences.jsx`) use the brochure's unit renders (`wave-unit-<type>.webp`, pages 44, 50, 60 and 73, saved 1920 wide) and its 35 floor plans (`wave-plan-<layout>.webp`, pages 46 to 86): each plan page rendered at 130 dpi, cropped to the drawing and its area table (`Rect(300, 66, 945, 512)`), with the page title and "Tower 1" painted over in the page colour. Every layout's total area, transcribed from those tables, is in `src/projects.js`. The sixth-floor plan in Spaces (`wave-amenity-plan.webp`, page 19) is the brochure's landscape image joined to its own transparency mask (it is stored as two images) and laid on the plan pages' colour.

The Wave's amenity photos (`public/media/p/wave-<space>.webp`, the Spaces story) are the full renders embedded in `resources/the wave/The wave.pdf`, pages 16 to 31, pulled out at their own resolution (PyMuPDF `extract_image`) and saved at 1920 wide: `ffmpeg -i <render>.jpeg -vf scale=1920:-2 -c:v libwebp -quality 74`.

Unit photos in `public/media/p/unit-studio-*` and `unit-1br-*` are the brochure squares with their label bar cropped off: `-vf "crop=1080:1000:0:0,scale=760:-2"`.

## Alto Ranudo's site

Green and geometric where The Wave is navy and ink: its `theme` in `src/projects.js` repaints the house colour tokens with the deck's forest green and bronze (written into the page head by `sites.js`), and its `motif: "fins"` swaps the brush edge and crossfades for the facade's fins (`src/lib/fins.js`): fins along the edge of every dark section (`FinEdge.jsx`), a louvre wipe between arrival photos, the amenities as a louvre of slats, a ruled grid behind its paper sections and registration marks on its frames (`Corners.jsx`). Everything comes from `resources/Alto Ranudo/`:

- `alto-intro.mp4` and its stills: the first 12.6 s of "Extended Alto Ranudo Video Walkthrough.mp4", cut as The Wave's intro is (`-crf 29`).
- Renders (`alto-<space>.webp`, `alto-ext-*`, `alto-podium`), floor plates (`alto-floor-<level>.webp`) and unit plans (`alto-plan-*`): the deck PDF's own images at full size, each joined to its transparency mask and laid on `#e2e1dc`, plates and plans at most 1600 wide.
- Unit photos: frames of the extended film at 138, 144, 147 and 152 s, cropped clear of its caption tag (`crop=1214:850:353:0,scale=1000:700`), and the deck's bare-unit renders; the unit banners are the same frames at 1920 by 823.

## North Grove at Pristina Town's site

The project id stays `pristina` (it is in every address); the site leads with North Grove, as its plans do. Its hand is the land, `motif: "contours"`: topographic rings that draw themselves in behind sections (`Contours.jsx`), a ridgeline of hills on the edge of every dark section (`Edge.jsx`), spaces that open in a widening ring, and the plans' plumeria (`Plumeria.jsx`), all drawn from seeds in `src/lib/topo.js`. Its palette is the plans' own paper, olive and unit colours (`--color-grove-*`, `--color-unit-*`).

From `resources/pristina town/`: `grove-intro.mp4` is the town film's first 6.3 s; the floor plates (`grove-lumina-*`, `grove-terra-*`) and unit sheets (`grove-sheet-*`) are the developer's own sheets as webp, the unit photographs cropped from the sheets (`crop=630:542:0:0`). The payment terms are the shape of the sample term sheet's scheme, without its figures.


## Admin (admin.heirestates.com)

A private, installable app for leads, listings and the commission log. The app is `admin/`. Cloudflare serves it (`wrangler.admin.jsonc`), and it talks to **Supabase** directly as the signed-in user: Postgres for the data, Supabase Auth for passwords, Supabase Storage for listing photos. A small Worker beside it (`admin/worker/`) does only what needs a secret. Its look and motion follow the Monset dashboard: the rail, tab bar and More sheet, the sliding tabs, rows that stagger in, and toasts.

**What it has**

- **Dashboard:** new inquiries, open deals, sales this year and follow-ups due; visits per site for the last 7, 30 or 90 days (Cloudflare Web Analytics); deals by stage; the latest inquiries.
- **Leads:** every inquiry from the six sites, emailed to its agent the moment it arrives. Each lead has tabs: Overview (contact details, stage, agent, lost reason), Notes, Reminders (emailed when due) and Activity. **Delete on request** removes the lead with its notes, reminders and history, leaving one line saying who deleted lead #n and when (Data Privacy Act).
- **Listings:** add, edit, photos, publishing (see below).
- **Commissions:** each sale (date of sale, project or listing, unit code, payment mode, whether it came through the sites), each release of commission on it (paid on, gross, full or partial), and cancellations. **Monthly report** prints, or downloads as CSV, the contract's Annex B for any month, with no buyer details. No fees are worked out: the "Sale no. in Season" and "Fee due" columns are left blank to fill in.
- **Users** and **Settings**: the licensed broker (shown on every listing page), the default agent and the contract date, plus **Export all data** (listings, leads, commission log as CSV).

**Signing in takes two steps:** a password, then a six-digit code emailed to the user. That's the contract's "multifactor sign-in" (section 11.3.3). The database lets a session see nothing until it has passed both (`is_admin()` in `supabase/migrations/`). A new user gets an invitation email to set their password. "Forgot your password" sends a reset link.

**Rules the database keeps**, whatever sends the change:

- Row-level security: only signed-in admins who have passed both steps can read or change anything. The public key can read no table.
- The public sites read published listings only, through `public_listings()` and `public_listing()`. Photos sit in a private bucket that lets the public read a photo only while its listing is public.
- A listing can't be published without its License to Sell (project and RFO units), the owner's authority on file (resale, rental, lot), and the broker's details. Its address is fixed once published.
- A new lead goes to its listing's agent, otherwise to the default agent. "Lost" needs a reason.
- The activity log records every insert, change and delete, and nobody can edit it.

**Inquiries.** The enquiry form on every site posts to `/api/inquiries` on the public Worker (`src/listings/inquiry.js`). It checks the request comes from the site itself, allows five a minute per address, checks Cloudflare Turnstile and every field, then hands the lead to the admin Worker through a service binding. The admin Worker saves it and emails the agent through Resend. The public Worker holds no database key. Until `VITE_TURNSTILE_SITE_KEY` is set, the form opens the visitor's mail app instead, as before. A link from a listing page (`?listing=<slug>`) ties the inquiry to that listing.

```
npm run dev:admin            # the admin on http://localhost:5190, its Worker on 8787 (.env and .dev.vars)
npm test                     # listing rules, inquiry checks, the sign-in code, CSV, Annex B, and every migration in PGlite
npm run build:admin          # dist/admin, with its service worker
npm run deploy:admin         # build and deploy to admin.heirestates.com (deploy this before the public sites)
```

**Setup, once:**

1. **Supabase.** Create the project in the client's organization (region: Singapore). Run the files in `supabase/migrations/` in order: in the SQL editor, or with `npx supabase link` then `npx supabase db push`.
2. **Supabase Auth.**
   - Providers > Email: turn email confirmation on, and set the minimum password length to 10.
   - Turn off "Allow new users to sign up". Invitations still work.
   - Hooks: add **Before User Created**, type Postgres, function `public.before_user_created`.
   - URL Configuration: Site URL `https://admin.heirestates.com`.
   - Emails: custom SMTP through Resend.
   - Users > **Invite user** for the first admin, heirestates.fh@gmail.com. After that, add people from the admin's Users page.
3. **Resend.** Verify heirestates.com (DNS records in Cloudflare). The sender is `MAIL_FROM` in `wrangler.admin.jsonc`.
4. **The admin's settings.**
   - In `wrangler.admin.jsonc`'s vars: `SUPABASE_URL` and `CF_ACCOUNT_ID`.
   - Secrets: `npx wrangler secret put SUPABASE_SECRET_KEY -c wrangler.admin.jsonc`, then the same for `RESEND_API_KEY`, and `CF_API_TOKEN` (an API token with Account Analytics: Read only).
   - In `.env` (from `.env.example`): `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
5. **The public sites.**
   - In `wrangler.jsonc`'s vars: `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`.
   - Create a Turnstile widget for heirestates.com and its subdomains. Set `VITE_TURNSTILE_SITE_KEY` in `.env`, then `npx wrangler secret put TURNSTILE_SECRET`.
   - Turn on Cloudflare Web Analytics for heirestates.com, and set its token as `CF_BEACON_TOKEN` when building.
6. **Deploy.** Run `npm run deploy:admin` first: the public sites bind to its Worker, so their deploy fails until it exists. Then deploy the sites as usual. To deploy the admin on every push, connect the repo a second time in Workers & Pages, with the build command `npm run build:admin` and the deploy command `npx wrangler deploy -c wrangler.admin.jsonc`. Set the `VITE_` variables in that build's settings.

**Adding an admin user:** add them on the Users page, and an invitation goes to their email. **Switching someone off** locks them out at once.

**Schema changes:** a new timestamped file in `supabase/migrations/`. `npm test` runs it in PGlite with the others; then apply it to the project.
