import { createContext, useContext, useState, ReactNode, useCallback } from "react";
import {
  Credentials,
  getCredentials,
  setCredentials as persist,
  login as apiLogin,
  logout as apiLogout,
  signPasskey,
  LoginResult,
} from "./api";

interface AuthState {
  user: Credentials | null;
  isAdmin: boolean;
  /** Returns a LoginResult; callers handle totp/webauthn follow-ups. */
  attemptLogin: (
    email: string,
    password: string,
    opts?: { totp?: string; webauthnAssertion?: string; remember?: boolean }
  ) => Promise<LoginResult>;
  /** Runs the passkey ceremony then completes login. */
  completeWithPasskey: (
    email: string,
    password: string,
    options: unknown,
    remember: boolean
  ) => Promise<LoginResult>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Credentials | null>(getCredentials());

  const finish = useCallback((r: LoginResult, remember: boolean) => {
    if (r.status === "ok" && r.api_key && r.email) {
      const creds: Credentials = {
        username: r.email,
        session_key: r.api_key,
        privileges: r.privileges ?? [],
      };
      persist(creds, remember);
      setUser(creds);
    }
    return r;
  }, []);

  const attemptLogin: AuthState["attemptLogin"] = useCallback(
    async (email, password, opts = {}) => {
      const r = await apiLogin(email, password, opts);
      return finish(r, opts.remember ?? false);
    },
    [finish]
  );

  const completeWithPasskey: AuthState["completeWithPasskey"] = useCallback(
    async (email, password, options, remember) => {
      const assertion = await signPasskey(options);
      const r = await apiLogin(email, password, { webauthnAssertion: assertion });
      return finish(r, remember);
    },
    [finish]
  );

  const signOut = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  const isAdmin = !!user?.privileges?.includes("admin");

  return (
    <AuthContext.Provider value={{ user, isAdmin, attemptLogin, completeWithPasskey, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
