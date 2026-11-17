import { ArrowLeft, ArrowRight, ImagePlus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase, run, PHOTOS } from "../supabase";
import { Live, LiveLi, SkeletonRows, toast } from "../motion";
import { Empty, ErrorNote, btnDanger, btnGhost, card, input, ask } from "../ui";

// A photo, shrunk in the browser to at most 2000px wide and sent as WebP: smaller uploads, the same
// look on the sites, and no image service to pay for.
async function shrink(file) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / img.width);
  const canvas = Object.assign(document.createElement("canvas"), { width: Math.round(img.width * scale), height: Math.round(img.height * scale) });
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
}

// the bucket is private: the admin sees its photos through links signed for an hour
async function signed(photos) {
  if (!photos.length) return photos;
  const urls = await run(supabase.storage.from(PHOTOS).createSignedUrls(photos.map((p) => p.storage_key), 3600));
  return photos.map((p, i) => ({ ...p, url: urls[i]?.signedUrl }));
}

export default function PhotosTab({ listingId }) {
  const [photos, setPhotos] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    run(supabase.from("listing_photos").select("id, storage_key, alt, sort").eq("listing_id", listingId).order("sort").order("id"))
      .then(signed)
      .then(setPhotos, (e) => setError(e.message));
  }, [listingId]);

  async function upload(e) {
    const files = [...e.target.files];
    e.target.value = "";
    setError("");
    let sort = photos.length ? Math.max(...photos.map((p) => p.sort)) + 1 : 0;
    for (const [i, file] of files.entries()) {
      setBusy(`Uploading ${i + 1} of ${files.length}…`);
      const key = `${listingId}/${crypto.randomUUID()}.webp`;
      try {
        await run(supabase.storage.from(PHOTOS).upload(key, await shrink(file), { contentType: "image/webp" }));
        try {
          const p = await run(supabase.from("listing_photos").insert({ listing_id: listingId, storage_key: key, sort: sort++ }).select("id, storage_key, alt, sort").single());
          const [withUrl] = await signed([p]);
          setPhotos((ps) => [...ps, withUrl]);
        } catch (err) {
          await supabase.storage.from(PHOTOS).remove([key]); // no file without its row
          throw err;
        }
      } catch (err) {
        setError(`${file.name}: ${err.message}`);
      }
    }
    setBusy("");
    if (files.length) toast(files.length === 1 ? "Photo added" : `${files.length} photos added`);
  }

  async function move(i, by) {
    const next = [...photos];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    const numbered = next.map((p, n) => ({ ...p, sort: n }));
    setPhotos(numbered);
    try {
      const changed = numbered.filter((p) => p.sort !== photos.find((x) => x.id === p.id).sort);
      await Promise.all(changed.map((p) => run(supabase.from("listing_photos").update({ sort: p.sort }).eq("id", p.id))));
    } catch (err) {
      setError(err.message);
    }
  }

  async function describe(p, alt) {
    if ((p.alt ?? "") === alt) return;
    try {
      await run(supabase.from("listing_photos").update({ alt: alt || null }).eq("id", p.id));
      setPhotos((ps) => ps.map((x) => (x.id === p.id ? { ...x, alt } : x)));
      toast("Description saved");
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(p) {
    if (!(await ask({ title: "Remove this photo?", body: "It's deleted for good.", yes: "Remove", danger: true }))) return;
    try {
      await run(supabase.from("listing_photos").delete().eq("id", p.id));
      await run(supabase.storage.from(PHOTOS).remove([p.storage_key]));
      setPhotos((ps) => ps.filter((x) => x.id !== p.id));
      toast("Photo removed");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">The first photo is the cover. Describe each one for people using screen readers.</p>
        <label className={`${btnGhost} cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-gold ${busy ? "pointer-events-none opacity-60" : ""}`}>
          <ImagePlus className="size-4" aria-hidden />
          {busy || "Add photos"}
          <input type="file" accept="image/*" multiple onChange={upload} disabled={!!busy} className="sr-only" />
        </label>
      </div>
      <ErrorNote error={error} />
      {!photos ? (
        <div className={card}><SkeletonRows n={3} /></div>
      ) : !photos.length ? (
        <div className={card}><Empty>No photos yet. Add the cover first.</Empty></div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Live>
            {photos.map((p, i) => (
              <LiveLi key={p.id} i={i} className={`${card} overflow-hidden`}>
                <div className="relative aspect-[4/3] bg-sunken">
                  <img src={p.url} alt="" className="h-full w-full object-cover" />
                  {i === 0 && <span className="label absolute top-2 left-2 rounded bg-navy px-2 py-1 text-cream">Cover</span>}
                </div>
                <div className="grid gap-3 p-3">
                  <input defaultValue={p.alt ?? ""} onBlur={(e) => describe(p, e.target.value.trim())} placeholder="Describe the photo" aria-label={`Photo ${i + 1} description`} maxLength={200} className={input} />
                  <div className="flex gap-2">
                    <button type="button" className={btnGhost} disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move photo ${i + 1} earlier`}>
                      <ArrowLeft className="size-4" aria-hidden />
                    </button>
                    <button type="button" className={btnGhost} disabled={i === photos.length - 1} onClick={() => move(i, 1)} aria-label={`Move photo ${i + 1} later`}>
                      <ArrowRight className="size-4" aria-hidden />
                    </button>
                    <button type="button" className={`${btnDanger} ml-auto`} onClick={() => remove(p)}>
                      <Trash2 className="size-4" aria-hidden /> Remove
                    </button>
                  </div>
                </div>
              </LiveLi>
            ))}
          </Live>
        </ul>
      )}
    </div>
  );
}
