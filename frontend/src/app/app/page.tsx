"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ContextTrace,
  PersonBalance,
  ToolEvent,
  getBalances,
  getSessionTrace,
  sendChatStream,
} from "@/lib/api";
import { cinchKnot, WRITE_TOOLS } from "@/lib/knot";
import { stopSpeaking, unlockSpeech, useSpeechInput } from "@/lib/speech";
import VoiceMode from "@/components/VoiceMode";
import AppShell, { PageTitle } from "@/components/ui/AppShell";
import Button from "@/components/ui/Button";
import Logo from "@/components/ui/Logo";
import Money from "@/components/ui/Money";
import Pill from "@/components/ui/Pill";
import Icon from "@/components/ui/Icon";
import {
  ChevronDown,
  ChevronUp,
  Mic,
  ArrowUp,
  Square,
  SquarePen,
} from "lucide-react";

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

/** Grouped so the empty state shows the range, not just the easiest thing.
 * Someone landing here has no idea this tracks EMIs, holdings or limits. */
const EXAMPLE_GROUPS = [
  {
    title: "everyday",
    items: ["chai 15", "gpay'd 40 for auto", "paid 200 cash for vegetables"],
  },
  {
    title: "people",
    items: ["lent Priya ₹500 for lunch", "did Priya pay me back?", "borrowed 2000 from Arjun"],
  },
  {
    title: "money in",
    items: ["salary 95000 on the 1st every month", "got 1200 rent from the tenant"],
  },
  {
    title: "investing",
    items: ["bought 10 Reliance at 1380", "put 5000 into Nifty 50", "Reliance is at 1450 now"],
  },
  {
    title: "borrowing",
    items: ["I have a 5 lakh car loan at 9% for 5 years", "how much of my EMI is interest?"],
  },
  {
    title: "limits",
    items: ["keep me under 10k for food", "how am I doing this month?"],
  },
  {
    title: "it remembers",
    items: [
      "remember: rent is split 3 ways with Kiran and Meera",
      "no, Priya is my flatmate not my sister",
    ],
  },
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
            {memories} {memories === 1 ? "memory" : "memories"} used{" "}
            <Icon as={open ? ChevronUp : ChevronDown} size={11} className="inline align-[-1px]" />
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
  const [restoring, setRestoring] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  /* Rehydrate the conversation you are actually in.
   *
   * The session id survived a reload but its turns never did, so you came back
   * to a blank screen while the agent still held the whole conversation — and
   * anything you said was appended to a session that looked new. That is also
   * why "new conversation" seemed to do nothing: it cleared a screen that was
   * already empty.
   *
   * Loading the turns makes the visible conversation and the real one the same
   * thing, which is the only version of this that isn't confusing. */
  useEffect(() => {
    const stored = localStorage.getItem("ledger:session");
    setSessionId(stored);
    refreshBalances();
    if (!stored) return setRestoring(false);

    getSessionTrace(stored)
      .then((r) => {
        setMessages(
          r.turns
            .filter((t) => t.role === "user" || t.role === "assistant")
            .map((t) => ({
              role: t.role as "user" | "assistant",
              content: t.content,
              events: t.tool_calls ?? undefined,
              trace: t.context_trace ?? undefined,
            })),
        );
      })
      .catch(() => {
        // A bogus or expired id: the next message will mint a fresh session
        // anyway, so drop it rather than resuming something that isn't there.
        localStorage.removeItem("ledger:session");
        setSessionId(null);
      })
      .finally(() => setRestoring(false));
  }, []);

  useEffect(() => {
    // Only once there is something to follow. Scrolling on an empty
    // conversation dumped a first-time visitor halfway down the examples,
    // below the one line explaining what this is.
    if (messages.length === 0) return;
    // Jump, don't animate, when a restored conversation first paints — a
    // smooth scroll through fifty turns is a long, pointless journey.
    bottomRef.current?.scrollIntoView({ behavior: restoring ? "instant" : "smooth" });
  }, [messages, busy, restoring]);

  const refreshBalances = () =>
    getBalances()
      .then((b) => setPeople(b.people.filter((p) => Number(p.balance) !== 0)))
      .catch(() => {});

  const patchLast = (update: (m: Message) => Message) =>
    setMessages((all) => {
      // A stream can still be running when "new conversation" empties the
      // list. Without this guard the updater either throws reading `m.content`
      // off undefined, or writes to index -1 and drops the reply silently.
      if (all.length === 0) return all;
      const copy = [...all];
      copy[copy.length - 1] = update(copy[copy.length - 1]);
      return copy;
    });

  const send = useCallback(
    async (text: string): Promise<string | null> => {
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
            // Only a committed write ties the knot — never a mere answer.
            if ((res.events ?? []).some((e) => WRITE_TOOLS.has(e.tool))) cinchKnot();
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

  const [voiceOpen, setVoiceOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  /* The footer mic is DICTATION, not a conversation.
   *
   * It used to send the moment recognition ended and speak the reply, which
   * made it a second voice mode — and since send() clears the input, the
   * transcript vanished before anyone could read it.
   *
   * It now fills the composer and stops. That matters here specifically
   * because this is money: "fifteen" and "fifty" are one mishearing apart,
   * and the difference should be correctable before it becomes a ledger
   * entry. Spoken replies belong to the overlay, which is hands-free by
   * design and where you cannot read the screen anyway. */
  const mic = useSpeechInput({
    onInterim: setInput,
    onFinal: (text) => setInput(text),
  });

  // Opening the overlay must still silence this page's microphone — two
  // recognisers competing for one input device is its own problem, separate
  // from the speaking one.
  useEffect(() => {
    if (voiceOpen) {
      mic.stop();
      stopSpeaking();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceOpen]);

  const newSession = () => {
    localStorage.removeItem("ledger:session");
    setSessionId(null);
    setMessages([]);
    setInput("");
    // Nothing is lost — the old conversation keeps its own row in history, and
    // what the agent learned from it stays in memory either way.
  };

  /* One composer, two homes. On an empty conversation it sits in the hero —
   * the product's primary action, not a strip at the bottom of a blank page.
   * Once a conversation exists it drops to the footer. A JSX const rather
   * than an inner component: an inner component gets a new identity every
   * render, which remounts the input and loses focus on every keystroke. */
  const heroMode = !restoring && messages.length === 0;
  const composer = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send(input);
      }}
      className={`elevated flex w-full items-center gap-2 rounded-2xl border bg-surface-card p-2 transition-colors ${
        focused ? "border-brand-line" : "border-line"
      }`}
    >
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={mic.listening ? "listening…" : "lent Priya 500 for lunch…"}
        aria-label="Message"
        className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-[15px] outline-none placeholder:text-ink-muted"
      />
      {mic.supported && (
        <Button
          variant="tonal"
          tone={mic.listening ? "negative" : "neutral"}
          onClick={mic.listening ? mic.stop : mic.start}
          aria-label={mic.listening ? "Stop listening" : "Speak"}
          className={`rounded-xl px-3.5 py-2.5 ${mic.listening ? "animate-pulse" : ""}`}
        >
          <Icon as={mic.listening ? Square : Mic} size={17} />
        </Button>
      )}
      <Button
        type="submit"
        variant="primary"
        size="md"
        disabled={busy || !input.trim()}
        aria-label="Send"
        className="rounded-xl px-4"
      >
        <Icon as={ArrowUp} size={17} />
      </Button>
    </form>
  );

  return (
    <AppShell
      contentClassName="py-5"
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
          <Button
            onClick={newSession}
            title="Start a new conversation — memory persists across all of them"
            aria-label="New conversation"
          >
            <span className="hidden sm:inline">new conversation</span>
            <span className="sm:hidden">
              <Icon as={SquarePen} size={15} />
            </span>
          </Button>
        </>
      }
      footer={
        !heroMode && (
          <footer className="px-6 pb-[max(env(safe-area-inset-bottom),1rem)] pt-2 sm:px-8">
            <div className="mx-auto w-full max-w-310">
              <div className="max-w-195">{composer}</div>
            </div>
          </footer>
        )
      }
    >
      {voiceOpen && (
        <VoiceMode onUtterance={(text) => send(text)} onClose={() => setVoiceOpen(false)} />
      )}
      {people.length > 0 && (
        <div className="mb-5 flex gap-2 overflow-x-auto">
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

      {heroMode ? (
        <div>
          <Logo size={40} className="knot-draw text-brand-ink" />
          <div className="mt-4">
            <PageTitle>Just say what happened.</PageTitle>
          </div>
          <p className="mt-2 max-w-160 text-[15px] leading-relaxed text-ink-secondary">
            Knot keeps a real double-entry ledger and remembers the people, habits and
            commitments behind it — so you never explain the same thing twice.
          </p>
          <div className="mt-6 max-w-195">{composer}</div>
          <div className="mt-8 grid gap-x-8 gap-y-5 sm:grid-cols-2">
            {EXAMPLE_GROUPS.map((group) => (
              <section key={group.title}>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">
                  {group.title}
                </p>
                <div className="flex flex-wrap gap-2">
                  {group.items.map((item) => (
                    <button
                      key={item}
                      onClick={() => send(item)}
                      className="rounded-lg border border-line bg-surface-card px-3 py-1.5 text-left text-sm text-ink-secondary transition-colors hover:border-line-strong hover:bg-surface-raised hover:text-ink-primary"
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      ) : (
        <div className="max-w-195 space-y-3">
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
        </div>
      )}
    </AppShell>
  );
}
