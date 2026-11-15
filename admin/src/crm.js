// The CRM's words: a lead's stages in order, and the sites inquiries come from.
import { order, projects } from "../../src/projects.js";

export const STAGES = { new: "New", contacted: "Contacted", viewing: "Viewing", reserved: "Reserved", closed: "Closed", lost: "Lost" };
export const OPEN = ["new", "contacted", "viewing", "reserved"];
export const SITES = { main: "heirestates.com", ...Object.fromEntries(order.map((id) => [id, projects[id].name])) };

const day = new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric" });
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
