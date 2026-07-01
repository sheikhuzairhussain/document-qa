from e2b import Sandbox

class E2BSandbox:
    id: str

    def __init__(
        self,
        *,
        sandbox: Sandbox,
        workdir: str = ...,
        timeout: int = ...,
    ) -> None: ...
