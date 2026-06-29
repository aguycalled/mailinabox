import { createContext, useContext, useState, ReactNode, useCallback } from "react";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";

type ToastKind = "success" | "error" | "info";
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const ToastContext = createContext<{
  show: (kind: ToastKind, message: string) => void;
} | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const show = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId++;
      setToasts((t) => [...t, { id, kind, message }]);
      setTimeout(() => dismiss(id), 6000);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex w-[22rem] max-w-[90vw] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-800"
            role="status"
          >
            {t.kind === "success" && <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-500" />}
            {t.kind === "error" && <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />}
            {t.kind === "info" && <Info className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" />}
            <div className="flex-1 whitespace-pre-wrap break-words text-sm">{t.message}</div>
            <button onClick={() => dismiss(t.id)} className="text-slate-400 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
