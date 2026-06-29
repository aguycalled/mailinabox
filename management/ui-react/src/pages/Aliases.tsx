import { FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { getAliases, apiPost, ApiError } from "../lib/api";
import { Button, Card, Input, PageHeader, Spinner, Badge, Modal } from "../components/ui";
import { useToast } from "../components/Toast";

export default function AliasesPage() {
  const qc = useQueryClient();
  const { show } = useToast();
  const aliases = useQuery({ queryKey: ["aliases"], queryFn: getAliases });
  const [adding, setAdding] = useState(false);
  const [address, setAddress] = useState("");
  const [forwardsTo, setForwardsTo] = useState("");

  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      await apiPost("/mail/aliases/add", { address, forwards_to: forwardsTo, update_if_exists: "1" });
      show("success", `Alias ${address} saved.`);
      setAdding(false);
      setAddress("");
      setForwardsTo("");
      qc.invalidateQueries({ queryKey: ["aliases"] });
    } catch (err) {
      show("error", err instanceof ApiError ? err.message : "Could not save alias.");
    }
  }

  async function remove(addr: string) {
    if (!confirm(`Remove alias ${addr}?`)) return;
    try {
      await apiPost("/mail/aliases/remove", { address: addr });
      show("success", `Removed ${addr}.`);
      qc.invalidateQueries({ queryKey: ["aliases"] });
    } catch (err) {
      show("error", err instanceof ApiError ? err.message : "Could not remove alias.");
    }
  }

  return (
    <div>
      <PageHeader
        title="Aliases"
        subtitle="Forward mail from an address to one or more recipients."
        action={
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> Add alias
          </Button>
        }
      />

      {aliases.isLoading && <Spinner />}

      <div className="space-y-6">
        {(aliases.data ?? []).map((domain) => (
          <div key={domain.domain}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">{domain.domain}</h2>
            <Card>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {domain.aliases.map((a) => (
                  <li key={a.address} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 truncate font-medium">
                        {a.address_display}
                        {a.auto && <Badge color="slate">auto</Badge>}
                        {a.required && <Badge color="brand">required</Badge>}
                      </div>
                      <div className="truncate text-sm text-slate-500 dark:text-slate-400">
                        → {a.forwards_to.join(", ") || "(none)"}
                      </div>
                    </div>
                    {!a.auto && (
                      <button onClick={() => remove(a.address)} className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                ))}
                {domain.aliases.length === 0 && <li className="px-4 py-3 text-sm text-slate-400">No aliases.</li>}
              </ul>
            </Card>
          </div>
        ))}
      </div>

      {adding && (
        <Modal title="Add alias" onClose={() => setAdding(false)}>
          <form onSubmit={add} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Alias address</label>
              <Input type="email" placeholder="hello@example.com" value={address} onChange={(e) => setAddress(e.target.value)} required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Forwards to</label>
              <Input placeholder="me@example.com, other@example.com" value={forwardsTo} onChange={(e) => setForwardsTo(e.target.value)} required />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Separate multiple recipients with commas.</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setAdding(false)}>Cancel</Button>
              <Button type="submit">Save alias</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
