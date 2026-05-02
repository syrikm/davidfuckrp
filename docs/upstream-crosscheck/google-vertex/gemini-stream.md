<!--
Source: https://ai.google.dev/api/generate-content#method:-models.streamgeneratecontent
Fetched: 2026-05-02 (summary)
-->

# Gemini — streamGenerateContent SSE Format

## Endpoint

```
POST .../models/{model}:streamGenerateContent?alt=sse
```

## SSE event format

Each event is a standard SSE `data:` line containing a JSON
`GenerateContentResponse` object:

```
data: {"candidates":[{"content":{"parts":[{"text":"Hello"}],"role":"model"},"finishReason":"STOP","index":0}],"usageMetadata":{"promptTokenCount":4,"candidatesTokenCount":6,"totalTokenCount":10}}
```

There is **no** `data: [DONE]` terminator (unlike OpenAI SSE).

## FinishReason values (spec anchor: https://ai.google.dev/api/generate-content#FinishReason)

| Value | Meaning |
|-------|---------|
| `STOP` | Natural stop |
| `MAX_TOKENS` | Max output tokens reached |
| `SAFETY` | Safety filter |
| `RECITATION` | Recitation filter |
| `OTHER` | Unknown |

## Thinking tokens in stream

When `generationConfig.thinkingConfig.includeThoughts = true`, thought
tokens appear in `parts` with `thought: true`:

```json
{ "parts": [
    { "thought": true, "text": "Let me think…" },
    { "text": "Final answer." }
  ], "role": "model" }
```

## Cross-check relevance

The `/v1beta/models/:modelAction` endpoint in the gateway forwards Gemini
requests verbatim to the sub-node (proxy.ts:4678) without normalization.
The sub-node (Friend Proxy → OpenRouter) handles the Gemini SSE format
internally.  This is correct by design — see REPORT §N-A-004.

Source: https://ai.google.dev/api/generate-content#method:-models.streamgeneratecontent
