"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SPEECH_LANGS,
  setSpeechLang,
  speak,
  stopSpeaking,
  useSpeechInput,
  useSpeechLang,
} from "@/lib/speech";
import { RealtimeSession, type RealtimeState } from "@/lib/realtime";
import { authHeadersForRealtime } from "@/lib/api";
import Button from "@/components/ui/Button";
import Logo from "@/components/ui/Logo";
import Icon from "@/components/ui/Icon";
import { X } from "lucide-react";

type VoiceState = "listening" | "thinking" | "speaking";

const STATE: Record<VoiceState, { ring: string; label: string }> = {
  listening: { ring: "border-positive shadow-positive/30", label: "listening…" },
  // Brand, not warning: the knot tying itself is the product's signature moment.
  thinking: { ring: "border-brand shadow-brand/30", label: "thinking…" },
  speaking: { ring: "border-info shadow-info/30", label: "speaking — tap to interrupt" },
};

export default function VoiceMode({
  onUtterance,
  onClose,
}: {
  onUtterance: (text: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [state, setState] = useState<VoiceState>("listening");
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  const [tool, setTool] = useState<string | null>(null);
  const closedRef = useRef(false);
  /* True only while the DEVICE engine owns the overlay. The on-device loop
   * re-arms itself from async continuations — speak()'s end callback (which
   * stopSpeaking() deliberately fires), a reply that lands after an await —
   * and each of those used to check only closedRef. Switching to live voice
   * left them all pending, and the first one to fire restarted the device
   * microphone underneath the realtime session: two agents, again. */
  const deviceLiveRef = useRef(false);
  const silentRoundsRef = useRef(0);
  const interruptedRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const speechLang = useSpeechLang();

  const micRef = useRef<{ start: () => void } | null>(null);
  const begin = useCallback(() => {
    if (closedRef.current || !deviceLiveRef.current) return;
    setState("listening");
    setTranscript("");
    micRef.current?.start();
  }, []);

  const mic = useSpeechInput({
    onInterim: setTranscript,
    onFinal: async (text) => {
      silentRoundsRef.current = 0;
      setState("thinking");
      let answer: string | null = null;
      try {
        answer = await Promise.race([
          onUtterance(text),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 45000)),
        ]);
      } catch {
        answer = "Sorry, something went wrong — try again.";
      }
      if (closedRef.current || !deviceLiveRef.current) return;
      setTranscript("");
      setReply(answer ?? "");
      if (answer) {
        setState("speaking");
        interruptedRef.current = false;
        speak(answer, () => {
          if (closedRef.current || interruptedRef.current) return;
          begin();
        });
      } else {
        begin();
      }
    },
    onSilence: () => {
      if (closedRef.current || !deviceLiveRef.current) return;
      silentRoundsRef.current += 1;
      if (silentRoundsRef.current >= 2) onClose();
      else begin();
    },
  });

  // Assigned after commit, not during render: begin() is only ever called
  // from an effect or an event handler, so it never needs the pre-commit value.
  useEffect(() => {
    micRef.current = mic;
  });

  // On-device (Web Speech) is the default: free, and good enough for the
  // one-liners this app is mostly used for. Realtime is a deliberate opt-in —
  // it bills per minute of audio both ways, and it earns that on genuine
  // back-and-forth, where sub-second turns and barge-in actually matter.
  const realtimeRef = useRef<RealtimeSession | null>(null);
  const [fellBack, setFellBack] = useState(false);
  const [engine, setEngine] = useState<"realtime" | "device">(() =>
    typeof window === "undefined"
      ? "device"
      : ((localStorage.getItem("knot:voice") as "realtime" | "device") ?? "device"),
  );

  /* closedRef means "the whole overlay is gone", and only unmount may set it.
   * It used to be set by the engine effect's cleanup too — two different
   * lifetimes sharing one flag. After any cleanup it stayed true forever,
   * which silently disabled begin(), every onState update (the ring froze on
   * "listening" while transcripts kept moving) and the fallback path. */
  useEffect(() => {
    closedRef.current = false;
    return () => {
      closedRef.current = true;
    };
  }, []);

  useEffect(() => {
    // Each run of this effect gets its own token, so a stale run can never
    // speak for a live one.
    let live = true;

    if (engine === "device") {
      deviceLiveRef.current = true;
      begin();
      return () => {
        deviceLiveRef.current = false;
        live = false;
        mic.stop();
        stopSpeaking();
      };
    }

    const session = new RealtimeSession({
      onState: (s: RealtimeState) => {
        if (!live || closedRef.current) return;
        setState(s === "connecting" ? "thinking" : (s as VoiceState));
      },
      onUserTranscript: (t) => live && setTranscript(t),
      onAssistantTranscript: (t) => {
        if (!live) return;
        setTranscript("");
        setReply(t);
      },
      onTool: (name) => live && setTool(name),
      onError: (message) => live && setReply(message),
    });
    realtimeRef.current = session;

    session.start(authHeadersForRealtime(), localStorage.getItem("ledger:session")).catch(() => {
      // Without this stop() a failed connect left its peer connection and
      // microphone open while the Web Speech loop started on top of them.
      session.stop();
      if (!live) return;
      realtimeRef.current = null;
      setFellBack(true);
      // The fallback loop is device speech running under THIS effect's
      // lifetime, so it claims device liveness here and the cleanup below
      // releases it.
      deviceLiveRef.current = true;
      begin();
    });

    return () => {
      live = false;
      deviceLiveRef.current = false;
      session.stop();
      if (realtimeRef.current === session) realtimeRef.current = null;
      stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  const switchEngine = (next: "realtime" | "device") => {
    if (next === engine) return;
    localStorage.setItem("knot:voice", next);
    // Teardown belongs to the effect cleanup, which runs on the engine change.
    // Doing it here as well is what previously clobbered closedRef and left
    // on-device mode unable to start its microphone at all.
    stopSpeaking();
    silentRoundsRef.current = 0;
    setFellBack(false);
    setReply("");
    setTranscript("");
    setEngine(next);
  };

  /* Focus has to ENTER the dialog, or the Tab trap below never engages: it
   * compares document.activeElement against the first/last focusable node
   * inside dialogRef, and on open activeElement is still the "voice" button
   * out in the header — behind aria-modal. The first Tab then walked into the
   * chrome the overlay is covering. Restore focus on the way out, too. */
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  // Escape closes; Tab is trapped inside the overlay.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const tapCircle = () => {
    if (realtimeRef.current) {
      realtimeRef.current.interrupt();
      return;
    }
    if (state === "speaking") {
      interruptedRef.current = true;
      stopSpeaking();
      begin();
    } else if (state === "listening") {
      mic.stop();
    }
  };

  const style = STATE[state];

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Voice conversation"
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col bg-surface-overlay px-6 pt-[env(safe-area-inset-top)] backdrop-blur"
    >
      <div className="flex h-14 items-center justify-between gap-2">
        {/* Named by what they cost you, not by their technology. "realtime"
            vs "on-device" told you nothing about which one bills per minute. */}
        <div role="tablist" aria-label="Voice engine" className="flex gap-1">
          {(
            [
              { id: "device", label: "free", hint: "On-device — free, one turn at a time" },
              { id: "realtime", label: "live", hint: "Live conversation — natural, interruptible, billed per minute" },
            ] as const
          ).map(({ id, label, hint }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={engine === id}
              title={hint}
              onClick={() => switchEngine(id)}
              className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                engine === id
                  ? "bg-brand text-ink-on-brand font-medium"
                  : "border border-line text-ink-secondary"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {engine === "device" && (
          <label className="ml-2 flex items-center gap-1.5 text-[11px] text-ink-secondary">
            <span className="sr-only">Speech language</span>
            <select
              value={speechLang}
              onChange={(e) => setSpeechLang(e.target.value)}
              className="rounded-full border border-line bg-surface-card px-2 py-1 text-xs text-ink-secondary outline-none"
              title="Language for on-device speech. Live voice detects it for you."
            >
              {SPEECH_LANGS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button onClick={onClose} aria-label="Exit voice mode">
          <span className="inline-flex items-center gap-1.5">
            <Icon as={X} size={13} />
            exit voice
          </span>
        </Button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-8 pb-[max(env(safe-area-inset-bottom),6rem)]">
        <button
          type="button"
          onClick={tapCircle}
          aria-label={
            state === "speaking"
              ? "Interrupt and speak"
              : state === "listening"
                ? "Stop listening and send"
                : "Thinking"
          }
          className={`flex h-40 w-40 items-center justify-center rounded-full border-4 bg-surface-card shadow-2xl transition-colors ${style.ring}`}
        >
          <Logo
            size={72}
            state={state === "thinking" ? "thinking" : "idle"}
            className={
              state === "listening"
                ? "animate-pulse text-positive"
                : state === "speaking"
                  ? "text-info"
                  : "text-brand-ink"
            }
          />
        </button>
        <p aria-live="polite" className="text-sm text-ink-secondary">
          {tool && state === "thinking" ? `${tool.replace(/_/g, " ")}…` : style.label}
        </p>
        {(engine === "device" || fellBack) && (
          <p className="-mt-6 text-[11px] text-ink-muted">
            {engine === "device"
              ? "on-device speech — free, no audio leaves your phone"
              : "live voice unavailable — using on-device speech"}
          </p>
        )}

        <div className="min-h-24 max-w-md space-y-3 text-center">
          {transcript && (
            <p className="text-lg leading-snug text-ink-primary">
              &ldquo;{transcript}&rdquo;
            </p>
          )}
          {!transcript && reply && state !== "listening" && (
            <p aria-live="polite" className="text-sm leading-relaxed text-ink-secondary">
              {reply}
            </p>
          )}
          {!transcript && !reply && state === "listening" && (
            <p className="text-sm text-ink-muted">
              try &ldquo;lent Priya five hundred for lunch&rdquo;
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
