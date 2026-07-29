const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export function getUserHandle(): string {
  if (typeof window === "undefined") return "demo";
  let user = localStorage.getItem("ledger:user");
  if (!user) {
    user = `user-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem("ledger:user", user);
  }
  return user;
}

function authHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const passcode = localStorage.getItem("ledger:passcode");
  return passcode ? { Authorization: `Bearer ${passcode}` } : {};
}

async function api<T>(path: string, init?: RequestInit, retried = false): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-User": getUserHandle(),
      ...authHeaders(),
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401 && !retried && typeof window !== "undefined") {
    const passcode = window.prompt("Enter the Ledger passcode:");
    if (passcode) {
      localStorage.setItem("ledger:passcode", passcode);
      return api<T>(path, init, true);
    }
  }
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

export interface ToolEvent {
  tool: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
}

export interface ContextTrace {
  rules?: { trigger_text: string; rule: { instruction: string }; distance: number }[];
  facts?: { kind: string; fact: string; score: number }[];
  episodes?: { kind: string; summary: string; similarity: number }[];
}

export interface ChatResponse {
  session_id: string;
  reply: string;
  events: ToolEvent[];
  context_trace: ContextTrace;
}

export interface PersonBalance {
  display_name: string;
  balance: string;
}

export const sendChat = (message: string, sessionId: string | null) =>
  api<ChatResponse>("/chat", {
    method: "POST",
    body: JSON.stringify({ message, session_id: sessionId }),
  });

export interface StreamCallbacks {
  onDelta: (text: string) => void;
  onTool: (tool: string) => void;
  onDone: (done: ChatResponse) => void;
}

export async function sendChatStream(
  message: string,
  sessionId: string | null,
  callbacks: StreamCallbacks,
  retried = false
): Promise<void> {
  const res = await fetch(`${API_BASE}/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-User": getUserHandle(),
      ...authHeaders(),
    },
    body: JSON.stringify({ message, session_id: sessionId }),
  });
  if (res.status === 401 && !retried && typeof window !== "undefined") {
    const passcode = window.prompt("Enter the Ledger passcode:");
    if (passcode) {
      localStorage.setItem("ledger:passcode", passcode);
      return sendChatStream(message, sessionId, callbacks, true);
    }
  }
  if (!res.ok || !res.body) throw new Error(`${res.status}: ${await res.text()}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.trim();
      if (!line.startsWith("data: ")) continue;
      const event = JSON.parse(line.slice(6));
      if (event.type === "delta") callbacks.onDelta(event.text);
      else if (event.type === "tool") callbacks.onTool(event.tool);
      else if (event.type === "done") callbacks.onDone(event as ChatResponse);
    }
  }
}

export const getBalances = () =>
  api<{ people: PersonBalance[]; ledger_sum: string }>("/ledger/balances");

export const getMemoryOverview = () =>
  api<{
    semantic_facts: number;
    episodic_events: number;
    procedural_rules: number;
    sessions: number;
  }>("/memory/overview");

export interface SemanticFact {
  id: string;
  kind: string;
  subject: string;
  fact: string;
  confidence: number;
  evidence_count: number;
  last_reinforced_at: string;
  superseded_by: string | null;
}

export interface EpisodicEvent {
  id: string;
  kind: string;
  summary: string;
  occurred_at: string;
}

export interface ProceduralRule {
  id: string;
  kind: string;
  trigger_text: string;
  rule: { instruction: string };
  usage_count: number;
  source: string;
  active: boolean;
}

export interface AgentAction {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  result_summary: string;
  error: string | null;
  latency_ms: number;
  created_at: string;
}

export const getSemantic = () => api<{ facts: SemanticFact[] }>("/memory/semantic");
export const getEpisodic = () => api<{ events: EpisodicEvent[] }>("/memory/episodic");
export const getProcedural = () => api<{ rules: ProceduralRule[] }>("/memory/procedural");
export const getActions = () => api<{ actions: AgentAction[] }>("/memory/actions");

export const inr = (value: string | number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(Number(value));
