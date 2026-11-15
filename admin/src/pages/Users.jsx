import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase, run } from "../supabase";
import { api } from "../api";
import { useMe } from "../me";
import { Live, LiveTr, SkeletonRows, toast } from "../motion";
import { Badge, ErrorNote, Field, Modal, PageHeader, btn, btnGhost, card, input, th } from "../ui";

export default function Users() {
  const me = useMe();
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const load = () =>
    run(supabase.from("admin_users").select("id, email, name, phone, active").order("active", { ascending: false }).order("name")).then(setList, (e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  async function invite(u) {
    try {
      await api("invite", { email: u.email });
      toast(`Invitation sent to ${u.email}`);
    } catch (err) {
      toast(err.message);
    }
  }

  async function toggle(u) {
    setError("");
    try {
      await run(supabase.from("admin_users").update({ active: !u.active }).eq("id", u.id));
      await load();
      toast(u.active ? `${u.name} can no longer sign in` : `${u.name} can sign in again`);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <PageHeader title="Users" sub="Everyone here can use the whole admin. They sign in with their password, then a code sent to their email. Switching someone off locks them out at once.">
        <button className={btn} onClick={() => setAdding(true)}>
          <Plus className="size-4" aria-hidden />
          Add a user
        </button>
      </PageHeader>
      <div className="mt-4">
        <ErrorNote error={error} />
      </div>

      <div className={`${card} mt-4 overflow-x-auto`}>
        {!list ? (
          <SkeletonRows n={2} />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line">
              <tr>
                <th className={th}>Name</th>
                <th className={th}>Email</th>
                <th className={`${th} hidden sm:table-cell`}>Mobile</th>
                <th className={th}><span className="sr-only">Access</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              <Live>
                {list.map((u, i) => (
                  <LiveTr key={u.id} i={i} className={u.active ? "" : "text-muted"}>
                    <td className="px-4 py-3 font-medium">{u.name}</td>
                    <td className="px-4 py-3 break-all">{u.email}</td>
                    <td className="hidden px-4 py-3 tabular-nums sm:table-cell">{u.phone ?? "—"}</td>
                    <td className="px-4 py-3 text-right">
                      {u.id === me.id ? (
                        <Badge value="published">You</Badge>
                      ) : (
                        <span className="inline-flex gap-2">
                          {u.active && (
                            <button className={btnGhost} onClick={() => invite(u)}>
                              Send invite
                            </button>
                          )}
                          <button className={btnGhost} onClick={() => toggle(u)}>
                            {u.active ? "Switch off" : "Switch on"}
                          </button>
                        </span>
                      )}
                    </td>
                  </LiveTr>
                ))}
              </Live>
            </tbody>
          </table>
        )}
      </div>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add a user">
        <AddUser
          onSaved={async (u) => {
            setAdding(false);
            load();
            try {
              await api("invite", { email: u.email });
              toast(`${u.name} is added, and an invitation to set a password is on its way to ${u.email}`);
            } catch (err) {
              toast(`${u.name} is added, but the invitation didn't send: ${err.message}`);
            }
          }}
        />
      </Modal>
    </>
  );
}

function AddUser({ onSaved }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(e) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setError("");
    try {
      onSaved(await run(supabase.from("admin_users").insert({ email: f.email.trim().toLowerCase(), name: f.name.trim(), phone: f.phone.trim() || null }).select().single()));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={add} className="grid gap-4">
      <ErrorNote error={error} />
      <Field label="Name">
        <input name="name" required minLength={2} maxLength={100} autoFocus autoComplete="off" className={input} />
      </Field>
      <Field label="Email" hint="The address they'll sign in with">
        <input name="email" type="email" required autoComplete="off" className={input} />
      </Field>
      <Field label="Mobile">
        <input name="phone" type="tel" maxLength={40} autoComplete="off" className={input} />
      </Field>
      <div className="flex justify-end">
        <button className={btn} disabled={busy}>{busy ? "Adding…" : "Add user"}</button>
      </div>
    </form>
  );
}
