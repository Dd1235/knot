"use client";

/** OpenAI Realtime over WebRTC.
 *
 * Audio goes browser <-> OpenAI directly, so it never transits our server and
 * turn-taking stays sub-second. Tool calls come back over the data channel and
 * we relay them to our API, which runs them on the same registry the text
 * agent uses — voice gets no business logic of its own. */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const SDP_URL = "https://api.openai.com/v1/realtime/calls";

export type RealtimeState = "connecting" | "listening" | "thinking" | "speaking";

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

export class RealtimeSession {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private stream: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private sessionId = "";
  private lastUser = "";
  private lastAssistant = "";

  constructor(private handlers: RealtimeHandlers) {}

  async start(authHeaders: Record<string, string>): Promise<void> {
    this.handlers.onState("connecting");

    const res = await fetch(`${API_BASE}/voice/session`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", ...authHeaders },
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? "session failed");
    const { client_secret, session_id, model } = await res.json();
    this.sessionId = session_id;

    const pc = new RTCPeerConnection();
    this.pc = pc;

    // Remote audio out.
    this.audio = document.createElement("audio");
    this.audio.autoplay = true;
    pc.ontrack = (e) => {
      if (this.audio) this.audio.srcObject = e.streams[0];
    };

    // Mic in.
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.stream.getTracks().forEach((track) => pc.addTrack(track, this.stream!));

    const dc = pc.createDataChannel("oai-events");
    this.dc = dc;
    dc.addEventListener("message", (e) => this.onEvent(JSON.parse(e.data), authHeaders));
    dc.addEventListener("open", () => this.handlers.onState("listening"));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const sdpRes = await fetch(`${SDP_URL}?model=${encodeURIComponent(model)}`, {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${client_secret}`,
        "Content-Type": "application/sdp",
      },
    });
    if (!sdpRes.ok) throw new Error("could not connect to the voice service");
    await pc.setRemoteDescription({ type: "answer", sdp: await sdpRes.text() });
  }

  private send(event: unknown) {
    if (this.dc?.readyState === "open") this.dc.send(JSON.stringify(event));
  }

  private async onEvent(event: Record<string, any>, authHeaders: Record<string, string>) {
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
    event: Record<string, any>,
    authHeaders: Record<string, string>,
  ) {
    const calls: PendingCall[] = (event.response?.output ?? []).filter(
      (item: Record<string, unknown>) => item.type === "function_call",
    );
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
          }),
        });
        const body = await res.json();
        output = JSON.stringify(body.result ?? body);
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

  /** Cut the model off mid-sentence — the barge-in path. */
  interrupt() {
    this.send({ type: "response.cancel" });
    this.handlers.onState("listening");
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.dc?.close();
    this.pc?.close();
    if (this.audio) this.audio.srcObject = null;
    this.pc = null;
    this.dc = null;
    this.stream = null;
  }
}
