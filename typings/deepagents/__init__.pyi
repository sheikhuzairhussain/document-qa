from collections.abc import Sequence

def create_deep_agent(
    model: object = ...,
    tools: Sequence[object] | None = ...,
    *,
    system_prompt: object = ...,
    middleware: Sequence[object] = ...,
    context_schema: type[object] | None = ...,
    backend: object | None = ...,
    skills: list[str] | None = ...,
    **kwargs: object,
) -> object: ...
