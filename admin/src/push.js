// Push notifications on this device (admin/worker/push.js sends them, admin/sw.js shows them): a
// task given to you, a new inquiry, a WhatsApp message, a reminder come due. Per device, per person.
// Used by Settings and by the Dashboard's prompt.
import { useEffect, useState } from "react";
import { supabase, run } from "./supabase";
import { api } from "./api";
import { toast } from "./motion";

export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export function usePush() {
  const supported = pushSupported();
  const [on, setOn] = useState(null); // null while checking
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supported) return setOn(false);
    navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).then((s) => setOn(!!s), () => setOn(false));
  }, [supported]);

  async function turnOn() {
    setBusy(true);
    setError("");
    try {
      if ((await Notification.requestPermission()) !== "granted") throw new Error("Notifications are blocked for this site. Allow them in the browser's site settings, then try again.");
      const { key } = await api("push/key");
      if (!key) throw new Error("Notifications aren't set up on the server yet (VAPID keys).");
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
      const { endpoint, keys } = sub.toJSON();
      await run(supabase.from("push_subscriptions").upsert({ endpoint, p256dh: keys.p256dh, auth: keys.auth }));
      setOn(true);
      toast("Notifications on for this device");
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  async function turnOff() {
    setBusy(true);
    setError("");
    try {
      const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (sub) {
        await run(supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint));
        await sub.unsubscribe();
      }
      setOn(false);
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  return { supported, on, busy, error, turnOn, turnOff };
}
