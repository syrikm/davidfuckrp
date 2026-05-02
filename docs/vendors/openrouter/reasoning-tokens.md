<!-- source: https://openrouter.ai/docs/use-cases/reasoning-tokens
     fetched: 2026-05-02T12:55:46.400Z -->

For AI agents: a documentation index is available at the root level at /llms.txt and /llms-full.txt. Append /llms.txt to any URL for a page-level index, or .md for the markdown version of any page.

For models that support it, the OpenRouter API can return **Reasoning Tokens**, also known as thinking tokens. OpenRouter normalizes the different ways of customizing the amount of reasoning tokens that the model will use, providing a unified interface across different providers.

Reasoning tokens provide a transparent look into the reasoning steps taken by a model. Reasoning tokens are considered output tokens and charged accordingly.

Reasoning tokens are included in the response by default if the model decides to output them. Reasoning tokens will appear in the `reasoning` field of each message, unless you decide to exclude them.

##### Some reasoning models do not return their reasoning tokens

While most models and providers make reasoning tokens available in the
response, some (like the OpenAI o-series) do not.

## Controlling Reasoning Tokens

You can control reasoning tokens in your requests using the `reasoning` parameter:

```
{
  "model": "your-model",
  "messages": [],
  "reasoning": {
    // One of the following (not both):
    "effort": "high", // Can be "xhigh", "high", "medium", "low", "minimal" or "none" (OpenAI-style)
    "max_tokens": 2000, // Specific token limit (Anthropic-style)

    // Optional: Default is false. All models support this.
    "exclude": false, // Set to true to exclude reasoning tokens from response

    // Or enable reasoning with the default parameters:
    "enabled": true // Default: inferred from `effort` or `max_tokens`
  }
}
```

The `reasoning` config object consolidates settings for controlling reasoning strength across different models. See the Note for each option below to see which models are supported and how other models will behave.

### Max Tokens for Reasoning

##### Supported models

Currently supported by:

- Gemini thinking models
- Anthropic reasoning models (by using the `reasoning.max_tokens`
parameter)

- Some Alibaba Qwen thinking models (mapped to `thinking_budget`)

For Alibaba, support varies by model — please check the individual model descriptions to confirm
whether `reasoning.max_tokens` (via `thinking_budget`) is available.

For models that support reasoning token allocation, you can control it like this:

- `"max_tokens": 2000` \- Directly specifies the maximum number of tokens to use for reasoning

For models that only support `reasoning.effort` (see below), the `max_tokens` value will be used to determine the effort level.

### Reasoning Effort Level

##### Supported models

Currently supported by OpenAI reasoning models (o1 series, o3 series, GPT-5 series) and Grok models

- `"effort": "xhigh"` \- Allocates the largest portion of tokens for reasoning (approximately 95% of max\_tokens)
- `"effort": "high"` \- Allocates a large portion of tokens for reasoning (approximately 80% of max\_tokens)
- `"effort": "medium"` \- Allocates a moderate portion of tokens (approximately 50% of max\_tokens)
- `"effort": "low"` \- Allocates a smaller portion of tokens (approximately 20% of max\_tokens)
- `"effort": "minimal"` \- Allocates an even smaller portion of tokens (approximately 10% of max\_tokens)
- `"effort": "none"` \- Disables reasoning entirely

For models that only support `reasoning.max_tokens`, the effort level will be set based on the percentages above.

### Excluding Reasoning Tokens

If you want the model to use reasoning internally but not include it in the response:

- `"exclude": true` \- The model will still use reasoning, but it won’t be returned in the response

Reasoning tokens will appear in the `reasoning` field of each message.

### Enable Reasoning with Default Config

To enable reasoning with the default parameters:

- `"enabled": true` \- Enables reasoning at the “medium” effort level with no exclusions.

### Examples

#### Basic Usage with Reasoning Tokens

TypeScript SDKPython (OpenAI SDK)TypeScript (OpenAI SDK)

```
import { OpenRouter } from '@openrouter/sdk';

const openRouter = new OpenRouter({
  apiKey: '<OPENROUTER_API_KEY>',
});

const response = await openRouter.chat.send({
  model: 'openai/o3-mini',
  messages: [\
    {\
      role: 'user',\
      content: "How would you build the world's tallest skyscraper?",\
    },\
  ],
  reasoning: {
    effort: 'high',
  },
  stream: false,
});

console.log('REASONING:', response.choices[0].message.reasoning);
console.log('CONTENT:', response.choices[0].message.content);
```

#### Using Max Tokens for Reasoning

For models that support direct token allocation (like Anthropic models), you can specify the exact number of tokens to use for reasoning:

PythonTypeScript

```
from openai import OpenAI

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key="<OPENROUTER_API_KEY>",
)

response = client.chat.completions.create(
    model="anthropic/claude-sonnet-4.5",
    messages=[\
        {"role": "user", "content": "What's the most efficient algorithm for sorting a large dataset?"}\
    ],
    extra_body={
        "reasoning": {
            "max_tokens": 2000
        }
    },
)

msg = response.choices[0].message
print(getattr(msg, "reasoning", None))
print(getattr(msg, "content", None))
```

#### Excluding Reasoning Tokens from Response

If you want the model to use reasoning internally but not include it in the response:

PythonTypeScript

```
from openai import OpenAI

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key="<OPENROUTER_API_KEY>",
)

response = client.chat.completions.create(
    model="deepseek/deepseek-r1",
    messages=[\
        {"role": "user", "content": "Explain quantum computing in simple terms."}\
    ],
    extra_body={
        "reasoning": {
            "effort": "high",
            "exclude": True
        }
    },
)

msg = response.choices[0].message
print(getattr(msg, "content", None))
```

#### Advanced Usage: Reasoning Chain-of-Thought

This example shows how to use reasoning tokens in a more complex workflow. It injects one model’s reasoning into another model to improve its response quality:

PythonTypeScript

```
from openai import OpenAI

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key="<OPENROUTER_API_KEY>",
)

question = "Which is bigger: 9.11 or 9.9?"

def do_req(model: str, content: str, reasoning_config: dict | None = None):
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": content}],
        "stop": "</think>",
    }
    if reasoning_config:
        payload.update(reasoning_config)
    return client.chat.completions.create(**payload)

# Get reasoning from a capable model
content = f"{question} Please think this through, but don't output an answer"
reasoning_response = do_req("deepseek/deepseek-r1", content)
reasoning = getattr(reasoning_response.choices[0].message, "reasoning", "")

# Let's test! Here's the naive response:
simple_response = do_req("openai/gpt-4o-mini", question)
print(getattr(simple_response.choices[0].message, "content", None))

# Here's the response with the reasoning token injected:
content = f"{question}. Here is some context to help you: {reasoning}"
smart_response = do_req("openai/gpt-4o-mini", content)
print(getattr(smart_response.choices[0].message, "content", None))
```

## Preserving Reasoning

To preserve reasoning context across multiple turns, you can pass it back to the API in one of two ways:

1. **`message.reasoning`** (string): Pass the plaintext reasoning as a string field on the assistant message
2. **`message.reasoning_details`** (array): Pass the full reasoning\_details block

Use `reasoning_details` when working with models that return special reasoning types (such as encrypted or summarized) - this preserves the full structure needed for those models.

For models that only return raw reasoning strings, you can use the simpler `reasoning` field. You can also use `reasoning_content` as an alias - it functions identically to `reasoning`.

##### Model Support

Preserving reasoning is currently supported by these proprietary models:

- All OpenAI reasoning models (o1 series, o3 series, GPT-5 series and newer)
- All Anthropic reasoning models (Claude 3.7 series and newer)
- All Gemini Reasoning models
- All xAI reasoning models

And these open source models:

- Alibaba: Qwen3.5 and newer
- MiniMax: MiniMax M2 and newer
- MoonShot: Kimi K2 Thinking and newer
- NVIDIA: Nemotron 3 Nano and newer
- Prime Intellect: INTELLECT-3
- Xiaomi: MiMo-V2-Flash and newer
- Z.ai: GLM 4.5 and newer

Note: standard interleaved thinking only. The [preserved thinking](https://docs.z.ai/guides/capabilities/thinking-mode#preserved-thinking) feature for Z.ai models is currently not supported.

The `reasoning_details` functionality works identically across all supported reasoning models. You can easily switch between OpenAI reasoning models (like `openai/gpt-5.2`) and Anthropic reasoning models (like `anthropic/claude-sonnet-4.5`) without changing your code structure.

Preserving reasoning blocks is useful specifically for tool calling. When models like Claude invoke tools, it is pausing its construction of a response to await external information. When tool results are returned, the model will continue building that existing response. This necessitates preserving reasoning blocks during tool use, for a couple of reasons:

**Reasoning continuity**: The reasoning blocks capture the model’s step-by-step reasoning that led to tool requests. When you post tool results, including the original reasoning ensures the model can continue its reasoning from where it left off.

**Context maintenance**: While tool results appear as user messages in the API structure, they’re part of a continuous reasoning flow. Preserving reasoning blocks maintains this conceptual flow across multiple API calls.

##### Important for Reasoning Models

When providing reasoning\_details blocks, the entire sequence of consecutive
reasoning blocks must match the outputs generated by the model during the
original request; you cannot rearrange or modify the sequence of these blocks.

### Example: Preserving Reasoning Blocks with OpenRouter and Claude

PythonTypeScript

```
from openai import OpenAI

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key="<OPENROUTER_API_KEY>",
)

# Define tools once and reuse
tools = [{\
    "type": "function",\
    "function": {\
        "name": "get_weather",\
        "description": "Get current weather",\
        "parameters": {\
            "type": "object",\
            "properties": {\
                "location": {"type": "string"}\
            },\
            "required": ["location"]\
        }\
    }\
}]

# First API call with tools
# Note: You can use 'openai/gpt-5.2' instead of 'anthropic/claude-sonnet-4.5' - they're completely interchangeable
response = client.chat.completions.create(
    model="anthropic/claude-sonnet-4.5",
    messages=[\
        {"role": "user", "content": "What's the weather like in Boston? Then recommend what to wear."}\
    ],
    tools=tools,
    extra_body={"reasoning": {"max_tokens": 2000}}
)

# Extract the assistant message with reasoning_details
message = response.choices[0].message

# Preserve the complete reasoning_details when passing back
messages = [\
    {"role": "user", "content": "What's the weather like in Boston? Then recommend what to wear."},\
    {\
        "role": "assistant",\
        "content": message.content,\
        "tool_calls": message.tool_calls,\
        "reasoning_details": message.reasoning_details  # Pass back unmodified\
    },\
    {\
        "role": "tool",\
        "tool_call_id": message.tool_calls[0].id,\
        "content": '{"temperature": 45, "condition": "rainy", "humidity": 85}'\
    }\
]

# Second API call - Claude continues reasoning from where it left off
response2 = client.chat.completions.create(
    model="anthropic/claude-sonnet-4.5",
    messages=messages,  # Includes preserved thinking blocks
    tools=tools
)
```

For more detailed information about thinking encryption, redacted blocks, and advanced use cases, see [Anthropic’s documentation on extended thinking](https://docs.anthropic.com/en/docs/build-with-claude/tool-use#extended-thinking).

For more information about OpenAI reasoning models, see [OpenAI’s reasoning documentation](https://platform.openai.com/docs/guides/reasoning#keeping-reasoning-items-in-context).

## Reasoning Details API Shape

When reasoning models generate responses, the reasoning information is structured in a standardized format through the `reasoning_details` array. This section documents the API response structure for reasoning details in both streaming and non-streaming responses.

### reasoning\_details Array Structure

The `reasoning_details` field contains an array of reasoning detail objects. Each object in the array represents a specific piece of reasoning information and follows one of three possible types. The location of this array differs between streaming and non-streaming responses.

- **Non-streaming responses**: `reasoning_details` appears in `choices[].message.reasoning_details`
- **Streaming responses**: `reasoning_details` appears in `choices[].delta.reasoning_details` for each chunk

#### Common Fields

All reasoning detail objects share these common fields:

- `id` (string \| null): Unique identifier for the reasoning detail
- `format`(string): The format of the reasoning detail, with possible values:

  - `"unknown"` \- Format is not specified
  - `"openai-responses-v1"` \- OpenAI responses format version 1
  - `"azure-openai-responses-v1"` \- Azure OpenAI responses format version 1
  - `"xai-responses-v1"` \- xAI responses format version 1
  - `"anthropic-claude-v1"` \- Anthropic Claude format version 1 (default)
  - `"google-gemini-v1"` \- Google Gemini format version 1
- `index` (number, optional): Sequential index of the reasoning detail

#### Reasoning Detail Types

**1\. Summary Type (`reasoning.summary`)**

Contains a high-level summary of the reasoning process:

```
{
  "type": "reasoning.summary",
  "summary": "The model analyzed the problem by first identifying key constraints, then evaluating possible solutions...",
  "id": "reasoning-summary-1",
  "format": "anthropic-claude-v1",
  "index": 0
}
```

**2\. Encrypted Type (`reasoning.encrypted`)**

Contains encrypted reasoning data that may be redacted or protected:

```
{
  "type": "reasoning.encrypted",
  "data": "eyJlbmNyeXB0ZWQiOiJ0cnVlIiwiY29udGVudCI6IltSRURBQ1RFRF0ifQ==",
  "id": "reasoning-encrypted-1",
  "format": "anthropic-claude-v1",
  "index": 1
}
```

**3\. Text Type (`reasoning.text`)**

Contains raw text reasoning with optional signature verification:

```
{
  "type": "reasoning.text",
  "text": "Let me think through this step by step:\n1. First, I need to understand the user's question...",
  "signature": "sha256:abc123def456...",
  "id": "reasoning-text-1",
  "format": "anthropic-claude-v1",
  "index": 2
}
```

### Response Examples

#### Non-Streaming Response

In non-streaming responses, `reasoning_details` appears in the message:

```
{
  "choices": [\
    {\
      "message": {\
        "role": "assistant",\
        "content": "Based on my analysis, I recommend the following approach...",\
        "reasoning_details": [\
          {\
            "type": "reasoning.summary",\
            "summary": "Analyzed the problem by breaking it into components",\
            "id": "reasoning-summary-1",\
            "format": "anthropic-claude-v1",\
            "index": 0\
          },\
          {\
            "type": "reasoning.text",\
            "text": "Let me work through this systematically:\n1. First consideration...\n2. Second consideration...",\
            "signature": null,\
            "id": "reasoning-text-1",\
            "format": "anthropic-claude-v1",\
            "index": 1\
          }\
        ]\
      }\
    }\
  ]
}
```

#### Streaming Response

In streaming responses, `reasoning_details` appears in delta chunks as the reasoning is generated:

```
{
  "choices": [\
    {\
      "delta": {\
        "reasoning_details": [\
          {\
            "type": "reasoning.text",\
            "text": "Let me think about this step by step...",\
            "signature": null,\
            "id": "reasoning-text-1",\
            "format": "anthropic-claude-v1",\
            "index": 0\
          }\
        ]\
      }\
    }\
  ]
}
```

**Streaming Behavior Notes:**

- Each reasoning detail chunk is sent as it becomes available
- The `reasoning_details` array in each chunk may contain one or more reasoning objects
- For encrypted reasoning, the content may appear as `[REDACTED]` in streaming responses
- The complete reasoning sequence is built by concatenating all chunks in order

## Legacy Parameters

For backward compatibility, OpenRouter still supports the following legacy parameters:

- `include_reasoning: true` \- Equivalent to `reasoning: {}`
- `include_reasoning: false` \- Equivalent to `reasoning: { exclude: true }`

However, we recommend using the new unified `reasoning` parameter for better control and future compatibility.

## Provider-Specific Reasoning Implementation

### Anthropic Models with Reasoning Tokens

The latest Claude models, such as [anthropic/claude-3.7-sonnet](https://openrouter.ai/anthropic/claude-3.7-sonnet), support working with and returning reasoning tokens.

You can enable reasoning on Anthropic models **only** using the unified `reasoning` parameter with either `effort` or `max_tokens`.

**Note:** The `:thinking` variant is no longer supported for Anthropic models. Use the `reasoning` parameter instead.

#### Reasoning Max Tokens for Anthropic Models

When using Anthropic models with reasoning:

- When using the `reasoning.max_tokens` parameter, that value is used directly with a minimum of 1024 tokens.
- When using the `reasoning.effort` parameter, the budget\_tokens are calculated based on the `max_tokens` value.

The reasoning token allocation is capped at 128,000 tokens maximum and 1024 tokens minimum. The formula for calculating the budget\_tokens is: `budget_tokens = max(min(max_tokens * {effort_ratio}, 128000), 1024)`

effort\_ratio is 0.95 for xhigh effort, 0.8 for high effort, 0.5 for medium effort, 0.2 for low effort, and 0.1 for minimal effort.

**Important**: `max_tokens` must be strictly higher than the reasoning budget to ensure there are tokens available for the final response after thinking.

##### Token Usage and Billing

Please note that reasoning tokens are counted as output tokens for billing
purposes. Using reasoning tokens will increase your token usage but can
significantly improve the quality of model responses.

#### Example: Streaming with Anthropic Reasoning Tokens

PythonTypeScript

```
from openai import OpenAI

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key="<OPENROUTER_API_KEY>",
)

def chat_completion_with_reasoning(messages):
    response = client.chat.completions.create(
        model="anthropic/claude-3.7-sonnet",
        messages=messages,
        max_tokens=10000,
        extra_body={
            "reasoning": {
                "max_tokens": 8000
            }
        },
        stream=True
    )
    return response

for chunk in chat_completion_with_reasoning([\
    {"role": "user", "content": "What's bigger, 9.9 or 9.11?"}\
]):
    if hasattr(chunk.choices[0].delta, 'reasoning_details') and chunk.choices[0].delta.reasoning_details:
        print(f"REASONING_DETAILS: {chunk.choices[0].delta.reasoning_details}")
    elif getattr(chunk.choices[0].delta, 'content', None):
        print(f"CONTENT: {chunk.choices[0].delta.content}")
```

### Google Gemini 3 Models with Thinking Levels

Gemini 3 models (such as [google/gemini-3.1-pro-preview](https://openrouter.ai/google/gemini-3.1-pro-preview) and [google/gemini-3-flash-preview](https://openrouter.ai/google/gemini-3-flash-preview)) use Google’s `thinkingLevel` API instead of the older `thinkingBudget` API used by Gemini 2.5 models.

OpenRouter maps the `reasoning.effort` parameter directly to Google’s `thinkingLevel` values:

| OpenRouter `reasoning.effort` | Google `thinkingLevel` |
| --- | --- |
| `"minimal"` | `"minimal"` |
| `"low"` | `"low"` |
| `"medium"` | `"medium"` |
| `"high"` | `"high"` |
| `"xhigh"` | `"high"` (mapped down) |

##### Token Consumption is Determined by Google

When using `thinkingLevel`, the actual number of reasoning tokens consumed is determined internally by Google. There are no publicly documented token limit breakpoints for each level. For example, setting `effort: "low"` might result in several hundred reasoning tokens depending on the complexity of the task. This is expected behavior and reflects how Google implements thinking levels internally.

If a model doesn’t support a specific effort level (for example, if a model only supports `low` and `high`), OpenRouter will map your requested effort to the nearest supported level.

#### Using max\_tokens with Gemini 3

If you specify `reasoning.max_tokens` explicitly, OpenRouter will pass it through as `thinkingBudget` to Google’s API. However, for Gemini 3 models, Google internally maps this budget value to a `thinkingLevel`, so you will not get precise token control. The actual token consumption is still determined by Google’s thinkingLevel implementation, not by the specific budget value you provide.

#### Example: Using Thinking Levels with Gemini 3

PythonTypeScript

```
from openai import OpenAI

client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key="<OPENROUTER_API_KEY>",
)

response = client.chat.completions.create(
    model="google/gemini-3.1-pro-preview",
    messages=[\
        {"role": "user", "content": "Explain the implications of quantum entanglement."}\
    ],
    extra_body={
        "reasoning": {
            "effort": "low"  # Maps to thinkingLevel: "low"
        }
    },
)

msg = response.choices[0].message
print(getattr(msg, "reasoning", None))
print(getattr(msg, "content", None))
```

Ask AI

Assistant

Responses are generated using AI and may contain mistakes.

Hi, I'm an AI assistant with access to documentation and other content.

Tip: You can toggle this pane with

`⌘`

+

`/`