import { Client } from "@langchain/langgraph-sdk";

/**
 * Graph id registered in `aegra.json`. Aegra (our self-hosted, LangGraph
 * Platform-compatible agent server) exposes one assistant per graph, and the
 * graph name doubles as the assistant id used when starting a run.
 */
export const ASSISTANT_ID = "qa-agent";
export const TITLE_ASSISTANT_ID = "title-agent";

/**
 * Base URL of the agents server. The browser always talks to the current origin
 * under the `/agents` prefix; Vite (in dev) and any edge proxy forward that to
 * the agents container. We build an absolute URL from `window.location.origin`
 * because the SDK resolves request paths with `new URL(path, apiUrl)`, which
 * requires an absolute base.
 */
const AGENTS_API_URL = `${window.location.origin}/agents`;

/**
 * Shared LangGraph SDK client pointed at Aegra. Aegra runs with `AUTH_TYPE=noop`
 * so no API key is sent.
 */
export const agentsClient = new Client({ apiUrl: AGENTS_API_URL });
