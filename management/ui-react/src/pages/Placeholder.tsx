import { Construction, ExternalLink } from "lucide-react";
import { Card, PageHeader } from "../components/ui";

export default function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <div>
      <PageHeader title={title} />
      <Card className="flex flex-col items-center gap-3 p-10 text-center">
        <Construction className="h-10 w-10 text-amber-500" />
        <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">{note}</p>
        <a
          href="/admin-old"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
        >
          Open the classic control panel <ExternalLink className="h-4 w-4" />
        </a>
      </Card>
    </div>
  );
}
