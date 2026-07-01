from sqlalchemy.types import TypeEngine

class Vector(TypeEngine[list[float]]):
    def __init__(self, dim: int | None = ...) -> None: ...
