"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AppShell, { PageTitle } from "@/components/ui/AppShell";
import Card, { CardTitle } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import Logo from "@/components/ui/Logo";
import { buttonClass } from "@/components/ui/Button";
import { StackFacts, getStack } from "@/lib/api";
import {
  Boxes,
  BrainCircuit,
  Cloud,
  Clock,
  Database,
  Layers,
  Radar,
  Scale,
  Timer,
} from "lucide-react";

/** The four stores of the CoALA taxonomy.
 *
 * The /memory page shows what is in them. This page says what they are, why
 * there are four rather than one, and — the part that is easy to claim and
 * hard to prove — that they live in the same database as the money, so a
 * memory write and a ledger write can share one transaction. */
const STORES = [
  {
    key: "working",
    name: "Working",
    holds: "The current conversation, turn by turn.",
    written: "Every message, with the memories that were injected into it.",
    read: "Replayed as context on the next turn.",
    note: "Deliberately disposable — it expires on its own.",
  },
  {
    key: "episodic",
    name: "Episodic",
    holds: "Things that happened, as events.",
    written: "After a transaction, and whenever the agent observes something.",
    read: "By vector similarity to what you just said.",
    note: "Insights the agent generated are stored here too, so it can recall its own past observations.",
  },
  {
    key: "semantic",
    name: "Semantic",
    holds: "Durable facts about people, merchants, habits and commitments.",
    written: "Distilled from conversation by a background pass.",
    read: "By vector similarity, filtered by confidence.",
    note: "Near-duplicates reinforce an existing fact rather than piling up copies; contradictions supersede rather than delete.",
  },
  {
    key: "procedural",
    name: "Procedural",
    holds: "Rules you taught it — how you want things done.",
    written: 'When you say something like "always split rent three ways".',
    read: "By similarity between the rule's trigger and your message.",
    note: "The instruction is embedded alongside the trigger, because trigger phrases alone match too little.",
  },
] as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-line py-2 sm:flex-row sm:gap-4">
      <dt className="shrink-0 text-[11px] uppercase tracking-wide text-ink-muted sm:w-32">
        {label}
      </dt>
      <dd className="min-w-0 text-sm text-ink-secondary">{children}</dd>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[12px] text-ink-primary">
      {children}
    </code>
  );
}

export default function ArchitecturePage() {
  const [stack, setStack] = useState<StackFacts | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getStack()
      .then(setStack)
      .catch(() => setFailed(true));
  }, []);

  const balanced = stack ? Number(stack.ledger_sum) === 0 : false;

  return (
    <AppShell>
      <PageTitle>How it works</PageTitle>

      <div className="mt-5 max-w-3xl space-y-4">
        <section>
          <h2 className="text-xl font-semibold tracking-tight">
            One database holds the money and the memory.
          </h2>
          <p className="mt-2 text-sm text-ink-secondary">
            Most agents bolt a vector store onto a transactional database and hope the two
            agree. Knot keeps a serializable double-entry ledger and four memory stores in a
            single CockroachDB cluster, so a fact can be recalled and money can be moved
            inside the same transaction. Everything below is read from the running cluster
            when this page loads — it cannot drift from what is actually deployed.
          </p>
        </section>

        {/* The invariant, checked at request time rather than asserted. */}
        <Card pad="hero">
          <CardTitle icon={Scale}>The invariant</CardTitle>
          {failed ? (
            <p className="text-sm text-ink-secondary">Couldn&apos;t reach the cluster.</p>
          ) : !stack ? (
            <div className="h-10 animate-pulse rounded bg-surface-raised" />
          ) : (
            <>
              <p className="text-sm">
                <span className="text-2xl font-semibold tabular-nums">
                  {stack.legs.toLocaleString("en-IN")}
                </span>{" "}
                <span className="text-ink-secondary">legs on your books sum to</span>{" "}
                <span
                  className={`text-2xl font-semibold tabular-nums ${
                    balanced ? "text-positive" : "text-negative"
                  }`}
                >
                  {stack.ledger_sum}
                </span>
              </p>
              <p className="mt-2 text-xs text-ink-secondary">
                Debits positive, credits negative, every transaction summing to zero — checked
                just now, not at build time. Balances are never stored, only derived, and a
                mistake is corrected by an equal and opposite entry rather than a delete.
                Nothing here can be edited into agreement.
              </p>
            </>
          )}
        </Card>

        <section>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Icon as={BrainCircuit} size={15} className="text-brand-ink" />
            Four kinds of memory, not one
          </h2>
          <p className="mb-3 text-sm text-ink-secondary">
            A single embedding table would answer &ldquo;what did we talk about&rdquo; and
            nothing else. These four are separated because they are written at different
            times, read by different queries, and forgotten on different schedules.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {STORES.map((store) => (
              <Card key={store.key}>
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-medium">{store.name}</h3>
                  <span className="text-xs tabular-nums text-ink-muted">
                    {stack ? stack.memory_counts[store.key] ?? 0 : "…"} rows
                  </span>
                </div>
                <p className="text-sm text-ink-secondary">{store.holds}</p>
                <dl className="mt-1.5">
                  <Row label="written">{store.written}</Row>
                  <Row label="read">{store.read}</Row>
                </dl>
                <p className="mt-2 text-xs text-ink-muted">{store.note}</p>
              </Card>
            ))}
          </div>
        </section>

        <Card>
          <CardTitle icon={Radar}>Vector search is a SQL operation here</CardTitle>
          <p className="mb-3 text-sm text-ink-secondary">
            Embeddings are a <Code>VECTOR(512)</Code> column with a native index, so
            similarity search participates in transactions like any other query. That is what
            lets a new fact be compared against existing ones and merged{" "}
            <em>inside the write</em> — a bolt-on vector database cannot offer that, because
            the comparison and the write would be in different systems.
          </p>
          {stack?.vector_indexes.map((v) => (
            <div key={v.index} className="border-t border-line py-2 text-sm">
              <p className="font-mono text-[12px] text-ink-primary">{v.index}</p>
              <p className="mt-0.5 text-xs text-ink-secondary">
                on <Code>{v.table}</Code> ({v.columns.map((c) => c).join(", ")})
              </p>
            </div>
          ))}
          <p className="mt-2 text-xs text-ink-muted">
            Every index is prefixed by <Code>user_id</Code>. One person&apos;s vectors are
            their own partition, so a similarity search never scans another
            account&apos;s memories — the multi-tenant version of the problem, solved by the
            index rather than by a filter applied afterwards.
          </p>
        </Card>

        <Card>
          <CardTitle icon={Timer}>Forgetting is a feature, and the database does it</CardTitle>
          <p className="mb-2 text-sm text-ink-secondary">
            Raw conversation is disposable; what survives is what was distilled from it. Row-Level
            TTL expires it without a cron job, a worker, or a cleanup script anyone has to
            remember to run.
          </p>
          {stack?.ttl.map((t) => (
            <div
              key={t.table}
              className="flex items-baseline justify-between gap-3 border-t border-line py-1.5 text-sm"
            >
              <Code>{t.table}</Code>
              <span className="flex items-center gap-1.5 text-xs text-ink-secondary">
                <Icon as={Clock} size={11} />
                {t.expire_after}
              </span>
            </div>
          ))}
        </Card>

        <Card>
          <CardTitle icon={Database}>Serializable, and it matters</CardTitle>
          <p className="text-sm text-ink-secondary">
            Settling a debt reads the outstanding balance and writes the settling entry in{" "}
            <em>one</em> transaction. Under a weaker isolation level two concurrent
            settlements would both read the same balance and both commit — the classic write
            skew, and it would silently pay someone twice. CockroachDB&apos;s SERIALIZABLE
            default makes one of them fail with a retry error instead.
          </p>
          <Link href="/demo" className={`${buttonClass("tonal", "sm", "brand")} mt-3 inline-flex`}>
            Watch ten concurrent settlements fight it out
          </Link>
        </Card>

        <Card>
          <CardTitle icon={Cloud}>What runs where</CardTitle>
          <dl>
            <Row label="database">
              CockroachDB Cloud, <Code>aws-ap-south-1</Code>
              {stack ? ` · ${stack.version.split("(")[0].trim()}` : ""}
            </Row>
            <Row label="aws">
              Containerised on App Runner from ECR, CSV exports to S3, structured JSON logs
              to CloudWatch.
            </Row>
            <Row label="models">
              Provider is swappable: OpenAI or Amazon Bedrock behind one protocol, both
              emitting 512-dimension embeddings so the vector columns never need migrating.
              Bedrock&apos;s generative models are gated on this account, so inference runs on
              OpenAI today and the Bedrock path stays one environment variable away.
            </Row>
            <Row label="voice">
              Two engines. On-device speech is free and turn-based; OpenAI Realtime over
              WebRTC is sub-second and interruptible, and bills per minute — so it is opt-in
              rather than default.
            </Row>
          </dl>
        </Card>

        <Card>
          <CardTitle icon={Layers}>The rule the whole thing rests on</CardTitle>
          <p className="text-sm text-ink-secondary">
            SQL and Python compute every number. The model only chooses which already-true
            fact to say, and how to phrase it. A model that is never asked to do arithmetic
            cannot get arithmetic wrong — so no figure on any dashboard was generated by a
            language model, including the ones written in sentences.
          </p>
        </Card>

        <section className="flex flex-wrap items-center gap-2 pt-1">
          <Icon as={Boxes} size={14} className="text-ink-muted" />
          <span className="text-xs text-ink-muted">
            Deeper detail lives in ARCHITECTURE.md and learn/design-decisions.md in the repo.
          </span>
        </section>

        <div className="flex justify-center pt-2">
          <Logo size={20} className="text-brand-ink opacity-50" />
        </div>
      </div>
    </AppShell>
  );
}
