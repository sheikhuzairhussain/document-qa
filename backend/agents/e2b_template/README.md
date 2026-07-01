# QA Agent E2B Sandbox Template

This template bakes the QA agent skills into the sandbox image at build time.
Runtime middleware must not copy skills into E2B sandboxes.

## Build

Set `E2B_API_KEY` and build the template:

```bash
uv run python backend/agents/e2b_template/build.py
```

The template alias is fixed in code as `qa-agent-sandbox`.

## Validate

After building, create a sandbox from the template and run:

```bash
qa-agent-sandbox-smoke
```
