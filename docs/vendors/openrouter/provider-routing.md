<!-- source: https://openrouter.ai/docs/features/provider-routing
     fetched: 2026-05-02T12:55:44.583Z -->

For AI agents: a documentation index is available at the root level at /llms.txt and /llms-full.txt. Append /llms.txt to any URL for a page-level index, or .md for the markdown version of any page.

OpenRouter routes requests to the best available providers for your model. By default, [requests are load balanced](https://openrouter.ai/docs/guides/routing/provider-selection#price-based-load-balancing-default-strategy) across the top providers to maximize uptime.

You can customize how your requests are routed using the `provider` object in the request body for [Chat Completions](https://openrouter.ai/docs/api-reference/chat-completion).

The `provider` object can contain the following fields:

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `order` | string\[\] | - | List of provider slugs to try in order (e.g. `["anthropic", "openai"]`). [Learn more](https://openrouter.ai/docs/guides/routing/provider-selection#ordering-specific-providers) |
| `allow_fallbacks` | boolean | `true` | Whether to allow backup providers when the primary is unavailable. [Learn more](https://openrouter.ai/docs/guides/routing/provider-selection#disabling-fallbacks) |
| `require_parameters` | boolean | `false` | Only use providers that support all parameters in your request. [Learn more](https://openrouter.ai/docs/guides/routing/provider-selection#requiring-providers-to-support-all-parameters-beta) |
| `data_collection` | ”allow” \| “deny" | "allow” | Control whether to use providers that may store data. [Learn more](https://openrouter.ai/docs/guides/routing/provider-selection#requiring-providers-to-comply-with-data-policies) |
| `zdr` | boolean | - | Restrict routing to only ZDR (Zero Data Retention) endpoints. [Learn more](https://openrouter.ai/docs/guides/routing/provider-selection#zero-data-retention-enforcement) |
| `enforce_distillable_text` | boolean | - | Restrict routing to only models that allow text distillation. [Learn more](https://openrouter.ai/docs/guides/routing/provider-selection#distillable-text-enforcement) |
| `only` | string\[\] | - | List of provider slugs to allow for this request. [Learn more](https://openrouter.ai/docs/guides/routing/provider-selection#allowing-only-specific-providers) |
| `ignore` | string\[\] | - | List of provider slugs to skip for this request. [Learn more](https://openrouter.ai/docs/guides/routing/provider-selection#ignoring-providers) |
| `quantizations` | string\[\] | - | List of quantization levels to filter by (e.g. `["int4", "int8"]`). [Learn more](https://openrouter.ai/docs/guides/routing/provider-selection#quantization) |
| `sort` | string \| object | - | Sort providers by price, throughput, or latency. Can be a string (e.g. `"price"`) or an object with `by` and `partition` fields. [Learn more](https://openrouter.ai/docs/guides/routing/provider-selection#provider-sorting) |
| `preferred_min_throughput` | number \| object | - | Preferred minimum throughput (tokens/sec). Can be a number or an object with percentile cutoffs (p50, p75, p90, p99). [Learn more](https://openrouter.ai/docs/guides/routing/provider-selection#performance-thresholds) |
| `preferred_max_latency` | number \| object | - | Preferred maximum latency (seconds). Can be a number or an object with percentile cutoffs (p50, p75, p90, p99). [Learn more](https://openrouter.ai/docs/guides/routing/provider-selection#performance-thresholds) |
| `max_price` | object | - | The maximum pricing you want to pay for this request. [Learn more](https://openrouter.ai/docs/guides/routing/provider-selection#maximum-price) |

##### EU data residency (Enterprise)

OpenRouter supports EU in-region routing for enterprise customers. When enabled, prompts and completions are processed entirely within the EU. Learn more in our [Privacy docs here](https://openrouter.ai/docs/guides/privacy/provider-logging#enterprise-eu-in-region-routing). To contact our enterprise team, [fill out this form](https://openrouter.ai/enterprise/form).

## Price-Based Load Balancing (Default Strategy)

For each model in your request, OpenRouter’s default behavior is to load balance requests across providers, prioritizing price.

If you are more sensitive to throughput than price, you can use the `sort` field to explicitly prioritize throughput.

When you send a request with `tools` or `tool_choice`, OpenRouter will only
route to providers that support tool use. Similarly, if you set a
`max_tokens`, then OpenRouter will only route to providers that support a
response of that length.

Here is OpenRouter’s default load balancing strategy:

1. Prioritize providers that have not seen significant outages in the last 30 seconds.
2. For the stable providers, look at the lowest-cost candidates and select one weighted by inverse square of the price (example below).
3. Use the remaining providers as fallbacks.

##### A Load Balancing Example

If Provider A costs $1 per million tokens, Provider B costs $2, and Provider C costs $3, and Provider B recently saw a few outages.

- Your request is routed to Provider A. Provider A is 9x more likely to be first routed to Provider A than Provider C because (1/32=1/9)(1 / 3^2 = 1/9)(1/32=1/9) (inverse square of the price).
- If Provider A fails, then Provider C will be tried next.
- If Provider C also fails, Provider B will be tried last.

If you have `sort` or `order` set in your provider preferences, load balancing will be disabled.

## Provider Sorting

As described above, OpenRouter load balances based on price, while taking uptime into account.

If you instead want to _explicitly_ prioritize a particular provider attribute, you can include the `sort` field in the `provider` preferences. Load balancing will be disabled, and the router will try providers in order.

The three sort options are:

- `"price"`: prioritize lowest price
- `"throughput"`: prioritize highest throughput
- `"latency"`: prioritize lowest latency

TypeScript SDKTypeScript (fetch)Python

```
import { OpenRouter } from '@openrouter/sdk';

const openRouter = new OpenRouter({
  apiKey: '<OPENROUTER_API_KEY>',
});

const completion = await openRouter.chat.send({
  model: 'meta-llama/llama-3.3-70b-instruct',
  messages: [{ role: 'user', content: 'Hello' }],
  provider: {
    sort: 'throughput',
  },
  stream: false,
});
```

To _always_ prioritize low prices, and not apply any load balancing, set `sort` to `"price"`.

To _always_ prioritize low latency, and not apply any load balancing, set `sort` to `"latency"`.

## Nitro Shortcut

You can append `:nitro` to any model slug as a shortcut to sort by throughput. This is exactly equivalent to setting `provider.sort` to `"throughput"`.

TypeScript SDKTypeScript (fetch)Python

```
import { OpenRouter } from '@openrouter/sdk';

const openRouter = new OpenRouter({
  apiKey: '<OPENROUTER_API_KEY>',
});

const completion = await openRouter.chat.send({
  model: 'meta-llama/llama-3.3-70b-instruct:nitro',
  messages: [{ role: 'user', content: 'Hello' }],
  stream: false,
});
```

## Floor Price Shortcut

You can append `:floor` to any model slug as a shortcut to sort by price. This is exactly equivalent to setting `provider.sort` to `"price"`.

TypeScript SDKTypeScript (fetch)Python

```
import { OpenRouter } from '@openrouter/sdk';

const openRouter = new OpenRouter({
  apiKey: '<OPENROUTER_API_KEY>',
});

const completion = await openRouter.chat.send({
  model: 'meta-llama/llama-3.3-70b-instruct:floor',
  messages: [{ role: 'user', content: 'Hello' }],
  stream: false,
});
```

## Advanced Sorting with Partition

When using [model fallbacks](https://openrouter.ai/docs/features/model-routing), the `sort` field can be specified as an object with additional options to control how endpoints are sorted across multiple models.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `sort.by` | string | - | The sorting strategy: `"price"`, `"throughput"`, or `"latency"`. |
| `sort.partition` | string | `"model"` | How to group endpoints for sorting: `"model"` (default) or `"none"`. |

By default, when you specify multiple models (fallbacks), OpenRouter groups endpoints by model before sorting. This means the primary model’s endpoints are always tried first, regardless of their performance characteristics. Setting `partition` to `"none"` removes this grouping, allowing endpoints to be sorted globally across all models.

To explicitly use the default behavior, set `partition: "model"`. For more details on how model fallbacks work, see [Model Fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks).

`preferred_max_latency` and `preferred_min_throughput` do _not_ guarantee you will get a provider or model with this performance level. However, providers and models that hit your thresholds will be preferred. Specifying these preferences should therefore never prevent your request from being executed. This is different than `max_price`, which will prevent your request from running if the price is not available.

### Use Case 1: Route to the Highest Throughput or Lowest Latency Model

When you have multiple acceptable models and want to use whichever has the best performance right now, use `partition: "none"` with throughput or latency sorting. This is useful when you care more about speed than using a specific model.

TypeScript SDKTypeScript (fetch)PythoncURL

```
import { OpenRouter } from '@openrouter/sdk';

const openRouter = new OpenRouter({
  apiKey: '<OPENROUTER_API_KEY>',
});

const completion = await openRouter.chat.send({
  models: [\
    'anthropic/claude-sonnet-4.5',\
    'openai/gpt-5-mini',\
    'google/gemini-3-flash-preview',\
  ],
  messages: [{ role: 'user', content: 'Hello' }],
  provider: {
    sort: {
      by: 'throughput',
      partition: 'none',
    },
  },
  stream: false,
});
```

In this example, OpenRouter will route to whichever endpoint across all three models currently has the highest throughput, rather than always trying Claude first.

## Performance Thresholds

You can set minimum throughput or maximum latency thresholds to filter endpoints. Endpoints that don’t meet these thresholds are deprioritized (moved to the end of the list) rather than excluded entirely.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `preferred_min_throughput` | number \| object | - | Preferred minimum throughput in tokens per second. Can be a number (applies to p50) or an object with percentile cutoffs. |
| `preferred_max_latency` | number \| object | - | Preferred maximum latency in seconds. Can be a number (applies to p50) or an object with percentile cutoffs. |

### How Percentiles Work

OpenRouter tracks latency and throughput metrics for each model and provider using percentile statistics calculated over a rolling 5-minute window. The available percentiles are:

- **p50** (median): 50% of requests perform better than this value
- **p75**: 75% of requests perform better than this value
- **p90**: 90% of requests perform better than this value
- **p99**: 99% of requests perform better than this value

Higher percentiles (like p90 or p99) give you more confidence about worst-case performance, while lower percentiles (like p50) reflect typical performance. For example, if a model and provider has a p90 latency of 2 seconds, that means 90% of requests complete in under 2 seconds.

When you specify multiple percentile cutoffs, all specified cutoffs must be met for a model and provider to be in the preferred group. This allows you to set both typical and worst-case performance requirements.

### When to Use Percentile Preferences

Percentile-based routing is useful when you need predictable performance characteristics:

- **Real-time applications**: Use p90 or p99 latency thresholds to ensure consistent response times for user-facing features
- **Batch processing**: Use p50 throughput thresholds when you care more about average performance than worst-case scenarios
- **SLA compliance**: Use multiple percentile cutoffs to ensure providers meet your service level agreements across different performance tiers
- **Cost optimization**: Combine with `sort: "price"` to get the cheapest provider that still meets your performance requirements

### Use Case 2: Find the Cheapest Model Meeting Performance Requirements

Combine `partition: "none"` with performance thresholds to find the cheapest option across multiple models that meets your performance requirements. This is useful when you have a performance floor but want to minimize costs.

TypeScript SDKTypeScript (fetch)PythoncURL

```
import { OpenRouter } from '@openrouter/sdk';

const openRouter = new OpenRouter({
  apiKey: '<OPENROUTER_API_KEY>',
});

const completion = await openRouter.chat.send({
  models: [\
    'anthropic/claude-sonnet-4.5',\
    'openai/gpt-5-mini',\
    'google/gemini-3-flash-preview',\
  ],
  messages: [{ role: 'user', content: 'Hello' }],
  provider: {
    sort: {
      by: 'price',
      partition: 'none',
    },
    preferredMinThroughput: {
      p90: 50, // Prefer providers with >50 tokens/sec for 90% of requests in last 5 minutes
    },
  },
  stream: false,
});
```

In this example, OpenRouter will find the cheapest model and provider across all three models that has at least 50 tokens/second throughput at the p90 level (meaning 90% of requests achieve this throughput or better). Models and providers below this threshold are still available as fallbacks if all preferred options fail.

You can also use `preferred_max_latency` to set a maximum acceptable latency:

TypeScript SDKTypeScript (fetch)PythoncURL

```
import { OpenRouter } from '@openrouter/sdk';

const openRouter = new OpenRouter({
  apiKey: '<OPENROUTER_API_KEY>',
});

const completion = await openRouter.chat.send({
  models: [\
    'anthropic/claude-sonnet-4.5',\
    'openai/gpt-5-mini',\
  ],
  messages: [{ role: 'user', content: 'Hello' }],
  provider: {
    sort: {
      by: 'price',
      partition: 'none',
    },
    preferredMaxLatency: {
      p90: 3, // Prefer providers with <3 second latency for 90% of requests in last 5 minutes
    },
  },
  stream: false,
});
```

### Example: Using Multiple Percentile Cutoffs

You can specify multiple percentile cutoffs to set both typical and worst-case performance requirements. All specified cutoffs must be met for a model and provider to be in the preferred group.

TypeScript SDKTypeScript (fetch)PythoncURL

```
import { OpenRouter } from '@openrouter/sdk';

const openRouter = new OpenRouter({
  apiKey: '<OPENROUTER_API_KEY>',
});

const completion = await openRouter.chat.send({
  model: 'deepseek/deepseek-v3.2',
  messages: [{ role: 'user', content: 'Hello' }],
  provider: {
    preferredMaxLatency: {
      p50: 1, // Prefer providers with <1 second latency for 50% of requests in last 5 minutes
      p90: 3, // Prefer providers with <3 second latency for 90% of requests in last 5 minutes
      p99: 5, // Prefer providers with <5 second latency for 99% of requests in last 5 minutes
    },
    preferredMinThroughput: {
      p50: 100, // Prefer providers with >100 tokens/sec for 50% of requests in last 5 minutes
      p90: 50, // Prefer providers with >50 tokens/sec for 90% of requests in last 5 minutes
    },
  },
  stream: false,
});
```

### Use Case 3: Maximize BYOK Usage Across Models

If you use [Bring Your Own Key (BYOK)](https://openrouter.ai/docs/guides/overview/auth/byok) and want to maximize usage of your own API keys, `partition: "none"` can help. When your primary model doesn’t have a BYOK provider available, OpenRouter can route to a fallback model that does support BYOK.

TypeScript SDKTypeScript (fetch)PythoncURL

```
import { OpenRouter } from '@openrouter/sdk';

const openRouter = new OpenRouter({
  apiKey: '<OPENROUTER_API_KEY>',
});

const completion = await openRouter.chat.send({
  models: [\
    'anthropic/claude-sonnet-4.5',\
    'openai/gpt-5-mini',\
    'google/gemini-3-flash-preview',\
  ],
  messages: [{ role: 'user', content: 'Hello' }],
  provider: {
    sort: {
      by: 'price',
      partition: 'none',
    },
  },
  stream: false,
});
```

In this example, if you have a BYOK key configured for OpenAI but not for Anthropic, OpenRouter can route to the GPT-4o endpoint using your own key even though Claude is listed first. Without `partition: "none"`, the router would always try Claude’s endpoints first before falling back to GPT-4o.

BYOK endpoints are automatically prioritized when you have API keys configured for a provider. The `partition: "none"` setting allows this prioritization to work across model boundaries.

## Ordering Specific Providers

You can set the providers that OpenRouter will prioritize for your request using the `order` field.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `order` | string\[\] | - | List of provider slugs to try in order (e.g. `["anthropic", "openai"]`). |

The router will prioritize providers in this list, and in this order, for the model you’re using. If you don’t set this field, the router will [load balance](https://openrouter.ai/docs/guides/routing/provider-selection#price-based-load-balancing-default-strategy) across the top providers to maximize uptime.

You can use the copy button next to provider names on model pages to get the exact provider slug,
including any variants like “/turbo”. See [Targeting Specific Provider Endpoints](https://openrouter.ai/docs/guides/routing/provider-selection#targeting-specific-provider-endpoints) for details.

OpenRouter will try them one at a time and proceed to other providers if none are operational. If you don’t want to allow any other providers, you should [disable fallbacks](https://openrouter.ai/docs/guides/routing/provider-selection#disabling-fallbacks) as well.

### Example: Specifying providers with fallbacks

This example skips over OpenAI (which doesn’t host Mixtral), tries Together, and then falls back to the normal list of providers on OpenRouter:

TypeScript SDKTypeScript (fetch)Python

```
import { OpenRouter } from '@openrouter/sdk';

const openRouter = new OpenRouter({
  apiKey: '<OPENROUTER_API_KEY>',
});

const completion = await openRouter.chat.send({
  model: 'mistralai/mixtral-8x7b-instruct',
  messages: [{ role: 'user', content: 'Hello' }],
  provider: {
    order: ['openai', 'together'],
  },
  stream: false,
});
```

### Example: Specifying providers with fallbacks disabled

Here’s an example with `allow_fallbacks` set to `false` that skips over OpenAI (which doesn’t host Mixtral), tries Together, and then fails if Together fails:

TypeScript SDKTypeScript (fetch)Python

```
import { OpenRouter } from '@openrouter/sdk';

const openRouter = new OpenRouter({
  apiKey: '<OPENROUTER_API_KEY>',
});

const completion = await openRouter.chat.send({
  model: 'mistralai/mixtral-8x7b-instruct',
  messages: [{ role: 'user', content: 'Hello' }],
  provider: {
    order: ['openai', 'together'],
    allowFallbacks: false,
  },
  stream: false,
});
```

## Targeting Specific Provider Endpoints

Each provider on OpenRouter may host multiple endpoints for the same model, such as a default endpoint and a specialized “turbo” endpoint, or region-specific endpoints like `google-vertex/us-east5`. To target a specific endpoint, you can use the copy button next to the provider name on the model detail page to obtain the exact provider slug.

### Base Slug Matching

When you use a base provider slug (e.g. `"google-vertex"`) in any provider routing field (`order`, `only`, or `ignore`), it matches **all** endpoints for that provider, including any variants or regions. For example, `"google-vertex"` matches `google-vertex`, `google-vertex/us-east5`, `google-vertex/us-central1`, and so on.

To target a **specific** variant or region, use the full slug including the suffix (e.g. `"google-vertex/us-east5"` or `"deepinfra/turbo"`).

| Slug in request | What it matches |
| --- | --- |
| `"google-vertex"` | All Google Vertex endpoints (every region) |
| `"google-vertex/us-east5"` | Only the `us-east5` region endpoint |
| `"deepinfra"` | All DeepInfra endpoints (default + turbo) |
| `"deepinfra/turbo"` | Only the DeepInfra turbo endpoint |

### Example: Targeting a specific endpoint variant

For example, DeepInfra offers DeepSeek R1 through multiple endpoints:

- Default endpoint with slug `deepinfra`
- Turbo endpoint with slug `deepinfra/turbo`

By copying the exact provider slug and using it in your request’s `order` array, you can ensure your request is routed to the specific endpoint you want:

TypeScript SDKTypeScript (fetch)Python

```
import { OpenRouter } from '@openrouter/sdk';

const openRouter = new OpenRouter({
  apiKey: '<OPENROUTER_API_KEY>',
});

const completion = await openRouter.chat.send({
  model: 'deepseek/deepseek-r1',
  messages: [{ role: 'user', content: 'Hello' }],
  provider: {
    order: ['deepinfra/turbo'],
    allowFallbacks: false,
  },
  stream: false,
});
```

This approach is especially useful when you want to consistently use a specific variant of a model from a particular provider.

To route to **all** endpoints of a provider (across all regions and variants), just use the base slug without a suffix. For example, `"google-vertex"` will route across all Vertex AI regions.

## Requiring Providers to Support All Parameters

You can restrict requests only to providers that support all parameters in your request using the `require_parameters` field.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `require_parameters` | boolean | `false` | Only use providers that support all parameters in your request. |

With the default routing strategy, providers that don’t support all the [LLM parameters](https://openrouter.ai/docs/api-reference/parameters) specified in your request can still receive the request, but will ignore unknown parameters. When you set `require_parameters` to `true`, the request won’t even be routed to that provider.

### Example: Excluding providers that don’t support JSON formatting

For example, to only use providers that support JSON formatting:

TypeScript SDKTypeScript (fetch)Python

```
import { OpenRouter } from '@openrouter/sdk';

const openRouter = new OpenRouter({
  apiKey: '<OPENROUTER_API_KEY>',
});

const completion = await openRouter.chat.send({
  messages: [{ role: 'user', content: 'Hello' }],
  provider: {
    requireParameters: true,
  },
  responseFormat: { type: 'json_object' },
  stream: false,
});
```

## Requiring Providers to Comply with Data Policies

You can restrict requests only to providers that comply with your data policies using the `data_collection` field.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `data_collection` | ”allow” \| “deny" | "allow” | Control whether to use providers that may store data. |

- `allow`: (default) allow providers which store user data non-transiently and may train on it
- `deny`: use only providers which do not collect user data

Some model providers may log prompts, so we display them with a **Data Policy** tag on model pages. This is not a definitive source of third party data policies, but represents our best knowledge.

##### Account-Wide Data Policy Filtering

This is also available as an account-wide setting in [your privacy\\
settings](https://openrouter.ai/settings/privacy). You can disable third party
model providers that store inputs for training.

### Example: Excluding providers that don’t comply with data policies

To exclude providers that don’t comply with your data policies, set `data_collection` to `deny`:

TypeScript SDKTypeScript (fetch)Python

```
import { OpenRouter } from '@openrouter/sdk';

const openRouter = new OpenRouter({
  apiKey: '<OPENROUTER_API_KEY>',
});

const completion = await openRouter.chat.send({
  messages: [{ role: 'user', content: 'Hello' }],
  provider: {
    dataCollection: 'deny', // or "allow"
  },
  stream: false,
});
```

## Zero Data Retention Enforcement

You can enforce Zero Data Retention (ZDR) on a per-request basis using the `zdr` parameter, ensuring your request only routes to endpoints that do not retain prompts.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `zdr` | boolean | - | Restrict routing to only ZDR (Zero Data Retention) endpoints. |

When `zdr` is set to `true`, the request will only be routed to endpoints that have a Zero Data Retention policy. When `zdr` is `false` or not provided, it has no effect on routing.

##### Account-Wide ZDR Setting

This is also available as an account-wide setting in [your privacy\\
settings](https://openrouter.ai/settings/privacy). The per-request `zdr` parameter
operates as an “OR” with your account-wide ZDR setting - if either is enabled, ZDR enforcement will be applied. The request-level parameter can only ensure ZDR is enabled, not override account-wide enforcement.

### Example: Enforcing ZDR for a specific request

To ensure a request only uses ZDR endpoints, set `zdr` to `true`:

TypeScript SDKTypeScript (fetch)Python

```
import { OpenRouter } from '@openrouter/sdk';

const openRouter = new OpenRouter({
  apiKey: '<OPENROUTER_API_KEY>',
});

const completion = await openRouter.chat.send({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello' }],
  provider: {
    zdr: true,
  },
  stream: false,
});
```

This is useful for customers who don’t want to globally enforce ZDR but need to ensure specific requests only route to ZDR endpoints.

## Distillable Text Enforcement

You can enforce distillable text filtering on a per-request basis using the `enforce_distillable_text` parameter, ensuring your request only routes to models where the author has allowed text distillation.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `enforce_distillable_text` | boolean | - | Restrict routing to only models that allow text distillation. |

When `enforce_distillable_text` is set to `true`, the request will only be routed to models where the author has explicitly enabled text distillation. When `enforce_distillable_text` is `false` or not provided, it has no effect on routing.

This parameter is useful for applications that need to ensure their requests only use models that allow text distillation for training purposes, such as when building datasets for model fine-tuning or distillation workflows.

### Example: Enforcing distillable text for a specific request

To ensure a request only uses models that allow text distillation, set `enforce_distillable_text` to `true`:

TypeScript SDKTypeScript (fetch)Python

```
import { OpenRouter } from '@openrouter/sdk';

const openRouter = new OpenRouter({
  apiKey: '<OPENROUTER_API_KEY>',
});

const completion = await openRouter.chat.send({
  model: 'meta-llama/llama-3.3-70b-instruct',
  messages: [{ role: 'user', content: 'Hello' }],
  provider: {
    enforceDistillableText: true,
  },
  stream: false,
});
```

## Disabling Fallbacks

To guarantee that your request is only served by the top (lowest-cost) provider, you can disable fallbacks.

This is combined with the `order` field from [Ordering Specific Providers](https://openrouter.ai/docs/guides/routing/provider-selection#ordering-specific-providers) to restrict the providers that OpenRouter will prioritize to just your chosen list.

TypeScript SDKTypeScript (fetch)Python

```
import { OpenRouter } from '@openrouter/sdk';

const openRouter = new OpenRouter({
  apiKey: '<OPENROUTER_API_KEY>',
});

const completion = await openRouter.chat.send({
  messages: [{ role: 'user', content: 'Hello' }],
  provider: {
    allowFallbacks: false,
  },
  stream: false,
});
```

## Allowing Only Specific Providers

You can allow only specific providers for a request by setting the `only` field in the `provider` object.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `only` | string\[\] | - | List of provider slugs to allow for this request. |

Only allowing some providers may significantly reduce fallback options and
limit request recovery.

##### Account-Wide Allowed Providers

You can allow providers for all account requests in your [privacy settings](https://openrouter.ai/settings/privacy). This configuration applies to all API requests and chatroom messages.

Note that when you allow providers for a specific request, the list of allowed providers is merged with your account-wide allowed providers.

### Example: Allowing Azure for a request calling GPT-4 Omni

Here’s an example that will only use Azure for a request calling GPT-4 Omni:

TypeScript SDKTypeScript (fetch)Python

```
import { OpenRouter } from '@openrouter/sdk';

const openRouter = new OpenRouter({
  apiKey: '<OPENROUTER_API_KEY>',
});

const completion = await openRouter.chat.send({
  model: 'openai/gpt-5-mini',
  messages: [{ role: 'user', content: 'Hello' }],
  provider: {
    only: ['azure'],
  },
  stream: false,
});
```

## Ignoring Providers

You can ignore providers for a request by setting the `ignore` field in the `provider` object.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `ignore` | string\[\] | - | List of provider slugs to skip for this request. |

Ignoring multiple providers may significantly reduce fallback options and
limit request recovery.

##### Account-Wide Ignored Providers

You can ignore providers for all account requests in your [privacy settings](https://openrouter.ai/settings/privacy). This configuration applies to all API requests and chatroom messages.

Note that when you ignore providers for a specific request, the list of ignored providers is merged with your account-wide ignored providers.

### Example: Ignoring DeepInfra for a request calling Llama 3.3 70b

Here’s an example that will ignore DeepInfra for a request calling Llama 3.3 70b:

TypeScript SDKTypeScript (fetch)Python

```
import { OpenRouter } from '@openrouter/sdk';

const openRouter = new OpenRouter({
  apiKey: '<OPENROUTER_API_KEY>',
});

const completion = await openRouter.chat.send({
  model: 'meta-llama/llama-3.3-70b-instruct',
  messages: [{ role: 'user', content: 'Hello' }],
  provider: {
    ignore: ['deepinfra'],
  },
  stream: false,
});
```

## Quantization

Quantization reduces model size and computational requirements while aiming to preserve performance. Most LLMs today use FP16 or BF16 for training and inference, cutting memory requirements in half compared to FP32. Some optimizations use FP8 or quantization to reduce size further (e.g., INT8, INT4).

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `quantizations` | string\[\] | - | List of quantization levels to filter by (e.g. `["int4", "int8"]`). [Learn more](https://openrouter.ai/docs/guides/routing/provider-selection#quantization) |

Quantized models may exhibit degraded performance for certain prompts,
depending on the method used.

Providers can support various quantization levels for open-weight models.

### Quantization Levels

By default, requests are load-balanced across all available providers, ordered by price. To filter providers by quantization level, specify the `quantizations` field in the `provider` parameter with the following values:

- `int4`: Integer (4 bit)
- `int8`: Integer (8 bit)
- `fp4`: Floating point (4 bit)
- `fp6`: Floating point (6 bit)
- `fp8`: Floating point (8 bit)
- `fp16`: Floating point (16 bit)
- `bf16`: Brain floating point (16 bit)
- `fp32`: Floating point (32 bit)
- `unknown`: Unknown

### Example: Requesting FP8 Quantization

Here’s an example that will only use providers that support FP8 quantization:

TypeScript SDKTypeScript (fetch)Python

```
import { OpenRouter } from '@openrouter/sdk';

const openRouter = new OpenRouter({
  apiKey: '<OPENROUTER_API_KEY>',
});

const completion = await openRouter.chat.send({
  model: 'meta-llama/llama-3.1-8b-instruct',
  messages: [{ role: 'user', content: 'Hello' }],
  provider: {
    quantizations: ['fp8'],
  },
  stream: false,
});
```

### Max Price

To filter providers by price, specify the `max_price` field in the `provider` parameter with a JSON object specifying the highest provider pricing you will accept.

For example, the value `{"prompt": 1, "completion": 2}` will route to any provider with a price of `<= $1/m` prompt tokens, and `<= $2/m` completion tokens or less.

Some providers support per request pricing, in which case you can use the `request` attribute of max\_price. Lastly, `image` is also available, which specifies the max price per image you will accept.

Practically, this field is often combined with a provider `sort` to express, for example, “Use the provider with the highest throughput, as long as it doesn’t cost more than `$x/m` tokens.”

## Provider-Specific Headers

Some providers support beta features that can be enabled through special headers. OpenRouter allows you to pass through certain provider-specific beta headers when making requests.

### Anthropic Beta Features

When using Anthropic models (Claude), you can request specific beta features by including the `x-anthropic-beta` header in your request. OpenRouter will pass through supported beta features to Anthropic.

#### Supported Beta Features

| Feature | Header Value | Description |
| --- | --- | --- |
| Fine-Grained Tool Streaming | `fine-grained-tool-streaming-2025-05-14` | Enables more granular streaming events during tool calls, providing real-time updates as tool arguments are being generated |
| Interleaved Thinking | `interleaved-thinking-2025-05-14` | Allows Claude’s thinking/reasoning to be interleaved with regular output, rather than appearing as a single block |
| Structured Outputs | `structured-outputs-2025-11-13` | Enables the strict tool use feature for supported Claude models, validating tool parameters against your schema to ensure correctly-typed arguments |

OpenRouter manages some Anthropic beta features automatically:

- **Prompt caching and extended context** are enabled based on model capabilities
- **Structured outputs for JSON schema response format** (`response_format.type: "json_schema"`) \- the header is automatically applied

For **strict tool use** (`strict: true` on tools), you must explicitly pass the `structured-outputs-2025-11-13` header. Without this header, OpenRouter will strip the `strict` field and route normally.

#### Example: Enabling Fine-Grained Tool Streaming

TypeScript SDKTypeScript (fetch)Python

```
import { OpenRouter } from '@openrouter/sdk';

const openRouter = new OpenRouter({
  apiKey: '<OPENROUTER_API_KEY>',
});

const completion = await openRouter.chat.send(
  {
    model: 'anthropic/claude-sonnet-4.5',
    messages: [{ role: 'user', content: 'What is the weather in Tokyo?' }],
    tools: [\
      {\
        type: 'function',\
        function: {\
          name: 'get_weather',\
          description: 'Get the current weather for a location',\
          parameters: {\
            type: 'object',\
            properties: {\
              location: { type: 'string' },\
            },\
            required: ['location'],\
          },\
        },\
      },\
    ],
    stream: true,
  },
  {
    headers: {
      'x-anthropic-beta': 'fine-grained-tool-streaming-2025-05-14',
    },
  },
);
```

#### Example: Enabling Interleaved Thinking

TypeScript SDKTypeScript (fetch)Python

```
import { OpenRouter } from '@openrouter/sdk';

const openRouter = new OpenRouter({
  apiKey: '<OPENROUTER_API_KEY>',
});

const completion = await openRouter.chat.send(
  {
    model: 'anthropic/claude-sonnet-4.5',
    messages: [{ role: 'user', content: 'Solve this step by step: What is 15% of 240?' }],
    stream: true,
  },
  {
    headers: {
      'x-anthropic-beta': 'interleaved-thinking-2025-05-14',
    },
  },
);
```

#### Combining Multiple Beta Features

You can enable multiple beta features by separating them with commas:

```
x-anthropic-beta: fine-grained-tool-streaming-2025-05-14,interleaved-thinking-2025-05-14
```

Beta features are experimental and may change or be deprecated by Anthropic. Check [Anthropic’s documentation](https://docs.anthropic.com/en/api/beta-features) for the latest information on available beta features.

## Terms of Service

You can view the terms of service for each provider below. You may not violate the terms of service or policies of third-party providers that power the models on OpenRouter.

\- `SambaNova`: [https://sambanova.ai/terms-and-conditions](https://sambanova.ai/terms-and-conditions)

\- `Reka AI`: [https://reka.ai/legal/terms-of-use](https://reka.ai/legal/terms-of-use)

\- `Cerebras`: [https://www.cerebras.ai/terms-of-service](https://www.cerebras.ai/terms-of-service)

\- `Morph`: [https://www.morphllm.com/privacy/tos](https://www.morphllm.com/privacy/tos)

\- `AkashML`: [https://akashml.com/terms](https://akashml.com/terms)

\- `Moonshot AI`: [https://platform.moonshot.ai/docs/agreement/modeluse](https://platform.moonshot.ai/docs/agreement/modeluse)

\- `OpenAI`: [https://openai.com/policies/row-terms-of-use/](https://openai.com/policies/row-terms-of-use/)

\- `Z.ai`: [https://chat.z.ai/legal-agreement/terms-of-service](https://chat.z.ai/legal-agreement/terms-of-service)

\- `Weights & Biases`: [https://site.wandb.ai/terms/](https://site.wandb.ai/terms/)

\- `Black Forest Labs`: [https://bfl.ai/legal/terms-of-service](https://bfl.ai/legal/terms-of-service)

\- `Ionstream`: [https://ionstream.ai/terms-and-conditions/](https://ionstream.ai/terms-and-conditions/)

\- `AI21`: [https://www.ai21.com/terms-of-service/](https://www.ai21.com/terms-of-service/)

\- `MiniMax`: [https://www.minimax.io/platform/protocol/terms-of-service](https://www.minimax.io/platform/protocol/terms-of-service)

\- `Featherless`: [https://featherless.ai/terms](https://featherless.ai/terms)

\- `Fireworks`: [https://fireworks.ai/terms-of-service](https://fireworks.ai/terms-of-service)

\- `Baseten`: [https://www.baseten.co/terms-and-conditions](https://www.baseten.co/terms-and-conditions)

\- `Groq`: [https://groq.com/terms-of-use/](https://groq.com/terms-of-use/)

\- `Cohere`: [https://cohere.com/terms-of-use](https://cohere.com/terms-of-use)

\- `NextBit`: [https://www.nextbit256.com/docs/terms-of-service](https://www.nextbit256.com/docs/terms-of-service)

\- `Mancer`: [https://mancer.tech/terms](https://mancer.tech/terms)

\- `DeepSeek`: [https://chat.deepseek.com/downloads/DeepSeek%20Terms%20of%20Use.html](https://chat.deepseek.com/downloads/DeepSeek%20Terms%20of%20Use.html)

\- `Perplexity`: [https://www.perplexity.ai/hub/legal/perplexity-api-terms-of-service](https://www.perplexity.ai/hub/legal/perplexity-api-terms-of-service)

\- `SiliconFlow`: [https://docs.siliconflow.com/en/legals/terms-of-service](https://docs.siliconflow.com/en/legals/terms-of-service)

\- `Infermatic`: [https://infermatic.ai/terms-and-conditions/](https://infermatic.ai/terms-and-conditions/)

\- `GMICloud`: [https://www.gmicloud.ai/terms-and-conditions](https://www.gmicloud.ai/terms-and-conditions)

\- `xAI`: [https://x.ai/legal/terms-of-service-enterprise](https://x.ai/legal/terms-of-service-enterprise)

\- `Inflection`: [https://developers.inflection.ai/tos](https://developers.inflection.ai/tos)

\- `Sourceful`: [https://www.sourceful.com/legal/spring-terms-of-use](https://www.sourceful.com/legal/spring-terms-of-use)

\- `DeepInfra`: [https://deepinfra.com/terms](https://deepinfra.com/terms)

\- `MARA`: [https://www.mara.com/mara-legals/ai-policies#cloud-toc](https://www.mara.com/mara-legals/ai-policies#cloud-toc)

\- `Xiaomi`: [https://platform.xiaomimimo.com/#/docs/terms/user-agreement](https://platform.xiaomimimo.com/#/docs/terms/user-agreement)

\- `Azure`: [https://www.microsoft.com/en-us/legal/terms-of-use?oneroute=true](https://www.microsoft.com/en-us/legal/terms-of-use?oneroute=true)

\- `Alibaba Cloud Int.`: [https://www.alibabacloud.com/help/en/legal/latest/alibaba-cloud-international-website-product-terms-of-service-v-3-8-0](https://www.alibabacloud.com/help/en/legal/latest/alibaba-cloud-international-website-product-terms-of-service-v-3-8-0)

\- `NVIDIA`: [https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf](https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf)

\- `Friendli`: [https://friendli.ai/terms-of-service](https://friendli.ai/terms-of-service)

\- `Inception`: [https://www.inceptionlabs.ai/terms](https://www.inceptionlabs.ai/terms)

\- `Mistral`: [https://mistral.ai/terms/#terms-of-use](https://mistral.ai/terms/#terms-of-use)

\- `Venice`: [https://venice.ai/legal/tos](https://venice.ai/legal/tos)

\- `Cloudflare`: [https://www.cloudflare.com/service-specific-terms-developer-platform/#developer-platform-terms](https://www.cloudflare.com/service-specific-terms-developer-platform/#developer-platform-terms)

\- `Nebius Token Factory`: [https://docs.nebius.com/legal/studio/terms-of-use/](https://docs.nebius.com/legal/studio/terms-of-use/)

\- `AionLabs`: [https://www.aionlabs.ai/terms/](https://www.aionlabs.ai/terms/)

\- `Liquid`: [https://www.liquid.ai/terms-conditions](https://www.liquid.ai/terms-conditions)

\- `Relace`: [https://www.relace.ai/terms-of-use](https://www.relace.ai/terms-of-use)

\- `OpenInference`: [https://www.openinference.xyz/terms](https://www.openinference.xyz/terms)

\- `Parasail`: [https://www.parasail.io/legal/terms](https://www.parasail.io/legal/terms)

\- `DekaLLM`: [https://docs.cloudeka.ai/service-portal-ai/end-user-license-agreement](https://docs.cloudeka.ai/service-portal-ai/end-user-license-agreement)

\- `Phala`: [https://red-pill.ai/terms](https://red-pill.ai/terms)

\- `Poolside`: [http://poolside.ai/legal](http://poolside.ai/legal)

\- `ModelRun`: [https://modelrun.org/TOS.html](https://modelrun.org/TOS.html)

\- `Clarifai`: [https://www.clarifai.com/company/terms](https://www.clarifai.com/company/terms)

\- `Anthropic`: [https://www.anthropic.com/legal/commercial-terms](https://www.anthropic.com/legal/commercial-terms)

\- `Seed`: [https://docs.byteplus.com/en/docs/legal/docs-terms-of-service](https://docs.byteplus.com/en/docs/legal/docs-terms-of-service)

\- `Baidu Qianfan`: [https://intl.cloud.baidu.com/en/doc/Agreements/s/bmesahnjh-intl-en](https://intl.cloud.baidu.com/en/doc/Agreements/s/bmesahnjh-intl-en)

\- `AtlasCloud`: [https://www.atlascloud.ai/privacy](https://www.atlascloud.ai/privacy)

\- `NovitaAI`: [https://novita.ai/legal/terms-of-service](https://novita.ai/legal/terms-of-service)

\- `StreamLake`: [https://www.streamlake.ai/document/DOC/mgkchnd89grpt1961fw](https://www.streamlake.ai/document/DOC/mgkchnd89grpt1961fw)

\- `Amazon Bedrock`: [https://aws.amazon.com/service-terms/](https://aws.amazon.com/service-terms/)

\- `Together`: [https://www.together.ai/terms-of-service](https://www.together.ai/terms-of-service)

\- `Inceptron`: [https://www.inceptron.io/termsofservice](https://www.inceptron.io/termsofservice)

\- `Chutes`: [https://chutes.ai/tos](https://chutes.ai/tos)

\- `Google Vertex`: [https://cloud.google.com/terms/](https://cloud.google.com/terms/)

\- `Google AI Studio`: [https://cloud.google.com/terms/](https://cloud.google.com/terms/)

Ask AI

Assistant

Responses are generated using AI and may contain mistakes.

Hi, I'm an AI assistant with access to documentation and other content.

Tip: You can toggle this pane with

`⌘`

+

`/`