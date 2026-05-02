<!-- source: https://openrouter.ai/docs/api-reference/chat-completion
     fetched: 2026-05-02T12:55:49.982Z -->

For AI agents: a documentation index is available at the root level at /llms.txt and /llms-full.txt. Append /llms.txt to any URL for a page-level index, or .md for the markdown version of any page.

Sends a request for a model response for the given chat conversation. Supports both streaming and non-streaming modes.

### Authentication

AuthorizationBearer

API key as bearer token in Authorization header

### Request

This endpoint expects an object.

messageslist of objectsRequired

List of messages for the conversation

Show 5 variants

cache\_controlobjectOptional

Enable automatic prompt caching. When set, the system automatically applies cache breakpoints to the last cacheable block in the request. Currently supported for Anthropic Claude models.

Show 2 properties

debugobjectOptional

Debug options for inspecting request transformations (streaming only)

Show 1 properties

frequency\_penaltydouble or nullOptional

Frequency penalty (-2.0 to 2.0)

image\_configstring or double or list of anyOptional

Show 3 variants

logit\_biasmap from strings to doubles or nullOptional

Token logit bias adjustments

logprobsboolean or nullOptional

Return log probabilities

max\_completion\_tokensinteger or nullOptional

Maximum tokens in completion

max\_tokensinteger or nullOptional

Maximum tokens (deprecated, use max\_completion\_tokens). Note: some providers enforce a minimum of 16.

metadatamap from strings to stringsOptional

Key-value pairs for additional object information (max 16 pairs, 64 char keys, 512 char values)

modalitieslist of enumsOptional

Output modalities for the response. Supported values are "text", "image", and "audio".

Allowed values:textimageaudio

modelstringOptional

Model to use for completion

modelslist of stringsOptional

Models to use for completion

parallel\_tool\_callsboolean or nullOptional

Whether to enable parallel function calling during tool use. When true, the model may generate multiple tool calls in a single response.

pluginslist of objectsOptional

Plugins you want to enable for this request, including their settings.

Show 7 variants

presence\_penaltydouble or nullOptional

Presence penalty (-2.0 to 2.0)

providerobjectOptional

When multiple model providers are available, optionally indicate your routing preference.

Show 13 properties

reasoningobjectOptional

Configuration options for reasoning models

Show 2 properties

response\_formatobjectOptional

Response format configuration

Show 5 variants

routeanyOptional

seedinteger or nullOptional

Random seed for deterministic outputs

service\_tierenum or nullOptional

The service tier to use for processing this request.

Allowed values:autodefaultflexpriorityscale

session\_idstringOptional`<=256 characters`

A unique identifier for grouping related requests (e.g., a conversation or agent workflow) for observability. If provided in both the request body and the x-session-id header, the body value takes precedence. Maximum of 256 characters.

stopstring or list of strings or anyOptional

Stop sequences (up to 4)

Show 3 variants

streambooleanOptionalDefaults to `false`

Enable streaming response

stream\_optionsobjectOptional

Streaming configuration options

Show 1 properties

temperaturedouble or nullOptional

Sampling temperature (0-2)

tool\_choiceenum or objectOptional

Tool choice configuration

Show 4 variants

toolslist of objectsOptional

Available tools for function calling

Show 7 variants

top\_logprobsinteger or nullOptional

Number of top log probabilities to return (0-20)

top\_pdouble or nullOptional

Nucleus sampling parameter (0-1)

traceobjectOptional

Metadata for observability and tracing. Known keys (trace\_id, trace\_name, span\_name, generation\_name, parent\_span\_id) have special handling. Additional keys are passed through as custom metadata to configured broadcast destinations.

Show 5 properties

userstringOptional

Unique user identifier

### Response

Successful chat completion response

choiceslist of objects

List of completion choices

Show 4 properties

createdinteger

Unix timestamp of creation

idstring

Unique completion identifier

modelstring

Model used for completion

objectenum

Allowed values:chat.completion

system\_fingerprintstring or null

System fingerprint

service\_tierstring or null

The service tier used by the upstream provider for this request

usageobject

Token usage statistics

Show 8 properties

### Errors

400

Bad Request Error

401

Unauthorized Error

402

Payment Required Error

404

Not Found Error

408

Request Timeout Error

413

Content Too Large Error

422

Unprocessable Entity Error

429

Too Many Requests Error

500

Internal Server Error

502

Bad Gateway Error

503

Service Unavailable Error

Ask AI

Assistant

Responses are generated using AI and may contain mistakes.

Hi, I'm an AI assistant with access to documentation and other content.

Tip: You can toggle this pane with

`⌘`

+

`/`