"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/* Minimal typings for the (webkit-prefixed) Web Speech API. */
interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: RecognitionResult[] & { length: number };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  }
}

/** The on-device engine's language.
 *
 * Default is American English, not Indian: en-IN picks an Indian-accented
 * system voice on most platforms, and its coverage is patchier than en-US — on
 * several browsers the Indian voice simply does not exist and synthesis falls
 * back to something worse. Amounts are still formatted in Indian digit
 * grouping; this is only how it sounds.
 *
 * It is a preference rather than a constant because recognition accuracy is
 * language-specific: speaking Hindi at an en-US recogniser produces nonsense,
 * and no prompt can rescue a transcript that was wrong before the model saw
 * it. The LIVE engine needs none of this — it detects the language itself.
 */
export const SPEECH_LANGS: { code: string; label: string }[] = [
  { code: "en-US", label: "English" },
  { code: "en-IN", label: "English (India)" },
  { code: "hi-IN", label: "हिन्दी" },
  { code: "ta-IN", label: "தமிழ்" },
  { code: "te-IN", label: "తెలుగు" },
  { code: "mr-IN", label: "मराठी" },
  { code: "bn-IN", label: "বাংলা" },
  { code: "es-ES", label: "Español" },
  { code: "fr-FR", label: "Français" },
  { code: "de-DE", label: "Deutsch" },
];

const LANG_KEY = "knot:speech-lang";
const LANG_EVENT = "knot:speech-lang-changed";

export function readSpeechLang(): string {
  if (typeof window === "undefined") return "en-US";
  return localStorage.getItem(LANG_KEY) ?? "en-US";
}

export function setSpeechLang(code: string): void {
  localStorage.setItem(LANG_KEY, code);
  window.dispatchEvent(new Event(LANG_EVENT));
}

function subscribeLang(onChange: () => void) {
  window.addEventListener(LANG_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(LANG_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Subscribed, so the overlay's picker takes effect on the next utterance. */
export function useSpeechLang(): string {
  return useSyncExternalStore(subscribeLang, readSpeechLang, () => "en-US");
}


/** Capability checks don't change, so there is nothing to subscribe to. */
const subscribeNever = () => () => {};

const speechSupported = () =>
  typeof window !== "undefined" &&
  Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition);


export function useSpeechInput(handlers: {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onSilence?: () => void;
}) {
  // Browser capability, not React state: it never changes, so subscribing is a
  // no-op and the server snapshot is simply "no". Reading it in an effect and
  // calling setState meant an extra render on every mount to learn something
  // that was already knowable.
  const supported = useSyncExternalStore(subscribeNever, speechSupported, () => false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<Recognition | null>(null);
  const finalRef = useRef("");
  const handlersRef = useRef(handlers);

  // Assigned in an effect rather than during render. Recognition callbacks all
  // fire asynchronously, so they never observe the pre-commit value.
  useEffect(() => {
    handlersRef.current = handlers;
  });

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor || recognitionRef.current) return;
    const recognition = new Ctor();
    recognition.lang = readSpeechLang();
    recognition.continuous = false;
    recognition.interimResults = true;
    finalRef.current = "";

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalRef.current += result[0].transcript;
        else interim += result[0].transcript;
      }
      handlersRef.current.onInterim(finalRef.current + interim);
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
      const text = finalRef.current.trim();
      if (text) handlersRef.current.onFinal(text);
      else handlersRef.current.onSilence?.();
    };
    recognition.onerror = () => {
      recognitionRef.current = null;
      setListening(false);
    };

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }, []);

  return { supported, listening, start, stop };
}

export function speak(text: string, onEnd?: () => void) {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    onEnd?.();
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = readSpeechLang();
  utterance.rate = 1.05;

  if (onEnd) {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(watchdog);
      clearInterval(keepAlive);
      onEnd();
    };
    // Chrome quietly drops onend sometimes, and pauses long utterances;
    // a duration-estimate watchdog + resume keep-alive make the loop unstickable.
    const estimatedMs = Math.min(30000, 350 * text.split(/\s+/).length + 3000);
    const watchdog = setTimeout(finish, estimatedMs);
    const keepAlive = setInterval(() => window.speechSynthesis.resume(), 5000);
    utterance.onend = finish;
    utterance.onerror = finish;
  }
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
}

/** Must be called from a user-gesture handler: unlocks TTS on mobile browsers
 * so later programmatic speak() calls aren't silently dropped. */
export function unlockSpeech() {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const blank = new SpeechSynthesisUtterance(" ");
  blank.volume = 0;
  window.speechSynthesis.speak(blank);
}
