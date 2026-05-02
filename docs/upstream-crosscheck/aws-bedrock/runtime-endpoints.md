<!--
Source: https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-endpoints.html
Fetched: 2026-05-02 (summary)
-->

# AWS Bedrock — Runtime Endpoints

## Endpoint pattern

```
https://bedrock-runtime.<region>.amazonaws.com
```

Supported regions (selected):
- `us-east-1`, `us-west-2`
- `eu-west-1`, `eu-central-1`
- `ap-northeast-1`, `ap-southeast-2`

## Cross-check relevance

This gateway does not need to select a Bedrock endpoint directly.
OpenRouter's `amazon-bedrock` sub-channel manages region selection based on
provider preferences (e.g. `provider.only = ["amazon-bedrock/us-east-1"]` for
region pinning via the full slug).

Per OR-2 (OpenRouter provider routing docs): a base slug like
`amazon-bedrock` matches all regional sub-endpoints; a full slug like
`amazon-bedrock/us-east-1` pins to the specific region.

Source: https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-endpoints.html
