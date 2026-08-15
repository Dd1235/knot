"use client";

import Button from "./Button";
import Icon from "./Icon";
import { Mic } from "lucide-react";
import { unlockSpeech, useSpeechInput } from "@/lib/speech";
import { useVoice } from "@/lib/voice-context";

/** The star of the product, finally dressed like it.
 *
 * This was a 12px lowercase pill sitting fourth from the right, on one page,
 * weighing the same as the theme toggle — indistinguishable from the chrome
 * around it, and invisible to anyone who had not already been told voice
 * existed. It is now the single gold-filled action in the header, on every
 * page, with a mic and an accessible name.
 *
 * `unlockSpeech()` on click is load-bearing on mobile: browsers drop
 * programmatic speech synthesis unless it was preceded by a user gesture, so
 * the first spoken reply is silent without it.
 */
export default function VoiceButton() {
  const { openVoice } = useVoice();
  const mic = useSpeechInput({ onInterim: () => {}, onFinal: () => {} });

  // No microphone, no button — rather than a control that fails on tap.
  if (!mic.supported) return null;

  return (
    <Button
      variant="primary"
      onClick={() => {
        unlockSpeech();
        openVoice();
      }}
      aria-label="Talk to Knot"
      title="Talk to Knot — ask about anything on screen, hands free"
    >
      <span className="inline-flex items-center gap-1.5">
        <Icon as={Mic} size={14} />
        voice
      </span>
    </Button>
  );
}
