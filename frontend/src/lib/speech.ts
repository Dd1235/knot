"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

export function useSpeechInput(handlers: {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onSilence?: () => void;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<Recognition | null>(null);
  const finalRef = useRef("");
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    setSupported(
      typeof window !== "undefined" &&
        Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition)
    );
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor || recognitionRef.current) return;
    const recognition = new Ctor();
    recognition.lang = "en-IN";
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
  utterance.lang = "en-IN";
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
