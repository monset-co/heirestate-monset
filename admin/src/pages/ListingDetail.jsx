import { ChevronLeft, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { supabase, run } from "../supabase";
import { Skeleton } from "../motion";
import { Badge, ErrorNote, ShareButton, Tabs, btnGhost } from "../ui";
import { TYPES, price } from "../../../src/listings/types.js";
import { projects } from "../../../src/projects.js";
import ListingForm from "./ListingForm";
import PhotosTab from "./PhotosTab";
import Activity from "./Activity";

const DOMAIN = "heirestates.com";
const TABS = ["Details", "Photos", "Activity"];

// One listing, laid out as the dashboard's client pages are: a header, then tabs kept in the
// address (?tab=Photos) so a reload or a shared link opens the same one.
export default function ListingDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const [l, setL] = useState(null);
  const [error, setError] = useState("");
  const tab = TABS.includes(params.get("tab")) ? params.get("tab") : "Details";

  useEffect(() => {
    run(supabase.from("listings").select("*").eq("id", id).maybeSingle()).then((row) => (row ? setL(row) : setError("No such listing.")), (e) => setError(e.message));
  }, [id]);

  if (!l)
    return error ? (
      <>
        <ErrorNote error={error} />
        <Link to="/listings" className="mt-4 inline-block text-sm underline">Back to listings</Link>
      </>
    ) : (
      <div aria-busy="true" aria-label="Loading" className="grid gap-4">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-9 w-72" />
        <Skeleton className="mt-4 h-10 w-full max-w-sm" />
        <Skeleton className="h-64 w-full max-w-3xl" />
      </div>
    );

  const live = l.published && l.status !== "hidden";
  const url = `https://${l.project ? `${l.project}.` : ""}${DOMAIN}/listings/${l.slug}`;
  return (
    <>
      <Link to="/listings" className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ChevronLeft className="size-4" aria-hidden />
        Listings
      </Link>
      <div className="mt-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-[2.1rem] leading-tight tracking-[-0.01em] text-ink">{l.title}</h1>
          <Badge value={l.status} />
          <Badge value={live ? "published" : "draft"}>{live ? "On the sites" : l.published ? "Published, hidden" : "Not published"}</Badge>
          <span className="ml-auto flex flex-wrap gap-2">
            {live && (
              <a href={url} target="_blank" rel="noopener" className={btnGhost}>
                View on the site <ExternalLink className="size-3.5" aria-hidden />
              </a>
            )}
            {/* what a client needs: the unit, where, the price, and its page once it's on the sites */}
            <ShareButton
              get={() => ({
                title: l.title,
                text: [l.title, [TYPES[l.type]?.label, projects[l.project]?.name, l.location].filter(Boolean).join(" · "), price(l), l.unit_type, l.floor_area && `${l.floor_area} sqm`].filter(Boolean).join("\n"),
                url: live ? url : undefined,
              })}
            />
          </span>
        </div>
        <p className="mt-1 text-sm text-muted">{[TYPES[l.type]?.label, projects[l.project]?.name, l.location].filter(Boolean).join(" · ")}</p>
      </div>

      <div className="mt-6">
        <Tabs label="Listing sections" items={TABS.map((t) => ({ id: t, title: t }))} value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })} />
      </div>

      <div className="mt-6">
        {tab === "Details" && <ListingForm listing={l} onSaved={setL} />}
        {tab === "Photos" && <PhotosTab listingId={l.id} />}
        {tab === "Activity" && <Activity entity="listings" id={l.id} also={{ entity: "listing_photos", parent: "listing_id" }} />}
      </div>
    </>
  );
}
