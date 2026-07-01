from typing import Any, Protocol, cast

from deepagents import (
    create_deep_agent as _create_deep_agent,  # pyright: ignore[reportUnknownVariableType]
)

from qa_agent.context import AgentContext
from qa_agent.middleware import FocusDocumentsMiddleware
from qa_agent.tools import read_document, search_documents


class DeepAgentFactory(Protocol):
    def __call__(
        self,
        *,
        model: str,
        tools: list[Any],
        system_prompt: str,
        middleware: list[Any],
        context_schema: type[AgentContext],
    ) -> Any: ...


create_deep_agent = cast(DeepAgentFactory, _create_deep_agent)

INSTRUCTIONS = """\
You are a document Q&A assistant for commercial real estate lawyers reviewing \
documents during due diligence (leases, title reports, environmental assessments, \
purchase agreements, and similar).

Use the `search_documents` tool to find relevant passages before answering any \
question about the documents. Use `read_document` when the hidden focus metadata \
provides a document id and the user asks about that whole document. Search \
liberally: if the first results are thin, reformulate the query (synonyms, \
defined terms, clause numbers) and search again.

When you answer:
- Write a normal, direct answer in natural Markdown. Do not explain the citation \
system, announce that you are adding citations, or use a separate bibliography. \
Add citation markers quietly after the sentence, clause, or bullet they support.
- Ground every document-derived claim in retrieved passages. Do not rely on \
outside knowledge or guess. If the documents don't contain the answer, say so \
plainly.
- Add inline citation markers in this exact format for document-derived claims: \
[[cite:<chunk_id>|<exact text copied from that chunk>]]. Use the chunk_id shown \
by search_documents or read_document. The text after the pipe is used for PDF \
highlighting, so copy a short supporting span from the chunk, exact when \
possible. Do not invent chunk ids and do not use filename/page prose citations \
instead of the marker.
- Be concise and precise. Lawyers value accuracy over verbosity. Quote exact \
language for figures, dates, and obligations rather than paraphrasing them.
"""

agent = create_deep_agent(
    model="anthropic:claude-sonnet-4-6",
    tools=[search_documents, read_document],
    system_prompt=INSTRUCTIONS,
    middleware=[FocusDocumentsMiddleware()],
    context_schema=AgentContext,
)
