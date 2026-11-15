// Email through Resend (RESEND_API_KEY, a Worker secret), from MAIL_FROM on heirestates.com.
export async function mail(env, { to, subject, text, replyTo }) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [].concat(to), subject, text, ...(replyTo && { reply_to: replyTo }) }),
  });
  if (!r.ok) throw new Error(`Resend: ${r.status} ${await r.text()}`);
}
