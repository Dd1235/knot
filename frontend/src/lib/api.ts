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

/** Session lives in an httpOnly cookie; every request must send credentials.
 * A bearer token fallback covers clients where third-party cookies are blocked. */
function authHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem("ledger:token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function onUnauthorized(): never {
  if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
    window.location.href = "/login";
  }
  throw new Error("401: sign in required");
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-User": getUserHandle(),
      ...authHeaders(),
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401) onUnauthorized();
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
  callbacks: StreamCallbacks
): Promise<void> {
  const res = await fetch(`${API_BASE}/chat/stream`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-User": getUserHandle(),
      ...authHeaders(),
    },
    body: JSON.stringify({ message, session_id: sessionId }),
  });
  if (res.status === 401) onUnauthorized();
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
      else if (event.type === "done") {
        callbacks.onDone(event as ChatResponse);
        // Terminate immediately — don't depend on the server closing the pipe.
        try {
          await reader.cancel();
        } catch {
          /* already closed */
        }
        return;
      }
    }
  }
}

export interface AccountBalance {
  name: string;
  type: string;
  balance: string;
}

export const getBalances = () =>
  api<{ people: PersonBalance[]; accounts: AccountBalance[]; ledger_sum: string }>(
    "/ledger/balances",
  );

/** Records that a person paid you back. Omit amount to clear everything. */
export const settleUp = (person: string, amount?: string) =>
  api<{ id: string; description: string }>("/ledger/settle", {
    method: "POST",
    body: JSON.stringify({ person, amount: amount ?? null }),
  });

export interface LedgerTransaction {
  id: string;
  occurred_at: string;
  description: string;
  category: string;
  source: string;
  amount: string;
  voided: boolean;
}

export const listTransactions = (limit = 50) =>
  api<{ transactions: LedgerTransaction[] }>(`/ledger/transactions?limit=${limit}`);

export const voidTransaction = (id: string, reason: string) =>
  api<{ id: string }>(`/ledger/transactions/${id}/void`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });

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

export interface CategorySpend {
  category: string;
  grp: string;
  amount: string;
}

export interface GroupSpend {
  grp: string;
  amount: string;
  pct_of_spend: number;
}

export interface DailyFlow {
  date: string;
  spend: string;
  income: string;
}

export interface NetWorth {
  assets: string;
  liabilities: string;
  net_worth: string;
}

export interface AnalyticsSummary {
  window_days: number;
  total_spend: string;
  total_income: string;
  net_cashflow: string;
  net_worth: NetWorth;
  by_category: CategorySpend[];
  by_group: GroupSpend[];
  daily: DailyFlow[];
}

export const getAnalytics = (days: number) =>
  api<AnalyticsSummary>(`/analytics/summary?days=${days}`);

export interface RecurringCommitment {
  id: string;
  name: string;
  amount: string;
  cadence: string;
  due_day: number;
  category: string;
  direction: string;
  active: boolean;
  last_posted_period: string | null;
}

export const getRecurring = () =>
  api<{ commitments: RecurringCommitment[]; monthly_total: string }>("/ledger/recurring");

// Fetches the CSV with auth headers (never window.open — headers would be lost)
// and hands it to the browser as a download.
export async function downloadCsv(days = 90): Promise<void> {
  const res = await fetch(`${API_BASE}/analytics/export.csv?days=${days}`, {
    credentials: "include",
    headers: {
      "X-User": getUserHandle(),
      ...authHeaders(),
    },
  });
  if (res.status === 401) onUnauthorized();
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ledger-export-${days}d.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const inr = (value: string | number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(Number(value));

export interface Account {
  email: string;
  token: string;
}

async function authRequest(path: string, email: string, password: string): Promise<Account> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.detail ?? `request failed (${res.status})`);
  if (body.token && typeof window !== "undefined") {
    localStorage.setItem("ledger:token", body.token);
  }
  return body as Account;
}

export const signup = (email: string, password: string) =>
  authRequest("/auth/signup", email, password);
export const login = (email: string, password: string) =>
  authRequest("/auth/login", email, password);

export async function logout(): Promise<void> {
  await fetch(`${API_BASE}/auth/logout`, { method: "POST", credentials: "include" });
  if (typeof window !== "undefined") {
    localStorage.removeItem("ledger:token");
    localStorage.removeItem("ledger:session");
  }
}

export const getMe = () => api<{ handle: string }>("/auth/me");

export interface Insight {
  kind: string;
  text: string;
  generated_at: string;
}

export const generateInsights = (days: number, refresh = false) =>
  api<{ insights: Insight[]; cached: boolean }>(
    `/insights/generate?days=${days}&refresh=${refresh}`,
    { method: "POST" },
  );

/** Headers the Realtime client needs (it calls the API outside api()). */
export function authHeadersForRealtime(): Record<string, string> {
  return { "X-User": getUserHandle(), ...authHeaders() };
}
