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
  const path = typeof window === "undefined" ? "" : window.location.pathname;
  if (path && path !== "/" && !path.startsWith("/login")) {
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

export const repayDebt = (person: string, amount?: string) =>
  api<{ id: string; description: string }>("/ledger/repay", {
    method: "POST",
    body: JSON.stringify({ person, amount: amount ?? null }),
  });

export interface LedgerTransaction {
  id: string;
  occurred_at: string;
  description: string;
  category: string;
  grp: string;
  source: string;
  amount: string;
  direction: string;
  people: string | null;
  raw_input: string;
  voided: boolean;
  /** One short note written by the memory pass, on a minority of rows. */
  annotation: string | null;
  annotation_kind: string | null;
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
  /** Money into a SIP/FD/stocks. Kept out of `spend` on purpose — it changed
   * shape, it did not leave. */
  invested: string;
  income: string;
  txns: number;
}

export interface NetWorth {
  assets: string;
  liabilities: string;
  net_worth: string;
}

export interface AnalyticsSummary {
  window_days: number;
  total_spend: string;
  total_invested: string;
  total_income: string;
  net_cashflow: string;
  net_worth: NetWorth;
  by_category: CategorySpend[];
  by_group: GroupSpend[];
  daily: DailyFlow[];
}

export const getAnalytics = (days: number, offsetDays = 0) =>
  api<AnalyticsSummary>(
    `/analytics/summary?days=${days}&offset_days=${offsetDays}`,
  );

export interface MerchantFrequency {
  merchant: string;
  times: number;
  amount: string;
  grp: string;
}

export interface Rhythm {
  window_days: number;
  transactions: number;
  active_days: number;
  per_active_day: number;
  no_spend_days: number;
  top_merchants: MerchantFrequency[];
  by_weekday: { dow: number; days_seen: number; typical: string }[];
}

export const getRhythm = (days: number) =>
  api<Rhythm>(`/analytics/rhythm?days=${days}`);

export interface DueItem {
  name: string;
  amount: string;
  category: string;
  due_on: string;
  in_days: number;
}

export interface SafeToSpend {
  liquid: string;
  claimed: string;
  available: string;
  next_income: DueItem | null;
  days_until_income: number | null;
  per_day: string | null;
  upcoming: DueItem[];
}

export const getSafeToSpend = () => api<SafeToSpend>("/analytics/safe-to-spend");

export interface CashFloat {
  withdrawn: string;
  accounted: string;
  unaccounted: string;
  last_withdrawal: string | null;
}

export const getCashFloat = () => api<CashFloat>("/analytics/cash");

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

export interface StackFacts {
  version: string;
  vector_indexes: { table: string; index: string; columns: string[] }[];
  ttl: { table: string; expire_after: string }[];
  memory_counts: Record<string, number>;
  legs: number;
  ledger_sum: string;
}

export const getStack = () => api<StackFacts>("/architecture/stack");

export interface SessionSummary {
  id: string;
  started_at: string;
  last_active_at: string;
  channel: string;
  turns: number;
  title: string;
}

export const getSessions = (limit = 30) =>
  api<{ sessions: SessionSummary[] }>(`/memory/sessions?limit=${limit}`);

export interface TraceTurn {
  seq: number;
  role: string;
  content: string;
  tool_calls: ToolEvent[] | null;
  context_trace: ContextTrace | null;
  created_at: string;
}

export const getSessionTrace = (id: string) =>
  api<{ turns: TraceTurn[] }>(`/memory/sessions/${id}/trace`);

export interface Loan {
  id: string;
  name: string;
  lender: string;
  principal: string;
  annual_rate: string;
  tenure_months: number;
  emi: string;
  due_day: number;
  account_name: string;
  active: boolean;
  outstanding: string;
  months_remaining: number | null;
  /** How the NEXT payment splits. Most of an early EMI is interest. */
  next_principal: string;
  next_interest: string;
  principal_share: number;
}

export const getLoans = () =>
  api<{ loans: Loan[]; total_outstanding: string; monthly_emi: string }>(
    "/ledger/loans",
  );

export interface Holding {
  symbol: string;
  display_name: string;
  kind: string;
  /** Null when bought as a rupee amount with no units stated. */
  units: string | null;
  cost_basis: string;
  avg_cost: string | null;
  last_price: string | null;
  last_price_at: string | null;
  market_value: string | null;
  unrealised: string | null;
  /** False when no price has been stated; the row is carried at cost. */
  priced: boolean;
}

export interface Portfolio {
  holdings: Holding[];
  cost_basis: string;
  market_value: string;
  unrealised: string;
  realised_gain: string;
  /** Money in invest: accounts with no units behind it — bought by category. */
  unitemised: string;
  all_priced: boolean;
}

export const getHoldings = () => api<Portfolio>("/ledger/holdings");

export interface LimitStatus {
  scope: string;
  target: string;
  limit: string;
  spent: string;
  left: string;
  share: number;
  /** (spent/limit) / (elapsed/month). 1.0 lands exactly on the limit. */
  pace: number;
  projected: string;
  verdict: "fine" | "ahead" | "urgent" | "over";
}

export const getLimits = () =>
  api<{ limits: LimitStatus[]; day: number; days_in_month: number; days_left: number }>(
    "/analytics/limits",
  );

export const getUpcoming = (horizonDays = 45) =>
  api<{
    outgoing: DueItem[];
    incoming: DueItem[];
    next_income: DueItem | null;
    claimed_before_income: string;
  }>(`/analytics/upcoming?horizon_days=${horizonDays}`);
