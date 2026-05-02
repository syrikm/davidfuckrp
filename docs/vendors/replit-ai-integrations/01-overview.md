<!--
Source: Replit-internal skills (.local/skills/ai-integrations-*).
Fetched: 2026-05-02 — bundled with this repo, no external URL.
-->

# Replit AI Integrations — overview (informational only)

This document is included for completeness; **the AI Proxy Gateway never
calls Replit AI Integrations directly**. All inference traffic flows
through Friend-Proxy sub-nodes, which is enforced by the comment block
at the bottom of `artifacts/api-server/src/routes/proxy.ts` and by the
absence of `AI_INTEGRATIONS_*` env vars in production.

## Anthropic via Replit AI Integrations

- Skill: `.local/skills/ai-integrations-anthropic/SKILL.md`
- Compatible with the Anthropic SDK; base URL injected via the
  `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` env var.
- Supports the same `/v1/messages` shape as Anthropic-direct.

## OpenAI via Replit AI Integrations

- Skill: `.local/skills/ai-integrations-openai/SKILL.md`
- Compatible with the OpenAI SDK; base URL injected via the
  `AI_INTEGRATIONS_OPENAI_BASE_URL` env var.

## Gemini via Replit AI Integrations

- Skill: `.local/skills/ai-integrations-gemini/SKILL.md`
- Compatible with the Google GenAI SDK; base URL injected via the
  `AI_INTEGRATIONS_GEMINI_BASE_URL` env var.

## OpenRouter via Replit AI Integrations

- Skill: `.local/skills/ai-integrations-openrouter/SKILL.md`
- OpenAI-compatible surface; base URL injected via the
  `AI_INTEGRATIONS_OPENROUTER_BASE_URL` env var.

## Why the gateway does not use these

Routing through Friend-Proxy sub-nodes lets the gateway:

- Apply absolute provider routing (this audit's primary contract).
- Use cache-affinity routing across N nodes for prompt caching.
- Enforce a unified retry / health-check policy.
- Avoid coupling the gateway process to any single tenant's AI
  Integrations quotas.
