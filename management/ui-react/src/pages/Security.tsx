import { FormEvent, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Fingerprint, Smartphone, Trash2 } from "lucide-react";
import { getMfaStatus, apiPost, ApiError, createPasskey, webauthnSupported, MfaStatus } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button, Card, Input, PageHeader, Spinner, Badge } from "../components/ui";
import { useToast } from "../components/Toast";

export default function SecurityPage() {
  const { show } = useToast();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const status = useQuery<MfaStatus>({ queryKey: ["mfa", "self"], queryFn: () => getMfaStatus() });

  const [passkeyLabel, setPasskeyLabel] = useState("");
  const [totpLabel, setTotpLabel] = useState("");
  const [totpToken, setTotpToken] = useState("");
  const [showTotp, setShowTotp] = useState(false);
  const [busy, setBusy] = useState(false);

  // Adding or removing a factor invalidates the current session server-side, so
  // we sign the user out and send them back to the login screen afterwards.
  async function reauth(message: string) {
    show("success", message + " Please sign in again.");
    await signOut();
    navigate("/login", { replace: true });
  }

  async function addPasskey(e: FormEvent) {
    e.preventDefault();
    if (!webauthnSupported) {
      show("error", "This browser does not support passkeys.");
      return;
    }
    setBusy(true);
    try {
      const options = await apiPost("/mfa/webauthn/register/begin");
      const credential = await createPasskey(options);
      await apiPost("/mfa/webauthn/register/complete", { credential, label: passkeyLabel });
      await reauth("Passkey added.");
    } catch (err) {
      show("error", err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Could not add passkey.");
    } finally {
      setBusy(false);
    }
  }

  async function addTotp(e: FormEvent) {
    e.preventDefault();
    const secret = status.data?.new_mfa?.totp?.secret;
    if (!secret) return;
    try {
      await apiPost("/mfa/totp/enable", { secret, token: totpToken, label: totpLabel });
      await reauth("Authenticator app added.");
    } catch (err) {
      show("error", err instanceof ApiError ? err.message : "Could not enable. Check the code and try again.");
    }
  }

  async function remove(id: number, name: string) {
    if (!confirm(`Remove ${name}? You'll be signed out.`)) return;
    try {
      await apiPost("/mfa/disable", { "mfa-id": String(id) });
      await reauth("Removed.");
    } catch (err) {
      show("error", err instanceof ApiError ? err.message : "Could not remove.");
    }
  }

  const totp = status.data?.new_mfa?.totp;

  return (
    <div>
      <PageHeader title="Two-Factor Authentication" subtitle="Add a second factor for control-panel logins. This protects the control panel only, not email." />

      {status.isLoading && <Spinner />}

      <Card className="mb-6 p-4">
        <h2 className="mb-3 text-sm font-semibold">Your second factors</h2>
        {(status.data?.enabled_mfa.length ?? 0) === 0 ? (
          <p className="text-sm text-slate-500">None yet — your account is protected by your password only.</p>
        ) : (
          <ul className="space-y-2">
            {status.data?.enabled_mfa.map((f) => (
              <li key={f.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
                <div className="flex items-center gap-2">
                  {f.type === "webauthn" ? <Fingerprint className="h-4 w-4 text-brand-500" /> : <Smartphone className="h-4 w-4 text-brand-500" />}
                  <span className="text-sm font-medium">{f.type === "webauthn" ? "Passkey" : "Authenticator app"}</span>
                  {f.label && <Badge color="slate">{f.label}</Badge>}
                </div>
                <button onClick={() => remove(f.id, f.label || f.type)} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30">
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mb-6 p-4">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold"><Fingerprint className="h-4 w-4" /> Add a passkey</h2>
        <p className="mb-3 text-sm text-slate-500">A security key, phone, or your computer's biometrics. Phishing-resistant and bound to this box's hostname.</p>
        {!webauthnSupported ? (
          <p className="text-sm text-red-600">This browser does not support passkeys.</p>
        ) : (
          <form onSubmit={addPasskey} className="flex flex-wrap items-end gap-2">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-slate-500">Name (optional)</label>
              <Input value={passkeyLabel} onChange={(e) => setPasskeyLabel(e.target.value)} placeholder="e.g. YubiKey, my phone" />
            </div>
            <Button type="submit" disabled={busy}>{busy ? "Waiting…" : "Add passkey"}</Button>
          </form>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold"><Smartphone className="h-4 w-4" /> Add an authenticator app</h2>
        {!showTotp ? (
          <button className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400" onClick={() => setShowTotp(true)}>
            Set up an app that generates six-digit codes (TOTP)
          </button>
        ) : totp ? (
          <form onSubmit={addTotp} className="space-y-3">
            <p className="text-sm text-slate-500">Scan this in FreeOTP, Aegis, or another TOTP app, then enter a code.</p>
            <img src={`data:image/png;base64,${totp.qr_code_base64}`} alt="TOTP QR code" className="h-44 w-44 rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700" />
            <div className="break-all font-mono text-xs text-slate-500">Secret: {totp.secret}</div>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Label (optional)</label>
                <Input value={totpLabel} onChange={(e) => setTotpLabel(e.target.value)} placeholder="my phone" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Code</label>
                <Input inputMode="numeric" value={totpToken} onChange={(e) => setTotpToken(e.target.value)} placeholder="6-digit code" />
              </div>
              <Button type="submit" disabled={totpToken.length !== 6}>Enable</Button>
            </div>
          </form>
        ) : (
          <Spinner />
        )}
      </Card>
    </div>
  );
}
