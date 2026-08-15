"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { sendChat } from "./api";

/** Voice, available from every page.
 *
 * It used to live inside the chat page and borrow that page's `send()`, which
 * is why the only way to talk to Knot was to be looking at the chat. Now the
 * shell owns the overlay and the button, so you can ask about whatever is on
 * screen — or about nothing at all, with the screen off.
 *
 * The chat page still overrides the handler with its own streaming `send`, so
 * a spoken turn there appears in the conversation exactly as a typed one does.
 * Everywhere else the default handler posts a plain non-streaming turn: the
 * reply is spoken, and it lands in the same session, so it is waiting in the
 * transcript when the user next opens chat.
 */
type Utterance = (text: string) => Promise<string | null>;

interface VoiceApi {
  open: boolean;
  openVoice: () => void;
  closeVoice: () => void;
  /** Pages with a richer turn handler register it; returns an unregister fn. */
  setHandler: (fn: Utterance) => () => void;
  utter: Utterance;
}

const VoiceContext = createContext<VoiceApi | null>(null);

async function defaultUtterance(text: string): Promise<string | null> {
  const sessionId = localStorage.getItem("ledger:session");
  const res = await sendChat(text, sessionId);
  // Keep the spoken turn in the same conversation the chat page will resume.
  if (res.session_id) localStorage.setItem("ledger:session", res.session_id);
  return res.reply;
}

export function VoiceProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const handlerRef = useRef<Utterance | null>(null);

  const setHandler = useCallback((fn: Utterance) => {
    handlerRef.current = fn;
    return () => {
      if (handlerRef.current === fn) handlerRef.current = null;
    };
  }, []);

  const utter = useCallback<Utterance>(
    (text) => (handlerRef.current ?? defaultUtterance)(text),
    [],
  );

  const value = useMemo<VoiceApi>(
    () => ({
      open,
      openVoice: () => setOpen(true),
      closeVoice: () => setOpen(false),
      setHandler,
      utter,
    }),
    [open, setHandler, utter],
  );

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function useVoice(): VoiceApi {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error("useVoice must be used inside VoiceProvider");
  return ctx;
}
