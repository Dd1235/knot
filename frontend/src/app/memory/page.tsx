"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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

type Tab = "semantic" | "episodic" | "procedural" | "actions";

const TABS: { id: Tab; label: string }[] = [
  { id: "semantic", label: "Facts" },
  { id: "episodic", label: "Events" },
  { id: "procedural", label: "Rules" },
  { id: "actions", label: "Actions" },
];

const dt = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Kind({ children }: { children: string }) {
  return (
    <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
      {children}
    </span>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-sm">{children}</div>
  );
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
    <div className="flex h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur px-4 pt-[env(safe-area-inset-top)]">
        <div className="flex h-14 items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight">🧠 Memory</h1>
          <Link
            href="/"
            className="rounded-lg border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-400 active:bg-zinc-900"
          >
            ← chat
          </Link>
        </div>
        <div className="grid grid-cols-4 gap-2 pb-3">
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-lg border border-zinc-800 bg-zinc-900/60 py-1.5 text-center"
            >
              <p className="text-base font-semibold text-emerald-400">{s.value ?? "–"}</p>
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">{s.label}</p>
            </div>
          ))}
        </div>
        <nav className="flex gap-1 pb-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-full px-3 py-1.5 text-xs ${
                tab === t.id
                  ? "bg-emerald-600 text-white"
                  : "border border-zinc-800 text-zinc-400 active:bg-zinc-900"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="flex-1 space-y-2.5 overflow-y-auto px-4 py-4">
        {tab === "semantic" &&
          (facts.length === 0 ? (
            <p className="text-center text-sm text-zinc-500 mt-8">
              No facts yet — chat and I&apos;ll start remembering.
            </p>
          ) : (
            facts.map((f) => (
              <Card key={f.id}>
                <div className="flex items-center justify-between gap-2">
                  <Kind>{f.kind}</Kind>
                  <span className="text-[11px] text-zinc-500">
                    seen ×{f.evidence_count} · {dt(f.last_reinforced_at)}
                  </span>
                </div>
                <p className={`mt-1.5 ${f.superseded_by ? "line-through text-zinc-600" : ""}`}>
                  {f.fact}
                </p>
                <div className="mt-2 h-1 rounded bg-zinc-800">
                  <div
                    className="h-1 rounded bg-emerald-500"
                    style={{ width: `${Math.round(f.confidence * 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-[10px] text-zinc-500">
                  confidence {(f.confidence * 100).toFixed(0)}%
                </p>
              </Card>
            ))
          ))}

        {tab === "episodic" &&
          (events.length === 0 ? (
            <p className="text-center text-sm text-zinc-500 mt-8">No events yet.</p>
          ) : (
            events.map((e) => (
              <Card key={e.id}>
                <div className="flex items-center justify-between gap-2">
                  <Kind>{e.kind}</Kind>
                  <span className="text-[11px] text-zinc-500">{dt(e.occurred_at)}</span>
                </div>
                <p className="mt-1.5">{e.summary}</p>
              </Card>
            ))
          ))}

        {tab === "procedural" &&
          (rules.length === 0 ? (
            <p className="text-center text-sm text-zinc-500 mt-8">
              No rules yet — try &quot;remember: rent is always split with…&quot;
            </p>
          ) : (
            rules.map((r) => (
              <Card key={r.id}>
                <div className="flex items-center justify-between gap-2">
                  <Kind>{r.kind}</Kind>
                  <span className="text-[11px] text-emerald-500">
                    applied {r.usage_count}×
                  </span>
                </div>
                <p className="mt-1.5">{r.rule.instruction}</p>
                <p className="mt-1 text-[11px] text-zinc-500">
                  triggers on: &quot;{r.trigger_text}&quot;
                </p>
              </Card>
            ))
          ))}

        {tab === "actions" &&
          (actions.length === 0 ? (
            <p className="text-center text-sm text-zinc-500 mt-8">No tool calls yet.</p>
          ) : (
            actions.map((a) => (
              <Card key={a.id}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-emerald-400">{a.tool}</span>
                  <span className="text-[11px] text-zinc-500">
                    {a.latency_ms}ms · {dt(a.created_at)}
                  </span>
                </div>
                {a.error && <p className="mt-1 text-xs text-rose-400">{a.error}</p>}
              </Card>
            ))
          ))}
      </main>
    </div>
  );
}
