import { FormEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Globe } from "lucide-react";
import {
  getDnsRecords,
  getDnsZones,
  addDnsRecord,
  deleteDnsRecord,
  getSecondaryNs,
  setSecondaryNs,
  ApiError,
  DnsRecord,
} from "../lib/api";
import { Button, Card, Input, Select, PageHeader, Spinner, Badge } from "../components/ui";
import { useToast } from "../components/Toast";

const RTYPES = ["A", "AAAA", "CNAME", "TXT", "MX", "SRV", "NS", "CAA"];

export default function DnsPage() {
  const qc = useQueryClient();
  const { show } = useToast();
  const records = useQuery({ queryKey: ["dns"], queryFn: getDnsRecords });
  const zones = useQuery({ queryKey: ["dns-zones"], queryFn: getDnsZones });
  const secondary = useQuery({ queryKey: ["dns-secondary"], queryFn: getSecondaryNs });

  const [qname, setQname] = useState("");
  const [rtype, setRtype] = useState("A");
  const [value, setValue] = useState("");
  const [nsHosts, setNsHosts] = useState("");

  const refresh = () => qc.invalidateQueries({ queryKey: ["dns"] });

  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      await addDnsRecord(qname.trim(), rtype, value.trim());
      show("success", `Added ${rtype} record for ${qname}.`);
      setQname("");
      setValue("");
      refresh();
    } catch (err) {
      show("error", err instanceof ApiError ? err.message : "Could not add record.");
    }
  }

  async function remove(r: DnsRecord) {
    if (!confirm(`Delete ${r.rtype} record for ${r.qname}?`)) return;
    try {
      await deleteDnsRecord(r.qname, r.rtype, r.value);
      show("success", `Deleted ${r.rtype} record for ${r.qname}.`);
      refresh();
    } catch (err) {
      show("error", err instanceof ApiError ? err.message : "Could not delete record.");
    }
  }

  async function saveNs(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await setSecondaryNs(nsHosts);
      show("success", typeof r === "string" && r.trim() ? r : "Secondary nameservers saved.");
      setNsHosts("");
      qc.invalidateQueries({ queryKey: ["dns-secondary"] });
    } catch (err) {
      show("error", err instanceof ApiError ? err.message : "Could not save.");
    }
  }

  // Group records by zone for display.
  const byZone: Record<string, DnsRecord[]> = {};
  for (const r of records.data ?? []) {
    const z = r.zone || "other";
    (byZone[z] ??= []).push(r);
  }

  return (
    <div>
      <PageHeader title="Custom DNS" subtitle="Add your own DNS records on domains hosted by this box. The box manages the essential records automatically." />

      <Card className="mb-6 p-4">
        <h2 className="mb-3 text-sm font-semibold">Add a custom record</h2>
        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <div className="min-w-[14rem] flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-500">Name (qname)</label>
            <Input list="dns-zones" value={qname} onChange={(e) => setQname(e.target.value)} placeholder="sub.example.com" required />
            <datalist id="dns-zones">
              {(zones.data ?? []).map((z) => <option key={z} value={z} />)}
            </datalist>
          </div>
          <div className="w-28">
            <label className="mb-1 block text-xs font-medium text-slate-500">Type</label>
            <Select value={rtype} onChange={(e) => setRtype(e.target.value)}>
              {RTYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </div>
          <div className="min-w-[14rem] flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-500">Value</label>
            <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="record value" required />
          </div>
          <Button type="submit"><Plus className="h-4 w-4" /> Add</Button>
        </form>
      </Card>

      {records.isLoading && <Spinner />}

      {Object.keys(byZone).length === 0 && !records.isLoading && (
        <Card className="p-6 text-center text-sm text-slate-500">No custom DNS records yet.</Card>
      )}

      <div className="space-y-6">
        {Object.entries(byZone).map(([zone, recs]) => (
          <div key={zone}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">{zone}</h2>
            <Card>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-400 dark:border-slate-800">
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium">Type</th>
                    <th className="px-4 py-2 font-medium">Value</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {recs.map((r, i) => (
                    <tr key={`${r.qname}-${r.rtype}-${i}`}>
                      <td className="px-4 py-2 font-medium">{r.qname}</td>
                      <td className="px-4 py-2"><Badge color="brand">{r.rtype}</Badge></td>
                      <td className="px-4 py-2 break-all font-mono text-xs">{r.value}</td>
                      <td className="px-4 py-2 text-right">
                        <button onClick={() => remove(r)} className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        ))}
      </div>

      <h2 className="mb-2 mt-8 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
        <Globe className="h-4 w-4" /> Secondary nameservers
      </h2>
      <Card className="p-4">
        {secondary.data?.hostnames?.length ? (
          <p className="mb-3 text-sm">Current: <span className="font-mono">{secondary.data.hostnames.join(", ")}</span></p>
        ) : (
          <p className="mb-3 text-sm text-slate-500">None configured. The box is the primary (and only) nameserver.</p>
        )}
        <form onSubmit={saveNs} className="flex flex-wrap items-end gap-2">
          <div className="min-w-[18rem] flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-500">Hostnames (comma/space separated)</label>
            <Input value={nsHosts} onChange={(e) => setNsHosts(e.target.value)} placeholder="ns2.provider.com xfr:198.51.100.1" />
          </div>
          <Button type="submit" variant="secondary">Save</Button>
        </form>
        <p className="mt-2 text-xs text-slate-500">Add a backup DNS provider so your domains resolve even if this box is down. Leave blank and save to remove.</p>
      </Card>
    </div>
  );
}
