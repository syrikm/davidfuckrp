<!--
Source: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModel.html
Fetched: 2026-05-02 (summary — not directly used by current gateway)
Architecture note: This gateway reaches Bedrock via OpenRouter provider slug
"amazon-bedrock", not via direct InvokeModel calls.  This file is kept for
reference and future direct-integration work.
-->

# AWS Bedrock — InvokeModel (Legacy)

## Endpoint

```
POST https://bedrock-runtime.<region>.amazonaws.com/model/<modelId>/invoke
```

Authentication: AWS SigV4 (`X-Amz-Security-Token`, `Authorization`).

## Key request fields (Claude on Bedrock)

When the body is forwarded to an Anthropic Claude model on Bedrock, the
request body must conform to the Anthropic Messages API shape with one addition:
`anthropic_version` must be set (typically `"bedrock-2023-05-31"`).

```json
{
  "anthropic_version": "bedrock-2023-05-31",
  "max_tokens": 1024,
  "messages": [{ "role": "user", "content": "Hello" }]
}
```

## Model ID format

Bedrock model IDs use a dot-separated vendor prefix and may carry a version
suffix:

```
anthropic.claude-sonnet-4-5-20250929-v1:0
amazon.nova-premier-v1:0
```

When routing via OpenRouter, the gateway strips the vendor prefix and the
version suffix, converting to the OpenRouter canonical dot form:

```
anthropic.claude-sonnet-4-5-20250929-v1:0  →  claude-sonnet-4.5
```

## Streaming

Bedrock streaming uses AWS event-stream binary encoding (not SSE).
This is handled by OpenRouter's `amazon-bedrock` sub-channel, not by this
gateway.

## Cross-check relevance

This gateway sets `provider.only = ["amazon-bedrock"]` and
`provider.allow_fallbacks = false` in the OpenRouter body when the model
prefix is `bedrock/…`.  OpenRouter then translates to InvokeModel internally.

Source: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModel.html#API_runtime_InvokeModel
