from collections.abc import Sequence

def create_agent(
    model: object,
    tools: Sequence[object] | None = ...,
    *,
    system_prompt: object = ...,
    middleware: Sequence[object] = ...,
    **kwargs: object,
) -> object: ...
