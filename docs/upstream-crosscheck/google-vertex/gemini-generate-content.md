<!--
Source: https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/send-chat-requests
Fetched: 2026-05-02 (summary)
Also see: https://ai.google.dev/api/generate-content (AI Studio / public API, functionally identical)
-->

# GCP Vertex AI — Gemini generateContent

## Endpoint

```
POST https://{LOCATION}-aiplatform.googleapis.com/v1/projects/{PROJECT_ID}/locations/{LOCATION}/publishers/google/models/{MODEL_ID}:generateContent
POST https://{LOCATION}-aiplatform.googleapis.com/v1/projects/{PROJECT_ID}/locations/{LOCATION}/publishers/google/models/{MODEL_ID}:streamGenerateContent
```

Note: the model is encoded in the **URL path**, NOT in the request body.

## Request schema

```json
{
  "contents": [
    { "role": "user", "parts": [{ "text": "Hello" }] }
  ],
  "generationConfig": {
    "maxOutputTokens": 1024,
    "temperature": 0.7,
    "topP": 0.9,
    "stopSequences": ["END"],
    "thinkingConfig": {
      "thinkingBudget": 2048,
      "includeThoughts": true,
      "thinkingLevel": "ENABLED"
    }
  },
  "tools": [
    {
      "functionDeclarations": [
        { "name": "my_fn", "description": "...", "parameters": {} }
      ]
    }
  ]
}
```

## ThinkingConfig fields (spec anchor: https://ai.google.dev/api/generate-content#ThinkingConfig)

| Field | Type | Description |
|-------|------|-------------|
| `thinkingBudget` | integer | Max number of thinking tokens |
| `includeThoughts` | boolean | Whether to include thinking tokens in response |
| `thinkingLevel` | enum | `ENABLED`, `DISABLED`, `DYNAMIC`, `THINKING_LEVEL_UNSPECIFIED` |

**Important**: `thinkingConfig` is a nested field inside `generationConfig`,
NOT a top-level request field.

## Role mapping

| Gemini role | OpenAI-compat role |
|-------------|--------------------|
| `user`      | `user`             |
| `model`     | `assistant`        |

## Cross-check relevance for F-001 and F-002

- F-001: Gateway reads `body.reasoningConfig` (non-standard) and wrong field names.
  Official path is `body.generationConfig.thinkingConfig` with fields
  `thinkingBudget`, `includeThoughts`, `thinkingLevel`.
- F-002: Stop sequences are in `generationConfig.stopSequences` (already handled
  correctly by the gateway — see REPORT §P-009).

Source: https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/send-chat-requests
Source: https://ai.google.dev/api/generate-content#ThinkingConfig
