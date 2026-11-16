// How the admin works, in the words an agent would use. Keep it in step with the features.
import { PageHeader, card } from "../ui";
import { ON_THE_CLOCK, PAPERS_DAYS, QUIET_DAYS } from "../crm";

const SECTIONS = [
  {
    id: "day",
    title: "Your day, from the Dashboard",
    body: [
      "The Dashboard opens on what needs you today: follow-ups due, papers due, and leads that have gone quiet.",
      "Follow-ups due are the reminders set on leads for today or earlier. Each one is also emailed to its agent when it comes due.",
      `Papers due lists reserved buyers whose papers aren't all verified, with the days left before the ${PAPERS_DAYS}-day deadline. It turns red in the last week.`,
      `Gone quiet lists open leads nobody has heard from, or written to, in over ${QUIET_DAYS} days.`,
    ],
  },
  {
    id: "leads",
    title: "Leads and quick lists",
    body: [
      "Every inquiry from the six sites lands in Leads and is emailed to its agent the moment it arrives.",
      "The buttons along the top are quick lists: Open deals, Mine, Not yet called, Gone quiet, Papers due, Hot, and Everyone. The number beside each is how many leads are in it. Search and the stage and site filters narrow any list further.",
      `Last contact is the latest note, WhatsApp message (either way) or stage change. It turns red once an open lead has been quiet for over ${QUIET_DAYS} days.`,
      "Next step is the lead's earliest open reminder. \"None set\" means an open lead with nothing planned: set a reminder so it isn't forgotten.",
    ],
  },
  {
    id: "lead",
    title: "A lead's page",
    body: [
      "Under the name: when you last spoke, the next step, and for reserved buyers how many papers are verified and how many days are left. Each one is a link to the tab that changes it.",
      "Hot, Warm and Cold sit beside the stage. Tap one to tag the lead, tap it again to clear it. Hot leads have their own quick list.",
      "Overview holds their details and the deal: the stage, the agent, and why it was lost.",
      "Moving a lead to Reserved starts the papers clock. Moving it back to New, Contacted or Viewing stops it.",
      "\"Delete on request\" is for the Data Privacy Act. It removes the person with their notes, files, reminders, WhatsApp chat and history, and keeps only a line saying who deleted lead #n and when.",
    ],
  },
  {
    id: "notes",
    title: "Sticky notes",
    body: [
      "Notes are sticky notes on a wall. To add one, drag the top note off the pad in the bottom-right corner and drop it on the wall, or just tap the pad. Write it, pick a colour, and press Stick it (or Enter).",
      "Pin the notes the whole team should see first, like \"OFW in Dubai, call after 9pm\" or \"spouse is co-borrower\". Pinned notes wear a strip of tape and show above every tab of the lead.",
      "To throw a note away, drag it into the bin beside the pad. Undo brings it back for a few seconds after. The small bin icon on each note does the same without dragging.",
    ],
  },
  {
    id: "files",
    title: "Files and the papers checklist",
    body: [
      "Drop files anywhere on the Files tab to upload them into the folder you're looking at, or drop them on a folder to upload straight into it. PDF, photos, Word, Excel and PowerPoint, up to 25 MB each.",
      "Drag a file onto another folder to move it, or use the folder menu on its row.",
      "The first five folders are the buyer's checklist: IDs & TIN, Proof of income, Reservation, Contract to Sell, and Payments & PDCs. Each one is Missing, Uploaded (not yet checked), Verified or Rejected. Open a folder and press Verify, or Reject with the reason the buyer needs to fix it (blurry ID, wrong month's payslip). Clear puts it back to unchecked.",
      `The ${PAPERS_DAYS}-day clock counts ${ON_THE_CLOCK.length} of them: IDs, income, reservation and payments. The Contract to Sell comes later from the developer, so it's checked off but not timed.`,
      "PDFs open in the admin's own reader: arrow keys or swipe to turn pages, F for full screen. Present shows a PDF or PowerPoint to a client as slides. Photos open as they are.",
      "Word, Excel and PowerPoint open in Microsoft's Office viewer, which reads the file through a link that lasts 10 minutes. The admin asks first, since a buyer's papers are personal data.",
    ],
  },
  {
    id: "whatsapp",
    title: "WhatsApp",
    body: [
      "Every chat on the business number is in WhatsApp, live. A chat finds its lead by mobile number. You can also link it to a lead from the menu in the chat, or press Make a lead to create one from it, assigned like a website inquiry, with a reminder to call them back within the hour.",
      "A lead's own WhatsApp tab shows the same chat, so you can reply without leaving the lead. With no chat yet, Open in WhatsApp starts one from your phone.",
      "WhatsApp allows free replies for 24 hours after the client's last message. The chat shows how long is left. After that, only an approved template can be sent, picked from the list under the chat.",
      "Photos and documents they send can be saved to their files with Save to their files. They land in the From WhatsApp folder, ready to sort into the checklist.",
    ],
    soon: "Waiting on WhatsApp being connected: sending templates, the Copilot (Claude drafts a reply or sums a chat up as a sticky note, and an agent always presses Send), and leads made automatically from new chats.",
  },
  {
    id: "reminders",
    title: "Reminders",
    body: [
      "Set a reminder on a lead with a date, a time and what to do. It's emailed to the lead's agent when it comes due, shows on the Dashboard, and becomes the lead's next step.",
      "Tick it off when it's done. An overdue one shows in red.",
    ],
  },
  {
    id: "more",
    title: "Listings, commissions and the rest",
    body: [
      "Listings are what the sites show. A listing needs its DHSUD License to Sell number, and the owner's authority on file, before it can be published.",
      "Commissions keep the sales log and each commission release. The Annex B report is built from it.",
      "Activity is the history of every change: who did what, and when.",
      "Install the admin as an app from Settings. It then opens like any app on your phone or computer.",
    ],
  },
];

export default function Guide() {
  return (
    <>
      <PageHeader title="Guide" sub="What each part of the admin does, and how the team uses it day to day." />
      <nav aria-label="On this page" className="mt-6 flex flex-wrap gap-2">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm hover:border-muted/50">
            {s.title}
          </a>
        ))}
      </nav>
      <div className="mt-8 grid max-w-3xl gap-6">
        {SECTIONS.map((s) => (
          <section key={s.id} id={s.id} className={`${card} scroll-mt-6 p-6`}>
            <h2 className="font-display text-2xl text-ink">{s.title}</h2>
            <ul className="mt-3 grid list-disc gap-2 pl-5 text-[0.95rem] leading-relaxed text-fg marker:text-gold">
              {s.body.map((b) => <li key={b}>{b}</li>)}
            </ul>
            {s.soon && <p className="mt-4 rounded-md bg-sunken px-3 py-2.5 text-sm text-muted">{s.soon}</p>}
          </section>
        ))}
      </div>
    </>
  );
}
