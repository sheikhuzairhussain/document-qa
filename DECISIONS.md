# Part 2: Decisions

The highest-value insight from the beta data was that trust, not raw feature
coverage, is the main product risk. In `usage_events.csv`, 49 of 302 assistant
responses had zero cited sources. Explicit thumbs-down responses were much more
likely to be uncited: 8 of 25 thumbs-down responses had zero citations, compared
with only 2 of 77 thumbs-up responses. The interview notes say the same thing in
plain language: lawyers loved cited answers, but fabricated or uncited answers
were described as "terrifying" and worse than being slow. For a legal due
diligence product, that makes citation coverage and uncertainty handling the
highest-leverage improvement.

I addressed that by building the inline citation system rather than adding an
opaque confidence signal. The model sees chunk IDs, cites document-backed claims
inline, and the UI turns those markers into citation chips that open the PDF on
the cited page with the exact text span used for the claim highlighted.
End-of-turn source cards show which files were retrieved, so users can inspect
the evidence directly. If a claim does not have a citation, the user can ask the
agent for the source instead of being asked to trust a generic confidence score.

With more time, I would turn this into full observability and evaluation
coverage: track citation coverage per answer, add LangSmith traces for
retrieval/tool decisions, and build an eval set from the beta documents to
measure answer correctness and citation highlightability. I would also add a
product-level feedback loop that lets users flag bad answers and turns those
cases into regression fixtures.

## Feature Priority

1. **Built: Inline citations, source cards, and PDF highlighting**
   This was the clear top priority. Uncited answers were 49 of 302 responses
   (16.2%), but they accounted for 8 of 25 thumbs-down responses (32.0%) versus
   only 2 of 77 thumbs-up responses (2.6%). Thumbs-up responses averaged 3.31
   cited sources, while thumbs-down responses averaged 2.28. The interview data
   matched this pattern: trust, fabrication, missing citations, or confidence
   came up in 4 of 9 quotes. The app now renders citation chips, end-of-turn
   sources, and PDF highlighting that opens the cited page and marks the exact
   text used to support the claim.
2. **Built: Persistent document library and focus documents**
   Re-uploading was the strongest workflow inefficiency in the event data. There
   were 63 upload events but only 15 unique document hashes; 48 uploads were
   repeats, so 76.2% of uploads were duplicate work. Fourteen of the 15 documents
   were uploaded more than once, with the top document uploaded 12 times. The app
   now separates reusable library documents from focus documents for the current
   chat.
3. **Built: Lightweight ingestion and page-level retrieval**
   Document handling is central to the product loop: 61 of 115 conversations
   (53.0%) included an upload, and the beta produced 63 uploads across 102
   sessions. Because uploads happen so often, the upload path should feel
   instant and should not block on extraction or embedding. The app now stores
   uploads immediately, processes them in the worker, and creates citeable
   page-level chunks for retrieval.
4. **Built: PDF find and viewer improvements**
   Viewer navigation was a smaller but concrete pain point: 1 of 9 interview
   quotes explicitly asked for `ctrl+F`/find within the document viewer. It also
   supports the higher-priority citation workflow because users need to inspect
   highlighted evidence in context. The PDF dialog now supports search, zoom,
   pan, page navigation, and cited-page opening.
5. **Built: Generated report/download workflow**
   Export showed up in 1 of 9 interview quotes. That made it valuable, but less
   urgent than trust and repeated-document handling. I still built it because it
   compounds the value of cited answers by turning verified chat output into a
   reusable client-facing artifact. The sandbox/download flow now supports
   generated files with preview and download UI.
6. **Skipped: Side-by-side document comparison UI**
   Comparison also appeared in 1 of 9 interview quotes. It is useful, but the
   agent can already search/read across available documents, and the event data
   showed a much stronger trust gap than a comparison-specific usage gap. A
   dedicated comparison surface would be useful later, but it is less urgent than
   making document-backed answers verifiable.
7. **Skipped: Manual annotations and team markup**
   Annotation came up in 1 of 9 interview quotes. It is a credible collaboration
   workflow, but it does not address the biggest quantitative signal: uncited
   answers were more than 12 times as common in thumbs-down responses (32.0%) as
   in thumbs-up responses (2.6%).
8. **Skipped: Opaque model confidence score**
   One interview quote explicitly asked for confidence, and trust-related issues
   appeared in 4 of 9 quotes overall. I skipped a numeric confidence score
   because the event data pointed to verifiable evidence, not abstract certainty:
   responses with more citations were much more likely to receive positive
   feedback. Inline citations are more explainable and better aligned with legal
   review behavior because they let users verify the underlying evidence
   directly.
