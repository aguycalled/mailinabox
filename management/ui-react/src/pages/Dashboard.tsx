import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, XCircle, AlertTriangle, RefreshCw } from "lucide-react";
import { getSystemStatus, getVersion, StatusItem } from "../lib/api";
import { Card, PageHeader, Spinner, Button, Badge } from "../components/ui";

function StatusIcon({ type }: { type: StatusItem["type"] }) {
  if (type === "ok") return <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />;
  if (type === "error") return <XCircle className="h-5 w-5 shrink-0 text-red-500" />;
  if (type === "warning") return <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />;
  return null;
}

export default function Dashboard() {
  const version = useQuery({ queryKey: ["version"], queryFn: getVersion });
  const status = useQuery({ queryKey: ["status"], queryFn: getSystemStatus });

  const counts = (status.data ?? []).reduce(
    (acc, i) => {
      if (i.type === "ok") acc.ok++;
      else if (i.type === "error") acc.error++;
      else if (i.type === "warning") acc.warning++;
      return acc;
    },
    { ok: 0, warning: 0, error: 0 }
  );

  return (
    <div>
      <PageHeader
        title="System Status"
        subtitle={version.data ? `Version ${version.data}` : "Checks of your box's configuration and health"}
        action={
          <Button variant="secondary" onClick={() => status.refetch()} disabled={status.isFetching}>
            <RefreshCw className={`h-4 w-4 ${status.isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        }
      />

      {status.data && (
        <div className="mb-6 flex gap-3">
          <Badge color="green">{counts.ok} OK</Badge>
          {counts.warning > 0 && <Badge color="amber">{counts.warning} warnings</Badge>}
          {counts.error > 0 && <Badge color="red">{counts.error} errors</Badge>}
        </div>
      )}

      {status.isLoading && <Spinner />}
      {status.isError && (
        <Card className="p-4 text-sm text-red-600 dark:text-red-400">
          Could not load system status: {(status.error as Error).message}
        </Card>
      )}

      <div className="space-y-2">
        {(status.data ?? []).map((item, i) =>
          item.type === "heading" ? (
            <h2 key={i} className="px-1 pb-1 pt-5 text-sm font-semibold uppercase tracking-wide text-slate-400">
              {item.text}
            </h2>
          ) : (
            <Card key={i} className="p-3">
              <div className="flex items-start gap-3">
                <StatusIcon type={item.type} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm">{item.text}</div>
                  {item.extra.map((x, j) => (
                    <div
                      key={j}
                      className={`mt-1 text-xs text-slate-500 dark:text-slate-400 ${x.monospace ? "whitespace-pre-wrap font-mono" : ""}`}
                    >
                      {x.text}
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          )
        )}
      </div>
    </div>
  );
}
