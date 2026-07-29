"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { speak, stopSpeaking, useSpeechInput } from "@/lib/speech";

type VoiceState = "listening" | "thinking" | "speaking";

const STATE_STYLE: Record<VoiceState, { ring: string; label: string }> = {
  listening: { ring: "border-emerald-500 shadow-emerald-500/30", label: "listening…" },
  thinking: { ring: "border-amber-500 shadow-amber-500/30", label: "thinking…" },
  speaking: { ring: "border-sky-500 shadow-sky-500/30", label: "speaking — tap to interrupt" },
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
  const closedRef = useRef(false);
  const silentRoundsRef = useRef(0);
  const interruptedRef = useRef(false);
  const startRef = useRef<() => void>(() => {});

  const begin = useCallback(() => {
    if (closedRef.current) return;
    setState("listening");
    setTranscript("");
    startRef.current();
  }, []);

  const mic = useSpeechInput({
    onInterim: setTranscript,
    onFinal: async (text) => {
      silentRoundsRef.current = 0;
      setState("thinking");
      const answer = await onUtterance(text);
      if (closedRef.current) return;
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
      if (closedRef.current) return;
      silentRoundsRef.current += 1;
      if (silentRoundsRef.current >= 2) onClose();
      else begin();
    },
  });
  startRef.current = mic.start;

  useEffect(() => {
    begin();
    return () => {
      closedRef.current = true;
      stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tapCircle = () => {
    if (state === "speaking") {
      interruptedRef.current = true;
      stopSpeaking();
      begin();
    } else if (state === "listening") {
      mic.stop(); // finalizes whatever was heard
    }
  };

  const style = STATE_STYLE[state];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-zinc-950/97 backdrop-blur px-6 pt-[env(safe-area-inset-top)]">
      <div className="flex h-14 items-center justify-end">
        <button
          onClick={onClose}
          className="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 active:bg-zinc-900"
        >
          ✕ exit voice
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-8 pb-24">
        <button
          onClick={tapCircle}
          className={`flex h-40 w-40 items-center justify-center rounded-full border-4 bg-zinc-900 text-5xl shadow-2xl transition-colors ${style.ring} ${
            state !== "thinking" ? "animate-pulse" : ""
          }`}
        >
          {state === "listening" ? "🎙" : state === "thinking" ? "🧠" : "🔊"}
        </button>
        <p className="text-sm text-zinc-400">{style.label}</p>

        <div className="min-h-24 max-w-md text-center space-y-3">
          {transcript && (
            <p className="text-lg text-zinc-100 leading-snug">&ldquo;{transcript}&rdquo;</p>
          )}
          {!transcript && reply && state !== "listening" && (
            <p className="text-sm text-zinc-400 leading-relaxed">{reply}</p>
          )}
          {!transcript && !reply && state === "listening" && (
            <p className="text-sm text-zinc-600">
              try &ldquo;lent Priya five hundred for lunch&rdquo;
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
