<!--
Source: https://docs.aws.amazon.com/bedrock/latest/userguide/model-ids.html
Fetched: 2026-05-02 (summary)
-->

# AWS Bedrock — Model IDs

## Format

```
<vendor>.<model-name>-<version>:<resource-version>
```

Examples:
- `anthropic.claude-sonnet-4-5-20250929-v1:0`
- `anthropic.claude-3-7-sonnet-20250219-v1:0`
- `amazon.nova-premier-v1:0`
- `meta.llama3-3-70b-instruct-v1:0`

## Conversion to OpenRouter slug

The gateway's `canonicalizeLogicalModel` function strips the date suffix
(`-YYYYMMDD`), version suffix (`-vN:N`), and vendor prefix, then converts
dashes to dots for the 4.x Claude naming convention:

```
anthropic.claude-sonnet-4-5-20250929-v1:0
  → (strip vendor prefix)  claude-sonnet-4-5-20250929-v1:0
  → (strip date)           claude-sonnet-4-5-v1:0  → claude-sonnet-4-5
  → (strip version)        claude-sonnet-4-5
  → (dash→dot 4.x)         claude-sonnet-4.5
```

This is the correct OpenRouter canonical ID.

Source: https://docs.aws.amazon.com/bedrock/latest/userguide/model-ids.html
