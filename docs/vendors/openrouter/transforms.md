<!-- source: https://openrouter.ai/docs/features/message-transforms
     fetched: 2026-05-02T12:56:34.169Z -->

For AI agents: a documentation index is available at the root level at /llms.txt and /llms-full.txt. Append /llms.txt to any URL for a page-level index, or .md for the markdown version of any page.

To help with prompts that exceed the maximum context size of a model, OpenRouter supports a context compression [plugin](https://openrouter.ai/docs/guides/features/plugins) that can be enabled per-request:

```
{
  plugins: [{ id: "context-compression" }], // Compress prompts that are > context size.
  messages: [...],
  model // Works with any model
}
```

This can be useful for situations where perfect recall is not required. The plugin works by removing or truncating messages from the middle of the prompt, until the prompt fits within the model’s context window.

In some cases, the issue is not the token context length, but the actual number of messages. The plugin addresses this as well: For instance, Anthropic’s Claude models enforce a maximum of 1000 messages. When this limit is exceeded with context compression enabled, the plugin will keep half of the messages from the start and half from the end of the conversation.

When context compression is enabled, OpenRouter will first try to find models whose context length is at least half of your total required tokens (input + completion). For example, if your prompt requires 10,000 tokens total, models with at least 5,000 context length will be considered. If no models meet this criteria, OpenRouter will fall back to using the model with the highest available context length.

The compression will then attempt to fit your content within the chosen model’s context window by removing or truncating content from the middle of the prompt. If context compression is disabled and your total tokens exceed the model’s context length, the request will fail with an error message suggesting you either reduce the length or enable context compression.

[All OpenRouter endpoints](https://openrouter.ai/models) with 8k (8,192 tokens) or less context
length will default to using context compression. To disable this, pass
`plugins: [{"id": "context-compression", "enabled": false}]` in the request body.

The middle of the prompt is compressed because [LLMs pay less attention](https://arxiv.org/abs/2307.03172) to the middle of sequences.

Ask AI

Assistant

Responses are generated using AI and may contain mistakes.

Hi, I'm an AI assistant with access to documentation and other content.

Tip: You can toggle this pane with

`⌘`

+

`/`