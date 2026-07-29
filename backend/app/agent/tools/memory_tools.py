"""Memory tools: the agent's explicit read/write access to long-term memory."""

from app.agent.registry import ToolContext, register
from app.llm.embeddings import embed_one
from app.memory import episodic, procedural, semantic


@register(
    "remember_fact",
    "Store a durable fact about the user's financial life: a person, merchant, "
    "habit, preference, or commitment. Use when the user states something worth "
    "remembering for months ('my landlord is Sharma uncle', 'I get salary on the 1st').",
    {
        "type": "object",
        "properties": {
            "kind": {
                "type": "string",
                "enum": ["person", "merchant", "habit", "preference", "commitment"],
            },
            "subject": {"type": "string", "description": "Short name, e.g. 'Priya'"},
            "fact": {"type": "string", "description": "One-sentence fact"},
        },
        "required": ["kind", "fact"],
    },
)
async def remember_fact(ctx: ToolContext, args: dict) -> dict:
    return await semantic.remember(
        ctx.user_handle, args["kind"], args.get("subject", ""), args["fact"]
    )


@register(
    "learn_rule",
    "Save a standing rule for how to handle future money statements: splits "
    "('rent is always 3-way with Arun and Priya'), aliases ('chai wala means the "
    "tea stall near office'), or categorization. The rule is auto-applied when "
    "similar messages arrive later.",
    {
        "type": "object",
        "properties": {
            "kind": {
                "type": "string",
                "enum": ["alias", "split", "categorization", "phrasing", "other"],
            },
            "trigger": {
                "type": "string",
                "description": "A REALISTIC example of a future user message this "
                "rule applies to, e.g. 'paid rent 12000' — a message, NOT a "
                "restatement of the rule",
            },
            "instruction": {
                "type": "string",
                "description": "The standing instruction to apply, fully explicit",
            },
        },
        "required": ["kind", "trigger", "instruction"],
    },
)
async def learn_rule(ctx: ToolContext, args: dict) -> dict:
    return await procedural.learn(
        ctx.user_handle, args["kind"], args["trigger"], args["instruction"]
    )


@register(
    "search_memory",
    "Search long-term memory by meaning: remembered facts and past events. Use "
    "for questions that balances alone can't answer ('do I usually...', 'when "
    "did I last...', 'what do I know about X').",
    {
        "type": "object",
        "properties": {
            "query": {"type": "string"},
            "kinds": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional fact kinds filter",
            },
        },
        "required": ["query"],
    },
)
async def search_memory(ctx: ToolContext, args: dict) -> dict:
    query_vector = await embed_one(args["query"])
    return {
        "facts": await semantic.search(
            ctx.user_handle, query_vector, k=5, kinds=args.get("kinds")
        ),
        "events": await episodic.search(ctx.user_handle, query_vector, k=3),
    }
