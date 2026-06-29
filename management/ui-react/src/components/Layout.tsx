import { ReactNode, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  AtSign,
  Globe,
  ShieldCheck,
  HardDriveDownload,
  KeyRound,
  Server,
  LogOut,
  Moon,
  Sun,
  Menu,
  X,
} from "lucide-react";
import { useAuth } from "../lib/auth";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/users", label: "Users", icon: Users },
  { to: "/aliases", label: "Aliases", icon: AtSign },
  { to: "/dns", label: "DNS", icon: Globe },
  { to: "/tls", label: "TLS Certificates", icon: ShieldCheck },
  { to: "/web", label: "Web", icon: Server },
  { to: "/backups", label: "Backups", icon: HardDriveDownload },
  { to: "/security", label: "Two-Factor Auth", icon: KeyRound },
];

function ThemeToggle() {
  const [dark, setDark] = useState(document.documentElement.classList.contains("dark"));
  return (
    <button
      onClick={() => {
        const next = !dark;
        setDark(next);
        document.documentElement.classList.toggle("dark", next);
        localStorage.setItem("miab-theme", next ? "dark" : "light");
      }}
      className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
      title="Toggle dark mode"
    >
      {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-3">
      <div className="mb-4 flex items-center gap-2 px-2 py-1">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
          <Server className="h-5 w-5" />
        </div>
        <span className="font-semibold">Mail-in-a-Box</span>
      </div>
      {nav.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
              isActive
                ? "bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            }`
          }
        >
          <item.icon className="h-5 w-5" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex h-full">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white md:block dark:border-slate-800 dark:bg-slate-900">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-30 md:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <aside className="absolute left-0 top-0 h-full w-64 border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
          <button className="rounded-lg p-2 hover:bg-slate-100 md:hidden dark:hover:bg-slate-800" onClick={() => setOpen((o) => !o)}>
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <div className="hidden text-sm text-slate-500 md:block dark:text-slate-400">Control Panel</div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <span className="hidden text-sm text-slate-500 sm:inline dark:text-slate-400">{user?.username}</span>
            <button
              onClick={async () => {
                await signOut();
                navigate("/login");
              }}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="mx-auto max-w-5xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
