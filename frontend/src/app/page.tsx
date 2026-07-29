"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ChatResponse,
  ContextTrace,
  PersonBalance,
  ToolEvent,
  getBalances,
  inr,
  sendChat,
} from "@/lib/api";
import { speak, useSpeechInput } from "@/lib/speech";

interface Message {
  role: "user" | "assistant";
  content: string;
  events?: ToolEvent[];
  trace?: ContextTrace;
}

const TOOL_BADGES: Record<string, string> = {
  record_transaction: "₹ recorded",
  settle_up: "✓ settled",
  get_balances: "balances",
  list_recent_transactions: "history",
  remember_fact: "🧠 noted",
  learn_rule: "🧠 rule saved",
  search_memory: "🔍 memory",
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
    <div className="mt-2 rounded-lg border border-emerald-900/60 bg-emerald-950/30 p-2.5 text-xs space-y-1.5">
      {trace.rules?.map((r, i) => (
        <p key={`r${i}`}>
          <span className="text-emerald-400 font-medium">rule</span>{" "}
          <span className="text-zinc-300">{r.rule.instruction}</span>
        </p>
      ))}
      {trace.facts?.map((f, i) => (
        <p key={`f${i}`}>
          <span className="text-emerald-400 font-medium">{f.kind}</span>{" "}
          <span className="text-zinc-300">{f.fact}</span>
        </p>
      ))}
      {trace.episodes?.map((e, i) => (
        <p key={`e${i}`}>
          <span className="text-emerald-400 font-medium">event</span>{" "}
          <span className="text-zinc-300">{e.summary}</span>
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
          <span
            key={i}
            className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400"
          >
            {b}
          </span>
        ))}
        {memories > 0 && (
          <button
            onClick={() => setOpen(!open)}
            className="rounded-full bg-emerald-950 px-2 py-0.5 text-[11px] text-emerald-400 border border-emerald-900"
          >
            🧠 {memories} {memories === 1 ? "memory" : "memories"} used {open ? "▴" : "▾"}
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

  const send = useCallback(
    async (text: string, options?: { voice?: boolean }) => {
      const message = text.trim();
      if (!message || busy) return;
      setInput("");
      setBusy(true);
      setMessages((m) => [...m, { role: "user", content: message }]);
      try {
        const res: ChatResponse = await sendChat(message, sessionId);
        localStorage.setItem("ledger:session", res.session_id);
        setSessionId(res.session_id);
        setMessages((m) => [
          ...m,
          { role: "assistant", content: res.reply, events: res.events, trace: res.context_trace },
        ]);
        if (options?.voice) speak(res.reply);
        refreshBalances();
      } catch (err) {
        setMessages((m) => [
          ...m,
          { role: "assistant", content: `Something went wrong: ${err}` },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [busy, sessionId]
  );

  const mic = useSpeechInput({
    onInterim: setInput,
    onFinal: (text) => send(text, { voice: true }),
  });

  const newSession = () => {
    localStorage.removeItem("ledger:session");
    setSessionId(null);
    setMessages([]);
  };

  return (
    <div className="flex h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur px-4 pt-[env(safe-area-inset-top)]">
        <div className="flex h-14 items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight">
            <span className="text-emerald-400">₹</span> Ledger
          </h1>
          <div className="flex items-center gap-2">
            <button
              onClick={newSession}
              title="New session (memory persists!)"
              className="rounded-lg border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-400 active:bg-zinc-900"
            >
              ↺ new session
            </button>
            <Link
              href="/memory"
              className="rounded-lg border border-emerald-900 bg-emerald-950/50 px-2.5 py-1.5 text-xs text-emerald-400 active:bg-emerald-950"
            >
              🧠 memory
            </Link>
            <Link
              href="/demo"
              className="rounded-lg border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-400 active:bg-zinc-900"
            >
              ⚡
            </Link>
          </div>
        </div>
        {people.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-2.5 text-xs">
            {people.map((p) => (
              <span
                key={p.display_name}
                className={`whitespace-nowrap rounded-full px-2.5 py-1 border ${
                  Number(p.balance) > 0
                    ? "border-emerald-900 bg-emerald-950/40 text-emerald-300"
                    : "border-rose-900 bg-rose-950/40 text-rose-300"
                }`}
              >
                {p.display_name} {Number(p.balance) > 0 ? "owes you" : "is owed"}{" "}
                {inr(Math.abs(Number(p.balance)))}
              </span>
            ))}
          </div>
        )}
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="mt-10 space-y-4 text-center">
            <p className="text-3xl">🪙</p>
            <p className="text-sm text-zinc-400">
              Tell me about your money — I&apos;ll keep the books and remember.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 active:bg-zinc-800"
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
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-emerald-700 px-3.5 py-2 text-sm">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <div className="max-w-[85%]">
                <div className="rounded-2xl rounded-bl-md bg-zinc-900 border border-zinc-800 px-3.5 py-2 text-sm whitespace-pre-wrap">
                  {m.content}
                </div>
                <AssistantMeta message={m} />
              </div>
            </div>
          )
        )}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md bg-zinc-900 border border-zinc-800 px-3.5 py-2 text-sm text-zinc-500">
              <span className="animate-pulse">thinking…</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      <footer className="border-t border-zinc-800 bg-zinc-950 px-4 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
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
            className="flex-1 rounded-full border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-800"
          />
          {mic.supported && (
            <button
              type="button"
              onClick={mic.listening ? mic.stop : mic.start}
              title={mic.listening ? "Stop listening" : "Speak"}
              className={`rounded-full px-3.5 py-2.5 text-sm border ${
                mic.listening
                  ? "border-rose-700 bg-rose-950/60 text-rose-400 animate-pulse"
                  : "border-zinc-800 bg-zinc-900 text-zinc-300 active:bg-zinc-800"
              }`}
            >
              {mic.listening ? "■" : "🎙"}
            </button>
          )}
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="rounded-full bg-emerald-600 px-4 py-2.5 text-sm font-medium disabled:opacity-40 active:bg-emerald-700"
          >
            Send
          </button>
        </form>
      </footer>
    </div>
  );
}
