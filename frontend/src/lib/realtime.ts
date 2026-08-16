"use client";

/** OpenAI Realtime over WebRTC.
 *
 * Audio goes browser <-> OpenAI directly, so it never transits our server and
 * turn-taking stays sub-second. Tool calls come back over the data channel and
 * we relay them to our API, which runs them on the same registry the text
 * agent uses — voice gets no business logic of its own. */

import { cinchKnot, WRITE_TOOLS } from "./knot";
import { turnContext } from "./api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const SDP_URL = "https://api.openai.com/v1/realtime/calls";

export type RealtimeState = "connecting" | "listening" | "thinking" | "speaking";

/** An event off the OpenAI data channel. The wire format is large and evolving,
 * so this stays open — but `unknown` rather than `any`, which forces each
 * access below to say what it expects instead of silently trusting it. */
type RealtimeEvent = {
  type?: string;
  transcript?: string;
  error?: { message?: string };
  response?: { output?: unknown[] };
  [key: string]: unknown;
};

export interface RealtimeHandlers {
  onState: (state: RealtimeState) => void;
  onUserTranscript: (text: string) => void;
  onAssistantTranscript: (text: string) => void;
  onTool: (name: string) => void;
  onError: (message: string) => void;
}

interface PendingCall {
  call_id: string;
  name: string;
  arguments: string;
}

/** Narrows an item off `response.output`, which carries several shapes. A cast
 * would have compiled just as well and told us nothing when the wire format
 * changes. */
function isFunctionCall(item: unknown): item is PendingCall {
  if (typeof item !== "object" || item === null) return false;
  const candidate = item as Partial<PendingCall> & { type?: unknown };
  return (
    candidate.type === "function_call" &&
    typeof candidate.call_id === "string" &&
    typeof candidate.name === "string"
  );
}

export class RealtimeSession {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private stream: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private sessionId = "";
  private lastUser = "";
  private lastAssistant = "";
  /** Set by stop(). Checked after every await in start().
   *
   * Without it, stop() could only tear down fields start() had already
   * assigned — and start() awaits five times before assigning any of them. A
   * stop() landing mid-connect was a silent no-op, and the session then
   * finished anyway: a live microphone and an autoplaying <audio> element that
   * nothing held a reference to and no code could reach. Two of those is two
   * agents talking over each other. */
  private stopped = false;

  constructor(private handlers: RealtimeHandlers) {}

  /** True if stop() ran while we were awaiting; tears down and bails. */
  private aborted(): boolean {
    if (!this.stopped) return false;
    this.teardown();
    return true;
  }

  async start(
    authHeaders: Record<string, string>,
    resumeSessionId?: string | null,
  ): Promise<void> {
    this.handlers.onState("connecting");

    const res = await fetch(`${API_BASE}/voice/session`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", ...authHeaders },
      // Continue the conversation already in progress rather than starting a
      // parallel one the history page would show as a separate session.
      body: JSON.stringify({ session_id: resumeSessionId ?? null, ...turnContext() }),
    });
    if (this.aborted()) return;
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? "session failed");
    const { client_secret, session_id, model } = await res.json();
    if (this.aborted()) return;
    this.sessionId = session_id;

    const pc = new RTCPeerConnection();
    this.pc = pc;

    // Remote audio out.
    this.audio = document.createElement("audio");
    this.audio.autoplay = true;
    pc.ontrack = (e) => {
      if (this.audio && !this.stopped) this.audio.srcObject = e.streams[0];
    };

    // Mic in. getUserMedia resolves even if the user has already left, so the
    // very next thing we do is check whether they have.
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (this.aborted()) return;
    this.stream.getTracks().forEach((track) => pc.addTrack(track, this.stream!));

    const dc = pc.createDataChannel("oai-events");
    this.dc = dc;
    dc.addEventListener("message", (e) => {
      if (!this.stopped) this.onEvent(JSON.parse(e.data), authHeaders);
    });
    dc.addEventListener("open", () => {
      if (!this.stopped) this.handlers.onState("listening");
    });

    const offer = await pc.createOffer();
    if (this.aborted()) return;
    await pc.setLocalDescription(offer);
    if (this.aborted()) return;

    const sdpRes = await fetch(`${SDP_URL}?model=${encodeURIComponent(model)}`, {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${client_secret}`,
        "Content-Type": "application/sdp",
      },
    });
    if (this.aborted()) return;
    if (!sdpRes.ok) throw new Error("could not connect to the voice service");
    const answer = await sdpRes.text();
    if (this.aborted()) return;
    await pc.setRemoteDescription({ type: "answer", sdp: answer });
    if (this.aborted()) return;
  }

  private send(event: unknown) {
    if (this.dc?.readyState === "open") this.dc.send(JSON.stringify(event));
  }

  private async onEvent(event: RealtimeEvent, authHeaders: Record<string, string>) {
    switch (event.type) {
      case "input_audio_buffer.speech_started":
        this.handlers.onState("listening");
        break;
      case "conversation.item.input_audio_transcription.completed":
        this.lastUser = event.transcript ?? "";
        this.handlers.onUserTranscript(this.lastUser);
        this.handlers.onState("thinking");
        break;
      case "response.output_audio.delta":
        this.handlers.onState("speaking");
        break;
      case "response.output_audio_transcript.done":
        this.lastAssistant = event.transcript ?? "";
        this.handlers.onAssistantTranscript(this.lastAssistant);
        break;
      case "response.done":
        await this.handleToolCalls(event, authHeaders);
        this.persistTurn(authHeaders);
        this.handlers.onState("listening");
        break;
      case "error":
        this.handlers.onError(event.error?.message ?? "voice error");
        break;
    }
  }

  private async handleToolCalls(
    event: RealtimeEvent,
    authHeaders: Record<string, string>,
  ) {
    const calls = (event.response?.output ?? []).filter(isFunctionCall);
    if (calls.length === 0) return;

    this.handlers.onState("thinking");
    for (const call of calls) {
      this.handlers.onTool(call.name);
      let output = '{"error":"tool failed"}';
      try {
        const res = await fetch(`${API_BASE}/voice/tool`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({
            session_id: this.sessionId,
            call_id: call.call_id,
            name: call.name,
            arguments: call.arguments,
            // The transcript of the turn that asked for this call. It is what
            // gets stored as the transaction's raw_input, so a spoken entry
            // carries the same receipt a typed one does.
            user_message: this.lastUser,
            // Per call, not per session: the session is minted once but the
            // user can change page or currency mid-conversation.
            ...turnContext(),
          }),
        });
        const body = await res.json();
        output = JSON.stringify(body.result ?? body);
        // Voice bookings tie the knot too — visible the moment the overlay
        // closes, and the trigger stays "a write committed", same as text.
        if (res.ok && WRITE_TOOLS.has(call.name)) cinchKnot();
      } catch {
        /* keep the error payload so the model can explain itself */
      }
      this.send({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: call.call_id, output },
      });
    }
    this.send({ type: "response.create" });
  }

  private persistTurn(authHeaders: Record<string, string>) {
    if (!this.lastUser && !this.lastAssistant) return;
    const body = {
      session_id: this.sessionId,
      user_text: this.lastUser,
      assistant_text: this.lastAssistant,
    };
    this.lastUser = "";
    this.lastAssistant = "";
    void fetch(`${API_BASE}/voice/turn`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(body),
    }).catch(() => {});
  }

  /** Cut the model off mid-sentence — the barge-in path.
   *
   * response.cancel alone stops generation but leaves whatever is already in
   * the WebRTC jitter buffer playing, so the voice talks on for a beat after
   * the tap. Clearing the output buffer is what makes barge-in feel immediate. */
  interrupt() {
    this.send({ type: "response.cancel" });
    this.send({ type: "output_audio_buffer.clear" });
    this.handlers.onState("listening");
  }

  private teardown() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.dc?.close();
    this.pc?.close();
    if (this.audio) {
      this.audio.pause();
      this.audio.srcObject = null;
      this.audio.remove();
    }
    this.pc = null;
    this.dc = null;
    this.stream = null;
    this.audio = null;
  }

  /** Idempotent, and safe to call while start() is still in flight. */
  stop() {
    this.stopped = true;
    this.teardown();
  }
}
