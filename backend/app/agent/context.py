"""Per-turn context assembly: what the agent remembers before it answers.

One embedding of the user's message drives all three memory lookups. Every
injected item is recorded in a trace that is persisted with the turn — the
Memory Inspector's "why did the agent say this?" view reads that trace.
"""

from dataclasses import dataclass, field

from app.llm.embeddings import embed_one
from app.memory import episodic, procedural, semantic

FACT_SCORE_FLOOR = 0.12
QUESTION_HINTS = ("did ", "when ", "how much", "what ", "who ", "do i", "have i", "?")


@dataclass
class AssembledContext:
    suffix: str = ""
    trace: dict = field(default_factory=dict)
    rule_ids: list[str] = field(default_factory=list)


async def assemble(user_handle: str, user_message: str) -> AssembledContext:
    query_vector = await embed_one(user_message)

    rules = await procedural.match(user_handle, query_vector, k=3)
    facts = [
        f
        for f in await semantic.search(user_handle, query_vector, k=5)
        if f["score"] >= FACT_SCORE_FLOOR
    ]
    episodes = []
    if any(hint in user_message.lower() for hint in QUESTION_HINTS):
        episodes = await episodic.search(user_handle, query_vector, k=3)

    sections: list[str] = []
    if rules:
        lines = "\n".join(f"- {r['rule']['instruction']}" for r in rules)
        sections.append(f"## Standing rules the user taught you — apply them\n{lines}")
    if facts:
        lines = "\n".join(f"- [{f['kind']}] {f['fact']}" for f in facts)
        sections.append(f"## Things you remember about this user\n{lines}")
    if episodes:
        lines = "\n".join(f"- [{e['occurred_at'][:10]}] {e['summary']}" for e in episodes)
        sections.append(f"## Possibly relevant past events\n{lines}")

    return AssembledContext(
        suffix="\n\n".join(sections),
        trace={
            "rules": [
                {k: r[k] for k in ("id", "kind", "trigger_text", "rule", "distance")}
                for r in rules
            ],
            "facts": [
                {k: f[k] for k in ("id", "kind", "fact", "score", "similarity")}
                for f in facts
            ],
            "episodes": [
                {k: e[k] for k in ("id", "kind", "summary", "similarity")} for e in episodes
            ],
        },
        rule_ids=[r["id"] for r in rules],
    )
