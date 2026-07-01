from collections.abc import Sequence
from typing import Literal, overload

type TextBlock = tuple[float, float, float, float, str, int, int]


class Page:
    def get_text(
        self,
        option: Literal["blocks"],
        *,
        sort: bool = ...,
    ) -> Sequence[TextBlock]: ...


class Document:
    def __len__(self) -> int: ...
    def __getitem__(self, page_index: int) -> Page: ...
    def close(self) -> None: ...
    def insert_pdf(
        self,
        doc: Document,
        *,
        from_page: int,
        to_page: int,
    ) -> None: ...
    def tobytes(self) -> bytes: ...


@overload
def open() -> Document: ...


@overload
def open(filename: str) -> Document: ...
