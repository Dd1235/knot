"use client";

import { useEffect, useState } from "react";
import {
  AgentAction,
  EpisodicEvent,
  ProceduralRule,
  SemanticFact,
  getActions,
  getEpisodic,
  getMemoryOverview,
  getProcedural,
  getSemantic,
} from "@/lib/api";
import AppShell, { PageTitle } from "@/components/ui/AppShell";
import Card from "@/components/ui/Card";
import Pill from "@/components/ui/Pill";
import SegmentedNav from "@/components/ui/SegmentedNav";
import Stat from "@/components/ui/Stat";

type Tab = "semantic" | "episodic" | "procedural" | "actions";

const TABS = [
  { id: "semantic" as const, label: "Facts" },
  { id: "episodic" as const, label: "Events" },
  { id: "procedural" as const, label: "Rules" },
  { id: "actions" as const, label: "Actions" },
];

const dt = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="mt-8 text-center text-sm text-ink-secondary">{children}</p>;
}

export default function MemoryPage() {
  const [tab, setTab] = useState<Tab>("semantic");
  const [overview, setOverview] = useState<Record<string, number>>({});
  const [facts, setFacts] = useState<SemanticFact[]>([]);
  const [events, setEvents] = useState<EpisodicEvent[]>([]);
  const [rules, setRules] = useState<ProceduralRule[]>([]);
  const [actions, setActions] = useState<AgentAction[]>([]);

  useEffect(() => {
    getMemoryOverview().then(setOverview).catch(() => {});
    getSemantic().then((r) => setFacts(r.facts)).catch(() => {});
    getEpisodic().then((r) => setEvents(r.events)).catch(() => {});
    getProcedural().then((r) => setRules(r.rules)).catch(() => {});
    getActions().then((r) => setActions(r.actions)).catch(() => {});
  }, []);

  const stats = [
    { label: "facts", value: overview.semantic_facts },
    { label: "events", value: overview.episodic_events },
    { label: "rules", value: overview.procedural_rules },
    { label: "sessions", value: overview.sessions },
  ];

  return (
    <AppShell>
      <div className="text-left">
        <PageTitle>Memory</PageTitle>
      </div>

      <div className="mt-5 grid max-w-2xl grid-cols-4 gap-2">
        {stats.map((s) => (
          <Stat key={s.label} label={s.label} value={s.value ?? "–"} tone="brand" size="sm" />
        ))}
      </div>
      <SegmentedNav
        items={TABS}
        value={tab}
        onChange={setTab}
        label="Memory store"
        className="mt-3"
      />

      <div className="mt-4 max-w-2xl space-y-2.5">
        {tab === "semantic" &&
          (facts.length === 0 ? (
            <Empty>No facts yet — chat and I&apos;ll start remembering.</Empty>
          ) : (
            facts.map((f) => (
              <Card key={f.id}>
                <div className="flex items-center justify-between gap-2">
                  <Pill>{f.kind}</Pill>
                  <span className="text-[11px] text-ink-secondary">
                    seen ×{f.evidence_count} · {dt(f.last_reinforced_at)}
                  </span>
                </div>
                <p
                  className={`mt-1.5 text-sm ${
                    f.superseded_by ? "text-ink-muted line-through" : ""
                  }`}
                >
                  {f.fact}
                </p>
                <div className="mt-2 h-1 rounded bg-surface-raised">
                  <div
                    className="h-1 rounded bg-brand"
                    style={{ width: `${Math.round(f.confidence * 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-[10px] text-ink-secondary">
                  confidence {(f.confidence * 100).toFixed(0)}%
                </p>
              </Card>
            ))
          ))}

        {tab === "episodic" &&
          (events.length === 0 ? (
            <Empty>No events yet.</Empty>
          ) : (
            events.map((e) => (
              <Card key={e.id}>
                <div className="flex items-center justify-between gap-2">
                  <Pill>{e.kind}</Pill>
                  <span className="text-[11px] text-ink-secondary">
                    {dt(e.occurred_at)}
                  </span>
                </div>
                <p className="mt-1.5 text-sm">{e.summary}</p>
              </Card>
            ))
          ))}

        {tab === "procedural" &&
          (rules.length === 0 ? (
            <Empty>
              No rules yet — try &quot;remember: rent is always split with…&quot;
            </Empty>
          ) : (
            rules.map((r) => (
              <Card key={r.id}>
                <div className="flex items-center justify-between gap-2">
                  <Pill>{r.kind}</Pill>
                  <span className="text-[11px] text-brand-ink">
                    applied {r.usage_count}×
                  </span>
                </div>
                <p className="mt-1.5 text-sm">{r.rule.instruction}</p>
                <p className="mt-1 text-[11px] text-ink-secondary">
                  triggers on: &quot;{r.trigger_text}&quot;
                </p>
              </Card>
            ))
          ))}

        {tab === "actions" &&
          (actions.length === 0 ? (
            <Empty>No tool calls yet.</Empty>
          ) : (
            actions.map((a) => (
              <Card key={a.id}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-brand-ink">{a.tool}</span>
                  <span className="tabular-nums text-[11px] text-ink-secondary">
                    {a.latency_ms}ms · {dt(a.created_at)}
                  </span>
                </div>
                {a.error && <p className="mt-1 text-xs text-negative">{a.error}</p>}
              </Card>
            ))
          ))}
      </div>
    </AppShell>
  );
}
