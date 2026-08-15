"use client";

import VoiceMode from "@/components/VoiceMode";
import { useVoice } from "@/lib/voice-context";

/** Mounts the voice overlay for whichever page is on screen.
 *
 * Separate from AppShell only so AppShell does not have to be a consumer of
 * the context it provides — a provider cannot use its own hook. */
export default function VoiceOverlay() {
  const { open, closeVoice, utter } = useVoice();
  if (!open) return null;
  return <VoiceMode onUtterance={utter} onClose={closeVoice} />;
}
