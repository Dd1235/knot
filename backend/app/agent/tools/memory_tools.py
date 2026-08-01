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


@register(
    "correct_memory",
    "Fix something you remembered wrongly. Use when the user contradicts a "
    "fact you stated or acted on — 'no, Priya is my flatmate not my sister', "
    "'it's Kiran who owes me, not Meera'. Pass the wrong belief and the right "
    "one. The old fact is superseded, not deleted, so the correction is "
    "visible. Do NOT use this to add a new fact; use remember_fact.",
    {
        "type": "object",
        "properties": {
            "wrong": {
                "type": "string",
                "description": "The mistaken belief, phrased as you held it",
            },
            "right": {"type": "string", "description": "What is actually true"},
            "kind": {
                "type": "string",
                "enum": ["person", "merchant", "habit", "preference", "commitment"],
            },
            "subject": {"type": "string", "description": "Who or what this is about"},
        },
        "required": ["wrong", "right"],
    },
)
async def correct_memory(ctx: ToolContext, args: dict) -> dict:
    result = await semantic.correct(
        ctx.user_handle,
        args["wrong"],
        args["right"],
        kind=args.get("kind") or "",
        subject=args.get("subject") or "",
    )
    if not result["found"]:
        # Nothing close enough to correct — record the truth rather than
        # silently doing nothing.
        return await semantic.remember(
            ctx.user_handle,
            args.get("kind") or "preference",
            args.get("subject") or "",
            args["right"],
        )
    return result


@register(
    "forget_memory",
    "Stop remembering something. Use when the user asks you to drop a fact "
    "outright — 'forget that', 'stop remembering where I work'. For a rule "
    "they taught you ('stop splitting rent three ways') use forget_rule.",
    {
        "type": "object",
        "properties": {
            "description": {
                "type": "string",
                "description": "The fact to retire, in the user's words",
            },
            "kind": {
                "type": "string",
                "enum": ["person", "merchant", "habit", "preference", "commitment"],
            },
        },
        "required": ["description"],
    },
)
async def forget_memory(ctx: ToolContext, args: dict) -> dict:
    result = await semantic.forget(
        ctx.user_handle, args["description"], kind=args.get("kind") or ""
    )
    if not result["found"]:
        return {"error": "nothing close enough to that to forget"}
    return result


@register(
    "forget_rule",
    "Cancel a standing rule the user taught you — 'stop splitting rent three "
    "ways', 'don't round up amounts any more'. The rule stops being applied.",
    {
        "type": "object",
        "properties": {
            "description": {"type": "string", "description": "The rule, in the user's words"}
        },
        "required": ["description"],
    },
)
async def forget_rule(ctx: ToolContext, args: dict) -> dict:
    result = await procedural.cancel(ctx.user_handle, args["description"])
    if not result["found"]:
        return {"error": "no active rule matches that"}
    return result
