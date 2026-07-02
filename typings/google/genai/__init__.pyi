from types import TracebackType

from . import types as types

class _Models:
    def embed_content(
        self,
        *,
        model: str,
        contents: object,
        config: types.EmbedContentConfig | None = ...,
    ) -> types.EmbedContentResponse: ...


class Client:
    models: _Models

    def __init__(self) -> None: ...
    def __enter__(self) -> Client: ...
    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None: ...

