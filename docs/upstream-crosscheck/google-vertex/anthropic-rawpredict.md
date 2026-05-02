<!--
Source: https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude
Fetched: 2026-05-02 (summary)
Architecture note: reached via OpenRouter provider slug "google-vertex".
-->

# GCP Vertex AI — Anthropic Claude (rawPredict / streamRawPredict)

## Endpoint

```
POST https://{LOCATION}-aiplatform.googleapis.com/v1/projects/{PROJECT_ID}/locations/{LOCATION}/publishers/anthropic/models/{MODEL_ID}:rawPredict
POST https://{LOCATION}-aiplatform.googleapis.com/v1/projects/{PROJECT_ID}/locations/{LOCATION}/publishers/anthropic/models/{MODEL_ID}:streamRawPredict
```

## Key differences from direct Anthropic API

Per `docs/vendors/anthropic/04-vertex.md`:

1. `model` is NOT in the request body — it is in the URL path.
2. `anthropic_version` is in the **request body** (not as an HTTP header):
   `"anthropic_version": "vertex-2023-10-16"`
3. All other Messages API fields apply identically.

## Model ID format on Vertex

```
claude-sonnet-4-5@20250929
claude-haiku-4-5@20251001
```

The `@YYYYMMDD` suffix is a Vertex-specific pinned version.  The gateway's
`canonicalizeLogicalModel` strips the `@YYYYMMDD` portion and normalizes
to OpenRouter canonical form `claude-sonnet-4.5`.

## Cross-check relevance

OpenRouter's `google-vertex` provider handles the rawPredict wire format
internally.  The gateway only needs to emit the correct OpenRouter provider
lock and OpenRouter-canonical model ID.

Source: https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude
