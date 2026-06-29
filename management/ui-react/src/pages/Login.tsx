import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Server } from "lucide-react";
import { useAuth } from "../lib/auth";
import { webauthnSupported } from "../lib/api";
import { Button, Input, Card } from "../components/ui";

export default function Login() {
  const { user, attemptLogin, completeWithPasskey } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [remember, setRemember] = useState(false);
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) {
    navigate("/", { replace: true });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await attemptLogin(email, password, { totp: totp || undefined, remember });
      if (r.status === "ok") {
        if (!r.api_key) setError("You are not an administrator on this system.");
        else navigate("/", { replace: true });
      } else if (r.status === "missing-totp-token" || r.reason === "invalid-totp-token") {
        setNeedTotp(true);
        if (r.reason === "invalid-totp-token") setError("Incorrect authentication code.");
      } else if (r.status === "missing-webauthn") {
        if (!webauthnSupported) {
          setError("This account requires a passkey, but this browser doesn't support them.");
          return;
        }
        if (r.invalid) setError("That passkey could not be verified. Try again.");
        const done = await completeWithPasskey(email, password, r.webauthn_options, remember);
        if (done.status === "ok" && done.api_key) navigate("/", { replace: true });
        else setError(done.reason || "Passkey sign-in failed.");
      } else {
        setError(r.reason || "Login failed.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <Card className="w-full max-w-sm p-8">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white">
            <Server className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Mail-in-a-Box</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Sign in to the control panel</p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="email">Email</label>
            <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="password">Password</label>
            <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {needTotp && (
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="totp">Authentication code</label>
              <Input id="totp" inputMode="numeric" autoFocus placeholder="6-digit code" value={totp} onChange={(e) => setTotp(e.target.value)} />
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="rounded border-slate-300" />
            Remember me on this device
          </label>
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</div>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
