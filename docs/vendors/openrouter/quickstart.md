<!-- source: https://openrouter.ai/docs/quickstart
     fetched: 2026-05-02T12:56:19.090Z -->

For AI agents: a documentation index is available at the root level at /llms.txt and /llms-full.txt. Append /llms.txt to any URL for a page-level index, or .md for the markdown version of any page.

OpenRouter provides a unified API that gives you access to hundreds of AI models through a single endpoint, while automatically handling fallbacks and selecting the most cost-effective options.

There are three ways to integrate with OpenRouter, depending on how much control you want:

| Approach | Best for |
| --- | --- |
| **[API](https://openrouter.ai/docs/quickstart#using-the-openrouter-api)** | Full control, any language, no dependencies |
| **[Client SDKs](https://openrouter.ai/docs/quickstart#using-the-client-sdks)** | Type-safe model calls with minimal overhead |
| **[Agent SDK](https://openrouter.ai/docs/quickstart#using-the-agent-sdk)** | Building agents with tool use, loops, and state |

```
Read https://openrouter.ai/skills/create-agent/SKILL.md and follow the instructions to build an agent using OpenRouter.
```

Looking for information about free models and rate limits? Please see the [FAQ](https://openrouter.ai/docs/faq#how-are-rate-limits-calculated)

In the examples below, the OpenRouter-specific headers are optional. Setting them allows your app to appear on the OpenRouter leaderboards. For detailed information about app attribution, see our [App Attribution guide](https://openrouter.ai/docs/app-attribution).

* * *

## Using the OpenRouter API

The most direct way to use OpenRouter. Send standard HTTP requests to the `/api/v1/chat/completions` endpoint — compatible with any language or framework.

You can use the interactive [Request Builder](https://openrouter.ai/request-builder) to generate OpenRouter API requests in the language of your choice.

PythonTypeScript (fetch)Shell

```
import requests
import json

response = requests.post(
  url="https://openrouter.ai/api/v1/chat/completions",
  headers={
    "Authorization": "Bearer <OPENROUTER_API_KEY>",
    "HTTP-Referer": "<YOUR_SITE_URL>", # Optional. Site URL for rankings on openrouter.ai.
    "X-OpenRouter-Title": "<YOUR_SITE_NAME>", # Optional. Site title for rankings on openrouter.ai.
  },
  data=json.dumps({
    "model": "openai/gpt-5.2",
    "messages": [\
      {\
        "role": "user",\
        "content": "What is the meaning of life?"\
      }\
    ]
  })
)
```

The API also supports [streaming](https://openrouter.ai/docs/api/reference/streaming). You can also use the [OpenAI SDK](https://openrouter.ai/docs/quickstart#using-the-openai-sdk) pointed at OpenRouter as a drop-in replacement.

* * *

## Using the Client SDKs

The [Client SDKs](https://openrouter.ai/docs/client-sdks/overview) wrap the OpenRouter API with full type safety, auto-generated types from the OpenAPI spec, and zero boilerplate. It is intentionally lean — a thin layer over the REST API.

First, install the SDK:

npmyarnpnpmpip

```
npm install @openrouter/sdk
```

Then use it in your code:

TypeScriptPython

```
import OpenRouter from '@openrouter/sdk';

const client = new OpenRouter({
  apiKey: '<OPENROUTER_API_KEY>',
  defaultHeaders: {
    'HTTP-Referer': '<YOUR_SITE_URL>', // Optional. Site URL for rankings on openrouter.ai.
    'X-OpenRouter-Title': '<YOUR_SITE_NAME>', // Optional. Site title for rankings on openrouter.ai.
  },
});

const completion = await client.chat.send({
  model: 'openai/gpt-5.2',
  messages: [\
    {\
      role: 'user',\
      content: 'What is the meaning of life?',\
    },\
  ],
});

console.log(completion.choices[0].message.content);
```

See the full [Client SDKs documentation](https://openrouter.ai/docs/client-sdks/overview) for streaming, embeddings, and the complete API reference.

* * *

## Using the Agent SDK

The [Agent SDK](https://openrouter.ai/docs/agent-sdk/overview) (`@openrouter/agent`) provides higher-level primitives for building AI agents. It handles multi-turn conversation loops, tool execution, and state management automatically via the `callModel` function.

Install the package:

npmpnpmyarn

```
npm install @openrouter/agent
```

Build an agent with tools:

```
import { callModel, tool } from '@openrouter/agent';
import { z } from 'zod';

const weatherTool = tool({
  name: 'get_weather',
  description: 'Get the current weather for a location',
  inputSchema: z.object({
    location: z.string().describe('City name'),
  }),
  execute: async ({ location }) => {
    return { temperature: 72, condition: 'sunny', location };
  },
});

const result = await callModel({
  model: 'anthropic/claude-sonnet-4',
  messages: [\
    { role: 'user', content: 'What is the weather in San Francisco?' },\
  ],
  tools: [weatherTool],
});

const text = await result.getText();
console.log(text);
```

The SDK sends the prompt, receives a tool call from the model, executes `get_weather`, feeds the result back, and returns the final response — all in one `callModel` invocation.

See the full [Agent SDK documentation](https://openrouter.ai/docs/agent-sdk/overview) for stop conditions, streaming, dynamic parameters, and more.

* * *

## Using the OpenAI SDK

You can also use the OpenAI SDK pointed at OpenRouter as a drop-in replacement. This is useful if you have existing code built on the OpenAI SDK and want to access OpenRouter’s model catalog without changing your code structure.

TypescriptPython

```
import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: '<OPENROUTER_API_KEY>',
  defaultHeaders: {
    'HTTP-Referer': '<YOUR_SITE_URL>', // Optional. Site URL for rankings on openrouter.ai.
    'X-OpenRouter-Title': '<YOUR_SITE_NAME>', // Optional. Site title for rankings on openrouter.ai.
  },
});

async function main() {
  const completion = await openai.chat.completions.create({
    model: 'openai/gpt-5.2',
    messages: [\
      {\
        role: 'user',\
        content: 'What is the meaning of life?',\
      },\
    ],
  });

  console.log(completion.choices[0].message);
}

main();
```

## Using third-party SDKs

For information about using third-party SDKs and frameworks with OpenRouter, please [see our frameworks documentation.](https://openrouter.ai/docs/guides/community/frameworks-and-integrations-overview)

Ask AI

Assistant

Responses are generated using AI and may contain mistakes.

Hi, I'm an AI assistant with access to documentation and other content.

Tip: You can toggle this pane with

`⌘`

+

`/`