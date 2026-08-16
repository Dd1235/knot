"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  ContextTrace,
  PersonBalance,
  ToolEvent,
  getBalances,
  getSessionTrace,
  sendChatStream,
} from "@/lib/api";
import { cinchKnot, WRITE_TOOLS } from "@/lib/knot";
import { useVoice } from "@/lib/voice-context";
import { stopSpeaking, useSpeechInput } from "@/lib/speech";
import AppShell, { PageTitle, ScreenReaderOnly } from "@/components/ui/AppShell";
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
const EXAMPLE_GROUPS: { title: string; items: string[]; voice?: boolean }[] = [
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
    // The only group whose chips open voice rather than sending text — until
    // now nothing in the empty state mentioned that talking was possible.
    title: "say it out loud",
    voice: true,
    items: ["read me my finances", "how am I doing this month?", "what changed?"],
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
  const panelId = useId();
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
            aria-controls={panelId}
            className="rounded-full border border-brand-line bg-brand-soft px-2 py-0.5 text-[11px] text-brand-ink"
          >
            {memories} {memories === 1 ? "memory" : "memories"} used{" "}
            <Icon as={open ? ChevronUp : ChevronDown} size={11} className="inline align-[-1px]" />
          </button>
        )}
      </div>
      <div id={panelId}>{open && message.trace && <TraceDetail trace={message.trace} />}</div>
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
  const inputRef = useRef<HTMLInputElement>(null);
  /* What a screen reader is told. Deliberately NOT the token stream: an
   * aria-live region fed by deltas announces every fragment and is unusable.
   * This gets one sentence when the turn completes. */
  const [announcement, setAnnouncement] = useState("");

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
  const refreshBalances = useCallback(
    () =>
      getBalances()
        .then((b) => setPeople(b.people.filter((p) => Number(p.balance) !== 0)))
        .catch(() => {}),
    [],
  );

  const restoreSession = useCallback(() => {
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
  }, [refreshBalances]);

  useEffect(() => {
    restoreSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  useEffect(() => {
    // Only once there is something to follow. Scrolling on an empty
    // conversation dumped a first-time visitor halfway down the examples,
    // below the one line explaining what this is.
    if (messages.length === 0) return;
    // Jump, don't animate, when a restored conversation first paints — a
    // smooth scroll through fifty turns is a long, pointless journey.
    // A JS-specified `behavior` ignores the CSS reduced-motion switch, and this
    // fires on every streamed token, so it has to check the query itself.
    const still =
      restoring ||
      (typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    bottomRef.current?.scrollIntoView({ behavior: still ? "instant" : "smooth" });
  }, [messages, busy, restoring]);

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
            // One announcement per turn, reply first, then what it did.
            const did = (res.events ?? [])
              .map((e) => TOOL_BADGES[e.tool] ?? e.tool)
              .join(", ");
            setAnnouncement(did ? `${res.reply} (${did})` : res.reply);
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
    [busy, sessionId, refreshBalances]
  );

  const [focused, setFocused] = useState(false);
  const { open: voiceOpen, openVoice, setHandler } = useVoice();

  /* Live voice does not go through this page's `send` — it talks to the
   * realtime service directly and the turns are persisted server-side. So when
   * the overlay closes, the conversation on screen is stale by exactly the
   * turns that were just spoken. Re-read the session and they appear, which is
   * what "voice and text are one conversation" has to mean in practice. */
  const wasOpen = useRef(voiceOpen);
  useEffect(() => {
    if (wasOpen.current && !voiceOpen) restoreSession();
    wasOpen.current = voiceOpen;
  }, [voiceOpen, restoreSession]);

  /* The shell owns the overlay so it can open anywhere, but on this page a
   * spoken turn should stream into the visible conversation exactly as a typed
   * one does — so chat lends the shell its own send(). */
  useEffect(() => setHandler(send), [send, setHandler]);
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
    setAnnouncement("New conversation started.");
    inputRef.current?.focus();
    // Nothing is lost — the old conversation keeps its own row in history, and
    // what the agent learned from it stays in memory either way.
  };

  /* One composer, two homes. On an empty conversation it sits in the hero —
   * the product's primary action, not a strip at the bottom of a blank page.
   * Once a conversation exists it drops to the footer. A JSX const rather
   * than an inner component: an inner component gets a new identity every
   * render, which remounts the input and loses focus on every keystroke. */
  const heroMode = !restoring && messages.length === 0;

  /* The composer is rendered in two structurally different places — in the
   * hero while the conversation is empty, in AppShell's footer slot once it is
   * not. The first send flips `heroMode`, React destroys the focused input and
   * builds a new one, and focus falls to <body>: the app's primary action left
   * a keyboard user with nowhere to type. Re-focus after the swap.
   *
   * Only on the SWAP, never on first paint. Stealing focus on load would put
   * the caret in the composer before the user has asked for it, and — worse —
   * would move the first Tab stop past the skip link, which exists precisely
   * so a keyboard user can get to the content without crossing the whole nav. */
  const wasHero = useRef<boolean | null>(null);
  useEffect(() => {
    if (restoring) return;
    if (wasHero.current !== null && wasHero.current !== heroMode) {
      inputRef.current?.focus();
    }
    wasHero.current = heroMode;
  }, [heroMode, restoring]);
  const composer = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send(input);
      }}
      className={`elevated flex w-full items-center gap-2 rounded-2xl border bg-surface-card p-2 transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--focus-ring)] ${
        focused ? "border-brand-line" : "border-line"
      }`}
    >
      <input
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={mic.listening ? "listening…" : "lent Priya 500 for lunch…"}
        aria-label="Message"
        className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-base outline-none placeholder:text-ink-muted sm:text-[15px]"
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
      {/* The hero's PageTitle disappears once a conversation starts, leaving the
          app's main screen with no h1 at all. */}
      {!heroMode && <ScreenReaderOnly as="h1">Chat</ScreenReaderOnly>}
      {/* One polite announcement per completed turn. The streaming bubble below
          is aria-hidden precisely so this is the only thing that speaks. */}
      <ScreenReaderOnly role="status" aria-live="polite">
        {announcement}
      </ScreenReaderOnly>
      {people.length > 0 && (
        <div className="mb-5 flex gap-2 overflow-x-auto">
          {people.map((p) => (
            <Pill
              key={p.display_name}
              tone={Number(p.balance) > 0 ? "positive" : "negative"}
            >
              {p.display_name} {Number(p.balance) > 0 ? "owes you" : "is owed"}{" "}
              {/* The words carry the direction, so the figure is a magnitude. */}
              <Money value={Math.abs(Number(p.balance))} tone="neutral" />
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
                      onClick={() => (group.voice ? openVoice() : send(item))}
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
                  <div
                    // While a turn is in flight this text is a token stream;
                    // the polite live region above announces the finished reply
                    // instead, so this must not also be read out.
                    aria-hidden={m.streaming ? true : undefined}
                    className="whitespace-pre-wrap rounded-2xl rounded-bl-md border border-line bg-surface-card px-3.5 py-2 text-sm"
                  >
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
