class Job:
    id: str

class Queue:
    def __init__(self, name: str, *, connection: object | None = ...) -> None: ...
    def enqueue(
        self,
        f: str,
        *args: object,
        job_timeout: int | None = ...,
        **kwargs: object,
    ) -> Job: ...
