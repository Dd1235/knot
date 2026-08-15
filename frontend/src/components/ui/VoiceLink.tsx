"use client";

import { useVoice } from "@/lib/voice-context";
import { unlockSpeech, useSpeechInput } from "@/lib/speech";

/** "Talk to Knot", as the second thing a keyboard reaches.
 *
 * Visually hidden until focused, exactly like the skip link beside it, so it
 * costs a sighted user nothing and costs a blind user one keystroke. This is
 * the answer to "how does a button help someone who cannot see it": from a
 * cold page load, on any page, Tab Tab Enter starts talking.
 */
export default function VoiceLink() {
  const { openVoice } = useVoice();
  const mic = useSpeechInput({ onInterim: () => {}, onFinal: () => {} });

  if (!mic.supported) return null;

  return (
    <button
      type="button"
      onClick={() => {
        // Must run inside the gesture, or mobile browsers drop the first
        // spoken reply on the floor.
        unlockSpeech();
        openVoice();
      }}
      className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-ink-on-brand shadow-lg"
    >
      Talk to Knot
    </button>
  );
}
