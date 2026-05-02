<!--
Source: https://cloud.google.com/vertex-ai/generative-ai/docs/reference/rest
Fetched: 2026-05-02 (summary)
Architecture note: reached via OpenRouter provider slug "google-vertex".
-->

# GCP Vertex AI — Regions and Endpoints

## Endpoint pattern

```
https://<region>-aiplatform.googleapis.com/v1/projects/<project>/locations/<region>/publishers/google/models/<model>:generateContent
https://<region>-aiplatform.googleapis.com/v1/projects/<project>/locations/<region>/publishers/google/models/<model>:streamGenerateContent
```

## Authentication

OAuth2 / service-account JWT (`Authorization: Bearer <access_token>`).

## Supported regions (selected)

`us-central1`, `us-east4`, `europe-west1`, `europe-west4`, `asia-northeast1`

## Cross-check relevance

This gateway pins requests to `google-vertex` via OpenRouter.
OpenRouter selects the Vertex region internally.  For region pinning, the full
OpenRouter sub-endpoint slug `google-vertex/us-central1` can be used via the
provider prefix `vertex/us-central1/model`.  The current gateway provider
table locks to base slug `google-vertex` only (all regions).

Source: https://cloud.google.com/vertex-ai/generative-ai/docs/reference/rest
