"use client";

import { useEffect, useState } from "react";
import AppHeader from "@/components/ui/AppHeader";
import Card, { CardTitle } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import Pill from "@/components/ui/Pill";
import {
  SessionSummary,
  TraceTurn,
  getSessionTrace,
  getSessions,
} from "@/lib/api";
import { Keyboard, MessagesSquare, Mic, Radio, Timer, Wrench } from "lucide-react";

const CHANNEL = {
  voice: { label: "voice", icon: Mic },
  text: { label: "typed", icon: Keyboard },
  mixed: { label: "voice + typed", icon: Radio },
} as const;

function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const same = d.toDateString() === today.toDateString();
  return same
    ? d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function Transcript({ id }: { id: string }) {
  const [turns, setTurns] = useState<TraceTurn[] | null>(null);

  useEffect(() => {
    getSessionTrace(id)
      .then((r) => setTurns(r.turns))
      .catch(() => setTurns([]));
  }, [id]);

  if (turns === null) {
    return <div className="mt-2 h-12 animate-pulse rounded bg-surface-raised" />;
  }
  if (turns.length === 0) {
    return (
      <p className="mt-2 text-xs text-ink-muted">
        Nothing left to show — raw turns are kept for 30 days and then expire on their own.
        What the agent learned from this conversation survives in memory.
      </p>
    );
  }

  return (
    <div className="mt-2 space-y-2 border-t border-line pt-2">
      {turns.map((turn) => {
        const memories =
          (turn.context_trace?.rules?.length ?? 0) +
          (turn.context_trace?.facts?.length ?? 0) +
          (turn.context_trace?.episodes?.length ?? 0);
        return (
          <div key={turn.seq} className="text-sm">
            <p className={turn.role === "user" ? "text-ink-primary" : "text-ink-secondary"}>
              <span className="mr-1.5 text-[11px] uppercase tracking-wide text-ink-muted">
                {turn.role === "user" ? "you" : "knot"}
              </span>
              {turn.content}
            </p>
            {(turn.tool_calls?.length || memories > 0) && (
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {turn.tool_calls?.map((t, i) => (
                  <Pill key={i}>
                    <span className="inline-flex items-center gap-1">
                      <Icon as={Wrench} size={10} />
                      {t.tool}
                    </span>
                  </Pill>
                ))}
                {memories > 0 && (
                  <Pill tone="brand">
                    {memories} {memories === 1 ? "memory" : "memories"} used
                  </Pill>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    getSessions()
      .then((r) => setSessions(r.sessions))
      .catch(() => setSessions([]));
  }, []);

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader title="Conversations" back="/app" />

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-3 overflow-y-auto px-4 py-4 pb-[max(env(safe-area-inset-bottom),2rem)]">
        <p className="text-sm text-ink-secondary">
          Every conversation, spoken or typed, with the tools it ran and the memories it
          drew on. Voice and text share one session — continuing out loud picks up where
          you left off.
        </p>

        {sessions === null ? (
          <>
            <div className="h-16 animate-pulse rounded-xl bg-surface-card" />
            <div className="h-16 animate-pulse rounded-xl bg-surface-card" />
          </>
        ) : sessions.length === 0 ? (
          <Card>
            <CardTitle icon={MessagesSquare}>No conversations yet</CardTitle>
            <p className="text-sm text-ink-secondary">
              Say or type something in chat and it will show up here.
            </p>
          </Card>
        ) : (
          sessions.map((s) => {
            const channel = CHANNEL[s.channel as keyof typeof CHANNEL] ?? CHANNEL.text;
            const isOpen = open === s.id;
            return (
              <Card key={s.id}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : s.id)}
                  aria-expanded={isOpen}
                  className="w-full text-left"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 flex-1 truncate text-sm">
                      {s.title || <span className="text-ink-muted">Untitled conversation</span>}
                    </p>
                    <span className="shrink-0 text-[11px] tabular-nums text-ink-muted">
                      {when(s.last_active_at)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-ink-secondary">
                    <span className="inline-flex items-center gap-1">
                      <Icon as={channel.icon} size={11} />
                      {channel.label}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Icon as={MessagesSquare} size={11} />
                      {s.turns} {s.turns === 1 ? "turn" : "turns"}
                    </span>
                    <span className="inline-flex items-center gap-1 text-ink-muted">
                      <Icon as={Timer} size={11} />
                      started {when(s.started_at)}
                    </span>
                  </div>
                </button>
                {isOpen && <Transcript id={s.id} />}
              </Card>
            );
          })
        )}
      </main>
    </div>
  );
}
