import { FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, KeyRound, Lock, Gauge, ShieldCheck, Archive, Lock as LockIcon } from "lucide-react";
import {
  getUsers,
  apiPost,
  ApiError,
  MailUser,
  getPgpKey,
  PgpKeyStatus,
  getMfaStatus,
  MfaStatus,
} from "../lib/api";
import { Button, Card, Input, PageHeader, Spinner, Badge, Modal } from "../components/ui";
import { useToast } from "../components/Toast";

export default function UsersPage() {
  const qc = useQueryClient();
  const { show } = useToast();
  const users = useQuery({ queryKey: ["users"], queryFn: getUsers });
  const [adding, setAdding] = useState(false);
  const [modal, setModal] = useState<{ kind: string; user: MailUser } | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["users"] });

  async function call(path: string, data: Record<string, string>, ok: string) {
    try {
      const r = await apiPost<string>(path, data);
      show("success", typeof r === "string" && r.trim() ? r : ok);
      refresh();
      setModal(null);
      setAdding(false);
    } catch (err) {
      show("error", err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Mail accounts on this box. Each is a login with a mailbox."
        action={<Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add user</Button>}
      />

      {users.isLoading && <Spinner />}

      <div className="space-y-6">
        {(users.data ?? []).map((domain) => (
          <div key={domain.domain}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">{domain.domain}</h2>
            <Card>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {domain.users.map((u) => (
                  <li key={u.email} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-medium">
                        <span className={u.status === "inactive" ? "text-slate-400 line-through" : ""}>{u.email}</span>
                        {u.privileges.includes("admin") && <Badge color="brand">admin</Badge>}
                        {u.status === "inactive" && <Badge color="slate">archived</Badge>}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {u.box_size || "0"} used{u.quota !== "0" ? ` of ${u.quota}` : ""}{u.percent ? ` · ${u.percent}` : ""}
                      </div>
                    </div>
                    {u.status === "active" && (
                      <div className="flex flex-wrap items-center gap-1 text-sm">
                        <RowAction icon={Lock} label="Password" onClick={() => setModal({ kind: "password", user: u })} />
                        <RowAction icon={Gauge} label="Quota" onClick={() => setModal({ kind: "quota", user: u })} />
                        <RowAction icon={KeyRound} label="Encryption" onClick={() => setModal({ kind: "pgp", user: u })} />
                        <RowAction icon={ShieldCheck} label="2FA" onClick={() => setModal({ kind: "mfa", user: u })} />
                        <RowAction
                          icon={u.privileges.includes("admin") ? LockIcon : ShieldCheck}
                          label={u.privileges.includes("admin") ? "Revoke admin" : "Make admin"}
                          onClick={() =>
                            call(
                              "/mail/users/privileges/" + (u.privileges.includes("admin") ? "remove" : "add"),
                              { email: u.email, privilege: "admin" },
                              "Updated privileges."
                            )
                          }
                        />
                        <RowAction icon={Archive} label="Archive" danger onClick={() => {
                          if (confirm(`Archive ${u.email}? The mailbox is kept but the user can no longer log in.`))
                            call("/mail/users/remove", { email: u.email }, "User archived.");
                        }} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        ))}
      </div>

      {adding && <AddUserModal onClose={() => setAdding(false)} onSubmit={call} />}
      {modal?.kind === "password" && <PasswordModal user={modal.user} onClose={() => setModal(null)} onSubmit={call} />}
      {modal?.kind === "quota" && <QuotaModal user={modal.user} onClose={() => setModal(null)} onSubmit={call} />}
      {modal?.kind === "pgp" && <PgpModal user={modal.user} onClose={() => setModal(null)} onDone={() => { setModal(null); }} />}
      {modal?.kind === "mfa" && <MfaModal user={modal.user} onClose={() => setModal(null)} />}
    </div>
  );
}

function RowAction({ icon: Icon, label, onClick, danger }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition ${
        danger ? "text-slate-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
      }`}
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );
}

type SubmitFn = (path: string, data: Record<string, string>, ok: string) => void;

function AddUserModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: SubmitFn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [quota, setQuota] = useState("0");
  const [admin, setAdmin] = useState(false);
  return (
    <Modal title="Add user" onClose={onClose}>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onSubmit("/mail/users/add", { email, password, quota, privileges: admin ? "admin" : "" }, "User added.");
        }}
        className="space-y-4"
      >
        <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Field label="Password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} /></Field>
        <Field label="Quota"><Input value={quota} onChange={(e) => setQuota(e.target.value)} /><p className="mt-1 text-xs text-slate-500">0 for unlimited; suffixes G/M allowed.</p></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} /> Administrator</label>
        <Actions onClose={onClose} submit="Add user" />
      </form>
    </Modal>
  );
}

function PasswordModal({ user, onClose, onSubmit }: { user: MailUser; onClose: () => void; onSubmit: SubmitFn }) {
  const [password, setPassword] = useState("");
  return (
    <Modal title={`Set password — ${user.email}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit("/mail/users/password", { email: user.email, password }, "Password set."); }} className="space-y-4">
        <Field label="New password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} /></Field>
        <p className="text-xs text-slate-500">At least eight characters, letters and numbers, no spaces.</p>
        <Actions onClose={onClose} submit="Set password" />
      </form>
    </Modal>
  );
}

function QuotaModal({ user, onClose, onSubmit }: { user: MailUser; onClose: () => void; onSubmit: SubmitFn }) {
  const [quota, setQuota] = useState(user.quota);
  return (
    <Modal title={`Set quota — ${user.email}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit("/mail/users/quota", { email: user.email, quota }, "Quota set."); }} className="space-y-4">
        <Field label="Quota"><Input value={quota} onChange={(e) => setQuota(e.target.value)} /><p className="mt-1 text-xs text-slate-500">0 for unlimited; suffixes G/M allowed.</p></Field>
        <Actions onClose={onClose} submit="Set quota" />
      </form>
    </Modal>
  );
}

function PgpModal({ user, onClose }: { user: MailUser; onClose: () => void; onDone: () => void }) {
  const { show } = useToast();
  const status = useQuery<PgpKeyStatus>({ queryKey: ["pgp", user.email], queryFn: () => getPgpKey(user.email) });
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const r = await apiPost<string>("/mail/users/pgp", { email: user.email, key });
      show("success", r);
      onClose();
    } catch (err) {
      show("error", err instanceof ApiError ? err.message : "Could not save key.");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    try {
      const r = await apiPost<string>("/mail/users/pgp/remove", { email: user.email });
      show("success", r);
      onClose();
    } catch (err) {
      show("error", err instanceof ApiError ? err.message : "Could not remove key.");
    }
  }

  return (
    <Modal title={`At-rest encryption — ${user.email}`} onClose={onClose}>
      {status.isLoading ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          {status.data?.has_key ? (
            <div className="rounded-lg bg-green-50 p-3 text-sm dark:bg-green-900/20">
              <div className="font-medium text-green-700 dark:text-green-300">Mail is encrypted at rest.</div>
              {status.data.uids?.length ? <div className="mt-1 text-slate-600 dark:text-slate-300">{status.data.uids.join(", ")}</div> : null}
              {status.data.fingerprint && <div className="mt-1 break-all font-mono text-xs text-slate-500">{status.data.fingerprint}</div>}
            </div>
          ) : (
            <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">Mail is currently stored unencrypted.</div>
          )}
          <Field label="Paste an ASCII-armored PGP public key (leave blank to keep current)">
            <textarea
              rows={7}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800"
            />
          </Field>
          <p className="text-xs text-slate-500">Only the body is encrypted; headers stay readable. Webmail shows ciphertext. Existing mail is unchanged.</p>
          <div className="flex justify-between">
            {status.data?.has_key ? <Button variant="danger" onClick={remove}>Remove key</Button> : <span />}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose}>Close</Button>
              <Button onClick={save} disabled={busy || !key.trim()}>{busy ? "Saving…" : "Save key"}</Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function MfaModal({ user, onClose }: { user: MailUser; onClose: () => void }) {
  const { show } = useToast();
  const qc = useQueryClient();
  const status = useQuery<MfaStatus>({ queryKey: ["mfa", user.email], queryFn: () => getMfaStatus(user.email) });

  async function disable(id: number) {
    try {
      await apiPost("/mfa/disable", { user: user.email, "mfa-id": String(id) });
      show("success", "Second factor removed.");
      qc.invalidateQueries({ queryKey: ["mfa", user.email] });
    } catch (err) {
      show("error", err instanceof ApiError ? err.message : "Could not remove.");
    }
  }

  return (
    <Modal title={`Two-factor auth — ${user.email}`} onClose={onClose}>
      {status.isLoading ? (
        <Spinner />
      ) : (
        <div className="space-y-3">
          {(status.data?.enabled_mfa.length ?? 0) === 0 && (
            <p className="text-sm text-slate-500">No second factor is configured for this account.</p>
          )}
          {status.data?.enabled_mfa.map((f) => (
            <div key={f.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
              <div>
                <div className="text-sm font-medium">{f.type === "webauthn" ? "Passkey" : f.type === "totp" ? "Authenticator app" : f.type}</div>
                {f.label && <div className="text-xs text-slate-500">{f.label}</div>}
              </div>
              <Button variant="danger" onClick={() => disable(f.id)}>Remove</Button>
            </div>
          ))}
          <p className="text-xs text-slate-500">Admins can remove a user's second factors here (e.g. a lost device). Users add their own from the Two-Factor Auth page.</p>
          <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Close</Button></div>
        </div>
      )}
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

function Actions({ onClose, submit }: { onClose: () => void; submit: string }) {
  return (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
      <Button type="submit">{submit}</Button>
    </div>
  );
}
