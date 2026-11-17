// A map of Metro Cebu (Leaflet, OpenStreetMap tiles: free, credited in the corner). Shows pins
// (coloured dots), an optional ring around a landmark, and optionally one pin you can drag or
// place with a click, which calls onMove([lat, lng]).
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";

const CEBU = [10.3157, 123.8854];
// the status colours the inventory's badges use
export const PIN = { open: "#2f6b4f", pre: "#b08a3e", held: "#c9a24a", gone: "#8a8f98" };

export default function MapView({ pins = [], ring, movable, onMove, onPin, className = "h-80", zoom = 13 }) {
  const box = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const handle = useRef(null);
  const moveRef = useRef(onMove);
  moveRef.current = onMove;

  useEffect(() => {
    map.current = L.map(box.current, { center: movable ?? CEBU, zoom, scrollWheelZoom: false, attributionControl: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    // scroll zooms only once the map has been clicked, so the page still scrolls past it
    map.current.on("focus", () => map.current.scrollWheelZoom.enable());
    map.current.on("blur", () => map.current.scrollWheelZoom.disable());
    map.current.on("click", (e) => moveRef.current?.([e.latlng.lat, e.latlng.lng]));
    return () => map.current.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the pins and the ring, redrawn when they change; the view fits them
  useEffect(() => {
    const g = layer.current;
    g.clearLayers();
    const points = [];
    for (const p of pins) {
      const m = L.circleMarker([p.lat, p.lng], { radius: 7, color: "#fff", weight: 2, fillColor: p.color ?? PIN.open, fillOpacity: 0.95 }).addTo(g);
      if (p.label) m.bindTooltip(p.label, { direction: "top", offset: [0, -6] });
      if (onPin) m.on("click", () => onPin(p));
      points.push([p.lat, p.lng]);
    }
    if (ring) {
      const c = L.circle(ring.at, { radius: ring.km * 1000, color: "#1b2a4a", weight: 1.5, fillOpacity: 0.06, dashArray: "4 4" }).addTo(g);
      L.circleMarker(ring.at, { radius: 5, color: "#1b2a4a", weight: 2, fillColor: "#fff", fillOpacity: 1 }).bindTooltip(ring.name).addTo(g);
      map.current.fitBounds(c.getBounds(), { padding: [16, 16] });
    } else if (points.length > 1) map.current.fitBounds(points, { padding: [24, 24], maxZoom: 16 });
    else if (points.length === 1) map.current.setView(points[0], 16);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(pins.map((p) => [p.id, p.lat, p.lng, p.color])), ring?.name, ring?.km]);

  // the one pin that can be moved: drag it, or click the map to put it there
  useEffect(() => {
    if (!movable) {
      handle.current?.remove();
      handle.current = null;
      return;
    }
    if (!handle.current) {
      handle.current = L.marker(movable, {
        draggable: true,
        icon: L.divIcon({ className: "", html: '<span class="map-pin"></span>', iconSize: [22, 22], iconAnchor: [11, 22] }),
        keyboard: true,
        title: "Drag to move",
      }).addTo(map.current);
      handle.current.on("dragend", () => {
        const { lat, lng } = handle.current.getLatLng();
        moveRef.current?.([lat, lng]);
      });
      map.current.setView(movable, Math.max(map.current.getZoom(), 16));
    } else handle.current.setLatLng(movable);
  }, [movable?.[0], movable?.[1]]);

  return <div ref={box} className={`relative z-0 overflow-hidden rounded-lg border border-line ${className}`} />;
}
