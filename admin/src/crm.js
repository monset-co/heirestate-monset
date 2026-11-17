// The CRM's words: a lead's stages in order, and the sites inquiries come from.
import { order, projects } from "../../src/projects.js";

export const STAGES = { new: "New", contacted: "Contacted", viewing: "Viewing", reserved: "Reserved", closed: "Closed", lost: "Lost" };
export const OPEN = ["new", "contacted", "viewing", "reserved"];
// where a lead came from: a site's form, or (added by hand) one of SOURCES
export const SOURCES = { whatsapp: "WhatsApp", rph: "Rent.ph", fh: "Filipino Homes", facebook: "Facebook", referral: "Referral", "walk-in": "Walk-in", other: "Other" };
export const SITES = { main: "heirestates.com", ...Object.fromEntries(order.map((id) => [id, projects[id].name])), ...SOURCES };
export const CATEGORIES = { "pre-selling": "Pre-selling", rentals: "Rentals", brokerage: "Brokerage" };
export const TEMPS = { hot: "Hot", warm: "Warm", cold: "Cold" };
export const QUIET_DAYS = 7; // an open lead with no contact this long has gone quiet

// A buyer's papers, in the order a pre-selling sale collects them. The first five are the checklist.
export const FOLDERS = {
  ids: "IDs & TIN",
  income: "Proof of income",
  reservation: "Reservation",
  contract: "Contract to Sell",
  payments: "Payments & PDCs",
  presentations: "Presentations",
  whatsapp: "From WhatsApp",
  other: "Other",
};
export const CHECKLIST = ["ids", "income", "reservation", "contract", "payments"];
// After reserving, a buyer has 30 days to hand these in or the reservation can be forfeited. The
// Contract to Sell comes later, from the developer, so it's checked off but not on the clock.
export const PAPERS_DAYS = 30;
export const ON_THE_CLOCK = ["ids", "income", "reservation", "payments"];
export const papersDue = (reservedAt) => reservedAt && Math.ceil((Date.parse(reservedAt) + PAPERS_DAYS * 864e5 - Date.now()) / 864e5);
export const quiet = (lastContact) => !!lastContact && Date.now() - Date.parse(lastContact) > QUIET_DAYS * 864e5;

const day =new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric" });
const full = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });
export const when = (iso) => full.format(new Date(iso));
// "Today, 9:14 AM", "Yesterday", "Nov 12"
export function ago(iso) {
  const d = new Date(iso);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 864e5);
  if (days === 0) return `Today, ${d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}`;
  if (days === 1) return "Yesterday";
  return day.format(d);
}

// WhatsApp templates: what can be sent once 24 hours have passed since their last message.
// ponytail: placeholders until the real ones are approved in Meta; then they come from Meta's API
export const TEMPLATES = [
  { name: "viewing_confirmation", label: "Confirm a viewing", text: "Hi {{1}}, this is {{2}} from Heir Estates. Confirming your viewing on {{3}}. Reply here if the time needs to change." },
  { name: "follow_up", label: "Check in", text: "Hi {{1}}, it's {{2}} from Heir Estates. Just checking in on your interest in {{3}}. Any questions I can answer?" },
  { name: "papers_reminder", label: "Papers reminder", text: "Hi {{1}}, a reminder that your reservation papers are due by {{2}}. Send them here or to your agent." },
];
