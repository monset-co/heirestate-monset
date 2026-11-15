// Listing types, statuses and prices, shared by the public pages (render.js), the admin's Worker
// and the admin app. No imports, so the admin app doesn't carry the projects' content.

// the listing types, in the order the listings page shows them; project and RFO units carry a
// License to Sell, the rest need the owner's authority on file
export const TYPES = {
  project_unit: { label: "Project unit", plural: "Pre-selling units", project: true },
  rfo_unit: { label: "RFO unit", plural: "Ready for occupancy", project: true },
  resale: { label: "Resale", plural: "Resale homes", project: false },
  rental: { label: "Rental", plural: "For rent", project: false },
  lot: { label: "Lot", plural: "Lots", project: false },
};
export const STATUSES = { available: "Available", reserved: "Reserved", sold: "Sold", hidden: "Hidden" };
export const NOTICE = "Prices and availability are subject to confirmation by our licensed broker.";

const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });
export function price(l) {
  if (l.price_min == null) return "Price on request";
  const p = l.price_max != null && l.price_max !== l.price_min ? `${peso.format(l.price_min)} to ${peso.format(l.price_max)}` : peso.format(l.price_min);
  return l.type === "rental" ? `${p} a month` : p;
}
