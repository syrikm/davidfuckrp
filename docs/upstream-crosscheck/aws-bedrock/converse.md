<!--
Source: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html
Fetched: 2026-05-02 (summary)
Architecture note: reached via OpenRouter provider slug "amazon-bedrock".
-->

# AWS Bedrock — Converse API

## Endpoint

```
POST https://bedrock-runtime.<region>.amazonaws.com/model/<modelId>/converse
```

Streaming variant:
```
POST https://bedrock-runtime.<region>.amazonaws.com/model/<modelId>/converse-stream
```

## Request schema (key fields)

```json
{
  "modelId": "anthropic.claude-sonnet-4-5-20250929-v1:0",
  "messages": [
    { "role": "user", "content": [{ "text": "Hello" }] }
  ],
  "system": [{ "text": "You are helpful." }],
  "inferenceConfig": {
    "maxTokens": 1024,
    "temperature": 0.7,
    "topP": 0.9,
    "stopSequences": ["END"]
  },
  "toolConfig": {
    "tools": [{ "toolSpec": { "name": "my_tool", "inputSchema": { "json": {} } } }]
  }
}
```

## Notable differences from OpenAI/Anthropic format

- Content blocks are arrays of typed objects (`{ "text": "…" }`, `{ "image": … }`)
  rather than a single string.
- Tool results use `toolResult` blocks, not `tool_result`.
- Inference parameters are nested under `inferenceConfig` (not top-level).
- Stop sequences are `inferenceConfig.stopSequences`, not `stop`.

## Cross-check relevance

OpenRouter translates from OpenAI-compat format to Converse internally when
the `amazon-bedrock` provider is selected.  This gateway is not responsible
for the Converse wire format.

Source: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html#API_runtime_Converse
