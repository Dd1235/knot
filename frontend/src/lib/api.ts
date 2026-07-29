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

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-User": getUserHandle(),
      ...(init?.headers ?? {}),
    },
  });
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
