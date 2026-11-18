// Push notifications to the admin app on phones and computers: Web Push, sent straight to each
// browser's push service (Google, Apple, Mozilla), free and with no account. Each message is
// encrypted for that one device (RFC 8291) and signed with this server's VAPID key (RFC 8292), both
// with WebCrypto. Devices sign up from Settings (push_subscriptions); a device that's gone is dropped.
// Secrets: VAPID_PRIVATE_KEY (wrangler secret put); VAPID_PUBLIC_KEY is in wrangler.admin.jsonc's vars.
import { db } from "./supabase.js";

const enc = new TextEncoder();
export const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const cat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) out.set(p, (at += p.length) - p.length);
  return out;
};
const hkdf = async (salt, ikm, info, length) =>
  new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), length * 8));
// a P-256 key from its raw public point (65 bytes) and, for a private key, its d
const p256 = (pub, d, use) =>
  crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ...(d && { d }), ext: true }, use === "sign" ? { name: "ECDSA", namedCurve: "P-256" } : { name: "ECDH", namedCurve: "P-256" }, false, d ? [use === "sign" ? "sign" : "deriveBits"] : []);

// RFC 8291: the message encrypted for one subscription (aes128gcm, one record). `local` and `salt`
// are fresh for every message; they're parameters only so the RFC's worked example can test this.
export async function encrypt({ p256dh, auth }, text, local, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const uaPub = unb64u(p256dh);
  local ??= await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: await p256(uaPub) }, local.privateKey, 256));
  const ikm = await hkdf(unb64u(auth), shared, cat(enc.encode("WebPush: info\0"), uaPub, asPub), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, cat(enc.encode(text), new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = 65;
  return cat(header, asPub, sealed);
}

// RFC 8292: "this is Heir Estates" for the push service, good for 12 hours
async function vapid(env, endpoint) {
  const pub = unb64u(env.VAPID_PUBLIC_KEY);
  const key = await p256(pub, env.VAPID_PRIVATE_KEY, "sign");
  const part = (o) => b64u(enc.encode(JSON.stringify(o)));
  const body = `${part({ typ: "JWT", alg: "ES256" })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.ADMIN_URL })}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(body));
  return `vapid t=${body}.${b64u(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

// Sends { title, body, url } to every device of these people (an email or a list; none: everyone),
// leaving out `except` (whoever caused it). Never throws: a failed alert must not fail the work.
export async function notify(env, to, message, except) {
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) return;
  try {
    const who = to == null ? "" : `&email=in.(${[to].flat().map((e) => `"${e}"`).join(",")})`;
    const subs = (await db(env).get(`push_subscriptions?select=endpoint,p256dh,auth,email${who}`)).filter((s) => s.email !== except);
    await Promise.all(
      subs.map(async (s) => {
        const r = await fetch(s.endpoint, {
          method: "POST",
          headers: { Authorization: await vapid(env, s.endpoint), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400", Urgency: "high" },
          body: await encrypt(s, JSON.stringify(message)),
        });
        // unsubscribed, or the app was removed: forget the device
        if (r.status === 404 || r.status === 410) await db(env).remove(`push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`);
        else if (!r.ok) console.error("push", r.status, await r.text());
      })
    );
  } catch (e) {
    console.error("push", e);
  }
}
