"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ContextTrace,
  PersonBalance,
  ToolEvent,
  getBalances,
  inr,
  sendChatStream,
} from "@/lib/api";
import { speak, unlockSpeech, useSpeechInput } from "@/lib/speech";
import VoiceMode from "@/components/VoiceMode";
import AppHeader from "@/components/ui/AppHeader";
import Button, { buttonClass } from "@/components/ui/Button";
import Logo from "@/components/ui/Logo";
import ThemeToggle from "@/components/ui/ThemeToggle";
import Money from "@/components/ui/Money";
import Pill from "@/components/ui/Pill";
import { inputClass } from "@/components/ui/styles";

interface Message {
  role: "user" | "assistant";
  content: string;
  events?: ToolEvent[];
  trace?: ContextTrace;
  liveTools?: string[];
  streaming?: boolean;
}

const TOOL_BADGES: Record<string, string> = {
  record_transaction: "recorded",
  settle_up: "settled",
  void_transaction: "voided",
  get_balances: "balances",
  list_recent_transactions: "history",
  set_opening_balance: "opening balance",
  track_recurring: "recurring tracked",
  list_recurring: "recurring",
  stop_recurring: "recurring stopped",
  remember_fact: "noted",
  learn_rule: "rule saved",
  search_memory: "memory searched",
};

const SUGGESTIONS = [
  "lent Priya ₹500 for lunch",
  "chai 15",
  "gpay'd 40 for auto",
  "remember: rent is split 3 ways with Kiran and Meera",
  "did priya pay me back?",
];

function traceCount(trace?: ContextTrace): number {
  if (!trace) return 0;
  return (trace.rules?.length ?? 0) + (trace.facts?.length ?? 0) + (trace.episodes?.length ?? 0);
}

function TraceDetail({ trace }: { trace: ContextTrace }) {
  return (
    <div className="mt-2 space-y-1.5 rounded-lg border border-brand-line bg-brand-soft p-2.5 text-xs">
      {trace.rules?.map((r, i) => (
        <p key={`r${i}`}>
          <span className="font-medium text-brand-ink">rule</span>{" "}
          <span className="text-ink-secondary">{r.rule.instruction}</span>
        </p>
      ))}
      {trace.facts?.map((f, i) => (
        <p key={`f${i}`}>
          <span className="font-medium text-brand-ink">{f.kind}</span>{" "}
          <span className="text-ink-secondary">{f.fact}</span>
        </p>
      ))}
      {trace.episodes?.map((e, i) => (
        <p key={`e${i}`}>
          <span className="font-medium text-brand-ink">event</span>{" "}
          <span className="text-ink-secondary">{e.summary}</span>
        </p>
      ))}
    </div>
  );
}

function AssistantMeta({ message }: { message: Message }) {
  const [open, setOpen] = useState(false);
  const memories = traceCount(message.trace);
  const badges = (message.events ?? []).map((e) => TOOL_BADGES[e.tool] ?? e.tool);
  if (badges.length === 0 && memories === 0) return null;
  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {badges.map((b, i) => (
          <Pill key={i}>{b}</Pill>
        ))}
        {memories > 0 && (
          <button
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="rounded-full border border-brand-line bg-brand-soft px-2 py-0.5 text-[11px] text-brand-ink"
          >
            {memories} {memories === 1 ? "memory" : "memories"} used {open ? "▴" : "▾"}
          </button>
        )}
      </div>
      {open && message.trace && <TraceDetail trace={message.trace} />}
    </div>
  );
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [people, setPeople] = useState<PersonBalance[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSessionId(localStorage.getItem("ledger:session"));
    refreshBalances();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const refreshBalances = () =>
    getBalances()
      .then((b) => setPeople(b.people.filter((p) => Number(p.balance) !== 0)))
      .catch(() => {});

  const patchLast = (update: (m: Message) => Message) =>
    setMessages((all) => {
      const copy = [...all];
      copy[copy.length - 1] = update(copy[copy.length - 1]);
      return copy;
    });

  const send = useCallback(
    async (text: string, options?: { voice?: boolean }): Promise<string | null> => {
      const message = text.trim();
      if (!message || busy) return null;
      let replyText: string | null = null;
      setInput("");
      setBusy(true);
      setMessages((m) => [
        ...m,
        { role: "user", content: message },
        { role: "assistant", content: "", streaming: true, liveTools: [] },
      ]);
      try {
        await sendChatStream(message, sessionId, {
          onDelta: (delta) =>
            patchLast((m) => ({ ...m, content: m.content + delta })),
          onTool: (tool) =>
            // A tool round: discard optimistic text, show what's happening.
            patchLast((m) => ({
              ...m,
              content: "",
              liveTools: [...(m.liveTools ?? []), tool],
            })),
          onDone: (res) => {
            replyText = res.reply;
            localStorage.setItem("ledger:session", res.session_id);
            setSessionId(res.session_id);
            patchLast(() => ({
              role: "assistant",
              content: res.reply,
              events: res.events,
              trace: res.context_trace,
            }));
            if (options?.voice) speak(res.reply);
            refreshBalances();
          },
        });
      } catch (err) {
        patchLast(() => ({
          role: "assistant",
          content: `Something went wrong: ${err}`,
        }));
      } finally {
        setBusy(false);
      }
      return replyText;
    },
    [busy, sessionId]
  );

  const mic = useSpeechInput({
    onInterim: setInput,
    onFinal: (text) => send(text, { voice: true }),
  });
  const [voiceOpen, setVoiceOpen] = useState(false);

  const newSession = () => {
    localStorage.removeItem("ledger:session");
    setSessionId(null);
    setMessages([]);
  };

  return (
    <div className="flex h-dvh flex-col">
      {voiceOpen && (
        <VoiceMode onUtterance={(text) => send(text)} onClose={() => setVoiceOpen(false)} />
      )}
      <AppHeader
        gold
        title={
          <>
            <Logo size={22} className="text-brand-ink" />
            Knot
          </>
        }
        actions={
          <>
            {mic.supported && (
              <Button
                variant="tonal"
                tone="brand"
                onClick={() => {
                  unlockSpeech();
                  setVoiceOpen(true);
                }}
              >
                voice
              </Button>
            )}
            <Button onClick={newSession} title="Memory persists across sessions">
              new session
            </Button>
            <Link href="/memory" aria-label="Memory inspector" className={buttonClass()}>
              memory
            </Link>
            <Link href="/insights" aria-label="Spending insights" className={buttonClass()}>
              insights
            </Link>
            <Link href="/transactions" aria-label="All transactions" className={buttonClass()}>
              ledger
            </Link>
            <ThemeToggle />
          </>
        }
      >
        {people.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-2.5">
            {people.map((p) => (
              <Pill
                key={p.display_name}
                tone={Number(p.balance) > 0 ? "positive" : "negative"}
              >
                {p.display_name} {Number(p.balance) > 0 ? "owes you" : "is owed"}{" "}
                <Money value={p.balance} tone="neutral" />
              </Pill>
            ))}
          </div>
        )}
      </AppHeader>

      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="mt-10 space-y-4 text-center">
            <Logo size={40} className="mx-auto text-brand-ink" />
            <p className="text-sm text-ink-secondary">
              Tell me about your money — I&apos;ll keep the books and remember.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-line bg-surface-card px-3 py-1.5 text-xs text-ink-secondary active:bg-surface-raised"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand px-3.5 py-2 text-sm text-ink-on-brand">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <div className="max-w-[85%]">
                <div className="whitespace-pre-wrap rounded-2xl rounded-bl-md border border-line bg-surface-card px-3.5 py-2 text-sm">
                  {m.content ||
                    (m.streaming && (
                      <span className="flex items-center gap-2 text-ink-secondary">
                        <Logo size={16} state="thinking" className="text-brand-ink" />
                        {m.liveTools?.length
                          ? (TOOL_BADGES[m.liveTools[m.liveTools.length - 1]] ??
                            m.liveTools[m.liveTools.length - 1])
                          : "thinking"}
                      </span>
                    ))}
                  {m.streaming && m.content && (
                    <span className="animate-pulse text-brand-ink">▍</span>
                  )}
                </div>
                <AssistantMeta message={m} />
              </div>
            </div>
          )
        )}
        <div ref={bottomRef} />
      </main>

      <footer className="border-t border-line bg-surface-base px-4 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="flex items-center gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={mic.listening ? "listening…" : "lent Priya 500 for lunch…"}
            aria-label="Message"
            className={`${inputClass} flex-1 rounded-full py-2.5`}
          />
          {mic.supported && (
            <Button
              variant="tonal"
              tone={mic.listening ? "negative" : "neutral"}
              onClick={mic.listening ? mic.stop : mic.start}
              aria-label={mic.listening ? "Stop listening" : "Speak"}
              className={`rounded-full px-3.5 py-2.5 ${mic.listening ? "animate-pulse" : ""}`}
            >
              {mic.listening ? "■" : "🎙"}
            </Button>
          )}
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={busy || !input.trim()}
            className="rounded-full"
          >
            Send
          </Button>
        </form>
      </footer>
    </div>
  );
}
