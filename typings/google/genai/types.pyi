from collections.abc import Sequence

class EmbedContentConfig:
    def __init__(self, *, output_dimensionality: int | None = ...) -> None: ...


class ContentEmbedding:
    values: Sequence[float] | None

    def __init__(self, *, values: Sequence[float] | None = ...) -> None: ...


class EmbedContentResponse:
    embeddings: Sequence[ContentEmbedding] | None

    def __init__(
        self,
        *,
        embeddings: Sequence[ContentEmbedding] | None = ...,
    ) -> None: ...


class Part:
    @classmethod
    def from_bytes(cls, *, data: bytes, mime_type: str) -> Part: ...
