<!--
Source: https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference
Fetched: 2026-05-02T12:57:08.733Z
-->

[Skip to main content](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#main-content)

[![Google Cloud Documentation](https://www.gstatic.com/devrel-devsite/prod/v579073a50c63499824df5a68b8922367066583d283ef78fdade1028efdb4ceb5/clouddocs/images/lockup.svg)](https://docs.cloud.google.com/)

`/`

[Console](https://console.cloud.google.com/)Language

- [English](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference)
- [Deutsch](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference?hl=de)
- [Español](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference?hl=es)
- [Español – América Latina](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference?hl=es-419)
- [Français](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference?hl=fr)
- [Indonesia](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference?hl=id)
- [Italiano](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference?hl=it)
- [Português](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference?hl=pt)
- [Português – Brasil](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference?hl=pt-br)
- [עברית](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference?hl=he)
- [中文 – 简体](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference?hl=zh-cn)
- [中文 – 繁體](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference?hl=zh-tw)
- [日本語](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference?hl=ja)
- [한국어](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference?hl=ko)

[Sign in](https://docs.cloud.google.com/_d/signin?continue=https%3A%2F%2Fdocs.cloud.google.com%2Fvertex-ai%2Fgenerative-ai%2Fdocs%2Fmodel-reference%2Finference&prompt=select_account)

[![](https://docs.cloud.google.com/_static/clouddocs/images/icons/products/vertex-ai-color.svg)](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/overview)

- [Vertex AI](https://docs.cloud.google.com/vertex-ai/docs)
- [Generative AI on Vertex AI](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/overview)

[Start free](https://console.cloud.google.com/freetrial)

- On this page
- [Get started](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#get-started)
- [Supported models](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#supported-models)
- [Parameter list](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#parameters)
  - [Request body](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#request)
  - [Response body](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#response)
- [Examples](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#sample-requests)
  - [Text Generation](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#sample-requests-text-gen)
  - [Using multimodal prompt](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#sample-requests-text-gen-multimodal-prompt)
  - [Streaming text response](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#sample-requests-text-stream-response)
- [Model versions](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#model_versions)
- [What's next](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#whats_next)

Vertex AI is transitioning to become part of Gemini Enterprise Agent Platform. See the most up-to-date information in the [Agent Platform documentation](https://docs.cloud.google.com/gemini-enterprise-agent-platform).


- [Home](https://docs.cloud.google.com/)
- [Documentation](https://docs.cloud.google.com/docs)
- [AI and ML](https://docs.cloud.google.com/docs/ai-ml)
- [Vertex AI](https://docs.cloud.google.com/vertex-ai/docs)
- [Generative AI on Vertex AI](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/overview)
- [API reference](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/reference/rest)

Was this helpful?



 Send feedback



# Generate content with the Gemini API in Vertex AI    Stay organized with collections      Save and categorize content based on your preferences.

- On this page
- [Get started](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#get-started)
- [Supported models](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#supported-models)
- [Parameter list](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#parameters)
  - [Request body](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#request)
  - [Response body](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#response)
- [Examples](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#sample-requests)
  - [Text Generation](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#sample-requests-text-gen)
  - [Using multimodal prompt](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#sample-requests-text-gen-multimodal-prompt)
  - [Streaming text response](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#sample-requests-text-stream-response)
- [Model versions](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#model_versions)
- [What's next](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#whats_next)

Use `generateContent` or `streamGenerateContent` to generate content with
Gemini.

The Gemini model family includes models that work with multimodal
prompt requests. The term multimodal indicates that you can use more than one
modality, or type of input, in a prompt. Models that aren't multimodal accept
prompts only with text. Modalities can include text, audio, video, and more.

## Get started

To get started generating content with Gemini, do the following:

1. [Create a Google Cloud\\
account](https://console.cloud.google.com/freetrial?redirectPath=/marketplace/product/google/cloudaicompanion.googleapis.com).

2. Review this document to learn about the Gemini model
[request body](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#request), [parameters](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#parameters), and
[response body](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#response). To see some sample requests,
see [Examples](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#sample-requests).

3. To learn how to send a request to the Gemini API in Vertex AI by using
a programming language SDK or the REST API, see the [Gemini API in Vertex AI\\
quickstart](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/start/quickstarts/quickstart-multimodal).


## Supported models

All Gemini models support content generation.

## Parameter list

See [examples](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#sample-requests) for implementation details.

### Request body

See more code actions.

Light code theme

Dark code theme

```
{
  "cachedContent": string,
  "contents": [\
    {\
      "role": string,\
      "parts": [\
        {\
          // Union field data can be only one of the following:\
          "text": string,\
          "inlineData": {\
            "mimeType": string,\
            "data": string\
          },\
          "fileData": {\
            "mimeType": string,\
            "fileUri": string\
          },\
          // End of list of possible types for union field data.\
\
          "thought": boolean,\
          "thoughtSignature": string,\
          "videoMetadata": {\
            "startOffset": {\
              "seconds": integer,\
              "nanos": integer\
            },\
            "endOffset": {\
              "seconds": integer,\
              "nanos": integer\
            },\
            "fps": double\
          },\
          "mediaResolution": MediaResolution\
        }\
      ]\
    }\
  ],
  "systemInstruction": {
    "role": string,
    "parts": [\
      {\
        "text": string\
      }\
    ]
  },
  "tools": [\
    {\
      "functionDeclarations": [\
        {\
          "name": string,\
          "description": string,\
          "parameters": {\
            object (OpenAPI Object Schema)\
          }\
        }\
      ]\
    }\
  ],
  "safetySettings": [\
    {\
      "category": enum (HarmCategory),\
      "threshold": enum (HarmBlockThreshold)\
    }\
  ],
  "generationConfig": {
    "temperature": number,
    "topP": number,
    "topK": number,
    "candidateCount": integer,
    "maxOutputTokens": integer,
    "presencePenalty": float,
    "frequencyPenalty": float,
    "stopSequences": [\
      string\
    ],
    "responseMimeType": string,
    "responseSchema": schema,
    "seed": integer,
    "responseLogprobs": boolean,
    "logprobs": integer,
    "audioTimestamp": boolean,
    "thinkingConfig": {
      "thinkingBudget": integer,
      "thinkingLevel": enum
    },
    "mediaResolution": MediaResolution
  },
  "labels": {
    string: string
  }
}
```

The request body contains data with the following parameters:

| Parameters |
| --- |
| `cachedContent` | Optional:<br>`string`<br>The name of the cached content used as context to<br>serve the prediction. Format:<br>`projects/{project}/locations/{location}/cachedContents/{cachedContent}` |
| `contents` | Required: `Content`<br>The content of the current conversation with the model.<br>For single-turn queries, this is a single instance. For multi-turn queries, this is a repeated field that contains conversation history and the latest request. |
| `systemInstruction` | Optional: `Content`<br>Available for `gemini-2.0-flash` and `gemini-2.0-flash-lite`.<br>Instructions for the model to steer it toward better performance. For example, "Answer as concisely as possible" or "Don't use technical terms in your response".<br>The `text` strings count toward the token limit.<br>The `role` field of `systemInstruction` is ignored and doesn't affect the performance of the model. |
| `tools` | Optional. A piece of code that enables the system to interact with external systems to perform an action, or set of actions, outside of knowledge and scope of the model. See [Function calling](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/function-calling). |
| `toolConfig` | Optional. See [Function calling](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/function-calling). |
| `safetySettings` | Optional: `SafetySetting`<br>Per request settings for blocking unsafe content.<br>Enforced on `GenerateContentResponse.candidates`. |
| `generationConfig` | Optional: `GenerationConfig`<br>Generation configuration settings. |
| `labels` | Optional: `string`<br>Metadata that you can add to the API call in the format of key-value pairs. |

#### `contents`

The base structured data type containing multi-part content of a message.

This class consists of two main properties: `role` and `parts`. The `role`
property denotes the individual producing the content, while the `parts`
property contains multiple elements, each representing a segment of data within
a message.

| Parameters |
| --- |
| `role` | `string`<br>The identity of the entity that<br>creates the message. The following values are supported:<br>- `user`: This indicates that the message is sent by a real person, typically a user-generated message.<br>- `model`: This indicates that the message is generated by the model.<br>The `model` value is used to insert messages from the model into the conversation during multi-turn conversations. |
| `parts` | `Part`<br>A list of ordered parts that make up a single message. Different parts may have different [IANA MIME types](https://www.iana.org/assignments/media-types/media-types.xml).<br>For limits on the inputs, such as the maximum number of tokens or the number of images, see the model specifications on the [Google models](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/models) page.<br>To compute the number of tokens in your request, see [Get token count](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/get-token-count). |

#### `parts`

A data type containing media that is part of a multi-part `Content` message.

| Parameters |
| --- |
| `text` | Optional: `string`<br>A text prompt or code snippet. |
| `inlineData` | Optional: `Blob`<br>Inline data in raw bytes.<br>For `gemini-2.0-flash-lite` and `gemini-2.0-flash`, you can specify up to 3000 images by using `inlineData`. |
| `fileData` | Optional: `fileData`<br>Data stored in a file. |
| `functionCall` | Optional: `FunctionCall`.<br>It contains a string representing the `FunctionDeclaration.name` field and a structured JSON object containing any parameters for the function call predicted by the model.<br>See [Function calling](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/function-calling). |
| `functionResponse` | Optional: `FunctionResponse`.<br>The result output of a `FunctionCall` that contains a string representing the `FunctionDeclaration.name` field and a structured JSON object containing any output from the function call. It is used as context to the model.<br>See [Function calling](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/function-calling). |
| `thought` | Optional: `boolean`<br>Indicates whether the part represents the model's thought process or reasoning. |
| `thoughtSignature` | Optional: `string (bytes format)`<br>An opaque signature for the thought so it can be reused in subsequent requests. A base64-encoded string. |
| `videoMetadata` | Optional: `VideoMetadata`<br>For video input, the start and end offset of the video in [Duration](https://protobuf.dev/reference/protobuf/google.protobuf/#duration)<br>format, and the frame rate of the video . For example, to specify a 10<br>second clip starting at 1:00 with a frame rate of 10 frames per second,<br>set the following:<br> <br>- `"startOffset": { "seconds": 60 }`<br>- `"endOffset": { "seconds": 70 }`<br>- `"fps": 10.0`<br>The metadata should only be specified while the video data is presented<br>in `inlineData` or `fileData`. |
| `mediaResolution` | Optional: `MediaResolution`<br>Per-part media resolution for the input media. Controls how input media is processed. If specified, this overrides the `mediaResolution` setting in `generationConfig`.<br>`LOW` reduces tokens per image/video, possibly losing detail<br>but allowing longer videos in context. Supported values: `HIGH`, `MEDIUM`, `LOW`. |

#### `blob`

Content blob. If possible send as text rather than raw bytes.

| Parameters |
| --- |
| `mimeType` | `string`<br>The media type of the file specified in the `data` or `fileUri`<br>fields. Acceptable values include the following:<br>**Click to expand MIME types**<br>- `application/pdf`<br>- `audio/mpeg`<br>- `audio/mp3`<br>- `audio/wav`<br>- `image/png`<br>- `image/jpeg`<br>- `image/webp`<br>- `text/plain`<br>- `video/mov`<br>- `video/mpeg`<br>- `video/mp4`<br>- `video/mpg`<br>- `video/avi`<br>- `video/wmv`<br>- `video/mpegps`<br>- `video/flv`<br>For `gemini-2.0-flash-lite` and<br>`gemini-2.0-flash`, the maximum length of an audio<br>file is 8.4 hours and the maximum length of a video file (without audio)<br>is one hour. For more information, see Gemini [audio](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/audio-understanding#audio-requirements) and [video](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/video-understanding#video-requirements) requirements.<br> <br>Text files must be UTF-8 encoded. The contents of the text file count<br>toward the token limit.<br> <br>There is no limit on image resolution. |
| `data` | `bytes`<br>The [base64 encoding](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/image/base64-encode) of the image, PDF, or video<br>to include inline in the prompt. When including media inline, you must also specify the media<br>type (`mimeType`) of the data.<br>Size limit: 7 MB for images |

#### FileData

URI or web-URL data.

| Parameters |
| --- |
| `mimeType` | `string`<br>[IANA MIME type](https://www.iana.org/assignments/media-types/media-types.xml) of the data. |
| `fileUri` | `string`<br>The URI or URL of the file to include in the prompt. Acceptable values include the following:<br>- **Cloud Storage bucket URI:** The object must either be publicly readable or reside in<br>   the same Google Cloud project that's sending the request. For `gemini-2.0-flash`<br>   and `gemini-2.0-flash-lite`, the size limit is 2 GB.<br>- **HTTP URL:** The file URL must be publicly readable. You can specify one video file, one<br>   audio file, and up to 10 image files per request. Audio files, video files, and documents can't<br>   exceed 15 MB.<br>- **YouTube video URL:** The YouTube video must be either owned by the account that you used<br>   to sign in to the Google Cloud console or is public. Only one YouTube video URL is supported per<br>   request.<br>When specifying a `fileURI`, you must also specify the media type<br>(`mimeType`) of the file. If VPC Service Controls is enabled, specifying a media file<br>URL for `fileURI` is not supported. |

#### `functionCall`

A predicted `functionCall` returned from the model that contains a string
representing the `functionDeclaration.name` and a structured JSON object
containing the parameters and their values.

| Parameters |
| --- |
| `name` | `string`<br>The name of the function to call. |
| `args` | `Struct`<br>The function parameters and values in JSON object format.<br>See [Function calling](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/function-calling) for parameter details. |

#### `functionResponse`

The resulting output from a `FunctionCall` that contains a string representing the
`FunctionDeclaration.name`. Also contains a structured JSON object with the
output from the function (and uses it as context for the model). This should contain the
result of a `FunctionCall` made based on model prediction.

| Parameters |
| --- |
| `name` | `string`<br>The name of the function to call. |
| `response` | `Struct`<br>The function response in JSON object format. |

#### `videoMetadata`

Metadata describing the input video content.

| Parameters |
| --- |
| `startOffset` | Optional: `google.protobuf.Duration`<br>The start offset of the video. |
| `endOffset` | Optional: `google.protobuf.Duration`<br>The end offset of the video. |
| `fps` | Optional: `double`<br>The frame rate of the video sent to the model. Defaults to<br>`1.0` if not specified. The minimum accepted value is as low<br>as, but not including, `0.0`. The maximum value is<br>`24.0`. |

#### `safetySetting`

Safety settings.

| Parameters |
| --- |
| `category` | Optional: `HarmCategory`<br>The safety category to configure a threshold for. Acceptable values include the following:<br>**Click to expand safety categories**<br>- `HARM_CATEGORY_SEXUALLY_EXPLICIT`<br>- `HARM_CATEGORY_HATE_SPEECH`<br>- `HARM_CATEGORY_HARASSMENT`<br>- `HARM_CATEGORY_DANGEROUS_CONTENT` |
| `threshold` | Optional: `HarmBlockThreshold`<br>The threshold for blocking responses that could belong to the specified safety category based on probability.<br>- `OFF`<br>- `BLOCK_NONE`<br>- `BLOCK_LOW_AND_ABOVE`<br>- `BLOCK_MEDIUM_AND_ABOVE`<br>- `BLOCK_ONLY_HIGH` |
| `method` | Optional: `HarmBlockMethod`<br>Specify if the threshold is used for probability or severity score. If not specified, the threshold is used for probability score. |

#### `harmCategory`

Harm categories that block content.

| Parameters |
| --- |
| `HARM_CATEGORY_UNSPECIFIED` | The harm category is unspecified. |
| `HARM_CATEGORY_HATE_SPEECH` | The harm category is hate speech. |
| `HARM_CATEGORY_DANGEROUS_CONTENT` | The harm category is dangerous content. |
| `HARM_CATEGORY_HARASSMENT` | The harm category is harassment. |
| `HARM_CATEGORY_SEXUALLY_EXPLICIT` | The harm category is sexually explicit content. |

#### `harmBlockThreshold`

Probability thresholds levels used to block a response.

| Parameters |
| --- |
| `HARM_BLOCK_THRESHOLD_UNSPECIFIED` | Unspecified harm block threshold. |
| `BLOCK_LOW_AND_ABOVE` | Block low threshold and higher (i.e. block more). |
| `BLOCK_MEDIUM_AND_ABOVE` | Block medium threshold and higher. |
| `BLOCK_ONLY_HIGH` | Block only high threshold (i.e. block less). |
| `BLOCK_NONE` | Block none. |
| `OFF` | Switches off safety if all categories are turned OFF |

#### `harmBlockMethod`

A probability threshold that blocks a response based on a combination of
probability and severity.

| Parameters |
| --- |
| `HARM_BLOCK_METHOD_UNSPECIFIED` | The harm block method is unspecified. |
| `SEVERITY` | The harm block method uses both probability and severity scores. |
| `PROBABILITY` | The harm block method uses the probability score. |

#### `generationConfig`

Configuration settings used when generating the prompt.

| Parameters |
| --- |
| `temperature` | Optional: `float`<br>The range of values and default value is specific for each model.<br>See the [temperature ranges and\<br>default values table](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#temperature-ranges).<br>The temperature is used for sampling during response generation, which occurs when `topP`<br>and `topK` are applied. Temperature controls the degree of randomness in token selection.<br>Lower temperatures are good for prompts that require a less open-ended or creative response, while<br>higher temperatures can lead to more diverse or creative results. A temperature of `0`<br>means that the highest probability tokens are always selected. In this case, responses for a given<br>prompt are mostly deterministic, but a small amount of variation is still possible.<br>If the model returns a response that's too generic, too short, or the model gives a fallback<br>response, try increasing the temperature. If the model enters infinite generation, increasing the<br>temperature to at least `0.1` may lead to improved results.<br>`1.0` is the<br>recommended starting value for temperature.<br>- Range for `gemini-2.0-flash-lite`: `0.0 - 2.0` (default: `1.0`)<br>- Range for `gemini-2.0-flash`: `0.0 - 2.0` (default: `1.0`)<br>For more information, see<br>[Content generation parameters](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/content-generation-parameters#temperature). |
| `topP` | Optional: `float`<br>If specified, nucleus sampling is used.<br>[Top-P](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/content-generation-parameters#top-p) changes how the model selects tokens for output. Tokens are selected from the most (see top-K) to least probable until the sum of their probabilities equals the top-P value. For example, if tokens A, B, and C have a probability of 0.3, 0.2, and 0.1 and the top-P value is `0.5`, then the model will select either A or B as the next token by using temperature and excludes C as a candidate.<br>Specify a lower value for less random responses and a higher value for more random responses.<br>- Range: `0.0 - 1.0`<br>- Default for `gemini-2.0-flash-lite`: `0.95`<br>- Default for `gemini-2.0-flash`: `0.95` |
| `candidateCount` | Optional: `int`<br>The number of response variations to return. For each request, you're charged for the<br>output tokens of all candidates, but are only charged once for the input tokens.<br>Specifying multiple candidates is a Preview feature that works with `generateContent`<br>(`streamGenerateContent` is not supported). The following models are supported:<br>- `gemini-2.0-flash-lite`: `1`-`8`, default: `1`<br>- `gemini-2.0-flash`: `1`-`8`, default: `1` |
| `maxOutputTokens` | Optional: int<br>Maximum number of tokens that can be generated in the response. A token is<br>approximately four characters. 100 tokens correspond to roughly 60-80 words.<br>Specify a lower value for shorter responses and a higher value for potentially longer<br>responses.<br>For more information, see<br>[Content generation parameters](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/content-generation-parameters#max-output-tokens). |
| `stopSequences` | Optional: `List[string]`<br>Specifies a list of strings that tells the model to stop generating text if one<br>of the strings is encountered in the response. If a string appears multiple<br>times in the response, then the response truncates where it's first encountered.<br>The strings are case-sensitive.<br>For example, if the following is the returned response when `stopSequences` isn't specified:<br>`public<br>static string reverse(string myString)`<br>Then the returned response with `stopSequences` set to `["Str",<br>"reverse"]` is:<br>`public static string`<br>Maximum 5 items in the list.<br>For more information, see<br>[Content generation parameters](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/content-generation-parameters#stop-sequences). |
| `presencePenalty` | Optional: `float`<br>Positive penalties.<br>Positive values penalize tokens that already appear in the generated text, increasing the probability of generating more diverse content.<br>The maximum value for `presencePenalty` is up to, but not including, `2.0`. Its minimum value is `-2.0`. |
| `frequencyPenalty` | Optional: `float`<br>Positive values penalize tokens that repeatedly appear in the generated text, decreasing the probability of repeating content.<br>This maximum value for `frequencyPenalty` is up to, but not including, `2.0`. Its minimum value is `-2.0`. |
| `responseMimeType` | Optional: `string (enum)`<br>The output response MIME type of<br>the generated candidate text.<br>The following MIME types are<br>supported:<br>- `application/json`: JSON response in the candidates.<br>- `text/plain` (default): Plain text output.<br>- `text/x.enum`: For classification tasks, output an enum value<br>   as defined in the response schema.<br>Specify the appropriate response type to avoid unintended behaviors. For<br>example, if you require a JSON-formatted response, specify<br>`application/json` and not `text/plain`.<br>`text/plain` isn't supported for use with `responseSchema`. |
| `responseSchema` | Optional: [schema](https://docs.cloud.google.com/vertex-ai/docs/reference/rest/v1/projects.locations.cachedContents#Schema)<br>The schema that generated candidate text must follow. For more<br>information, see [Control\<br>generated output](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/control-generated-output).<br>To use this parameter, you must specify a supported mime type other<br>than `text/plain` for the `responseMimeType`<br>parameter. |
| `seed` | Optional: `int`<br>When seed is fixed to a specific value, the model makes a best effort to provide<br>the same response for repeated requests. Deterministic output isn't guaranteed.<br>Also, changing the model or parameter settings, such as the temperature, can<br>cause variations in the response even when you use the same seed value. By<br>default, a random seed value is used. |
| `responseLogprobs` | Optional: `boolean`<br>If true, returns the log probabilities of the tokens that were chosen<br>by the model at each step. By default, this parameter is set to<br>`false`. |
| `logprobs` | Optional: `int`<br>Returns the log probabilities of the top candidate tokens at each generation step. The model's<br>chosen token might not be the same as the top candidate token at each step. Specify the number of<br>candidates to return by using an integer value in the range of `1`-`20`.<br>You must enable<br>[`responseLogprobs`](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#responseLogprobs) to use<br>this parameter. |
| `audioTimestamp` | Optional: `boolean`<br>Available for the<br>following models:<br>- Gemini 2.0 Flash-Lite<br>- Gemini 2.0 Flash<br>Enables timestamp understanding for audio-only files.<br>This is a preview feature. |
| `thinkingConfig` | Optional: `object`<br>Configuration for the model's [thinking process](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/thinking) for Gemini 2.5 and higher models.<br>The `thinkingConfig` object contains the following fields:<br>- `thinkingBudget`: `integer`. By default, the model automatically controls how much it thinks up to a maximum of `8,192` tokens.<br>- `thinkingLevel`: `enum`. Controls the amount of internal reasoning the model performs before generating a response. Higher levels may improve quality on complex tasks but increase latency and cost. Supported values are `LOW` and `HIGH`. |
| `mediaResolution` | Optional: `MediaResolution`<br>Controls how input media is processed. `LOW` reduces tokens per image/video, possibly losing detail but allowing longer videos in context. Supported values: `HIGH`, `MEDIUM`, `LOW`. |

### Response body

See more code actions.

Light code theme

Dark code theme

```
{
  "candidates": [\
    {\
      "content": {\
        "parts": [\
          {\
            "text": string\
          }\
        ]\
      },\
      "finishReason": enum (FinishReason),\
      "safetyRatings": [\
        {\
          "category": enum (HarmCategory),\
          "probability": enum (HarmProbability),\
          "blocked": boolean\
        }\
      ],\
      "citationMetadata": {\
        "citations": [\
          {\
            "startIndex": integer,\
            "endIndex": integer,\
            "uri": string,\
            "title": string,\
            "license": string,\
            "publicationDate": {\
              "year": integer,\
              "month": integer,\
              "day": integer\
            }\
          }\
        ]\
      },\
      "avgLogprobs": double,\
      "logprobsResult": {\
        "topCandidates": [\
          {\
            "candidates": [\
              {\
                "token": string,\
                "logProbability": float\
              }\
            ]\
          }\
        ],\
        "chosenCandidates": [\
          {\
            "token": string,\
            "logProbability": float\
          }\
        ]\
      }\
    }\
  ],
  "usageMetadata": {
    "promptTokenCount": integer,
    "candidatesTokenCount": integer,
    "totalTokenCount": integer
  },
  "modelVersion": string
}
```

| Response element | Description |
| --- | --- |
| `modelVersion` | The model and version used for generation. For example:<br> `gemini-2.0-flash-lite-001`. |
| `text` | The generated text. |
| `finishReason` | The reason why the model stopped generating tokens. If empty, the model<br> has not stopped generating the tokens. Because the response uses the<br> prompt for context, it's not possible to change the behavior of how the<br> model stops generating tokens.<br> <br>- `FINISH_REASON_STOP`: Natural stop point of the model or provided stop sequence.<br>- `FINISH_REASON_MAX_TOKENS`: The maximum number of tokens as specified in the request was reached.<br>- `FINISH_REASON_SAFETY`: Token generation was stopped because the response was flagged for safety reasons. Note that `Candidate.content` is empty if content filters block the output.<br>- `FINISH_REASON_RECITATION`: The token generation was stopped because the response was flagged for unauthorized citations. <br>- `FINISH_REASON_BLOCKLIST`: Token generation was stopped because the response includes blocked terms.<br>- `FINISH_REASON_PROHIBITED_CONTENT`: Token generation was stopped because the response was flagged for prohibited content, such as child sexual abuse material (CSAM).<br>- `FINISH_REASON_IMAGE_PROHIBITED_CONTENT`: Token generation was stopped because the image provided in the prompt was flagged for prohibited content.<br>- `FINISH_REASON_NO_IMAGE`: Token generation was stopped because an image was expected in the prompt, but none was provided.<br>- `FINISH_REASON_SPII`: Token generation was stopped because the response was flagged for sensitive personally identifiable information (SPII).<br>- `FINISH_REASON_MALFORMED_FUNCTION_CALL`: Candidates were blocked because of malformed and unparsable function call.<br>- `FINISH_REASON_OTHER`: All other reasons that stopped the token<br>- `FINISH_REASON_UNSPECIFIED`: The finish reason is unspecified. |
| `category` | The safety category to configure a threshold for. Acceptable values include the following:<br>**Click to expand safety categories**<br>- `HARM_CATEGORY_SEXUALLY_EXPLICIT`<br>- `HARM_CATEGORY_HATE_SPEECH`<br>- `HARM_CATEGORY_HARASSMENT`<br>- `HARM_CATEGORY_DANGEROUS_CONTENT` |
| `probability` | The harm probability levels in the content.<br> <br>- `HARM_PROBABILITY_UNSPECIFIED`<br>- `NEGLIGIBLE`<br>- `LOW`<br>- `MEDIUM`<br>- `HIGH` |
| `blocked` | A boolean flag associated with a safety attribute that indicates if the<br> model's input or output was blocked. |
| `startIndex` | An integer that specifies where a citation starts in the `content`. The<br>`startIndex` is in bytes and calculated from the response encoded in UTF-8. |
| `endIndex` | An integer that specifies where a citation ends in the `content`. The<br>`endIndex` is in bytes and calculated from the response encoded in UTF-8. |
| `url` | The URL of a citation source. Examples of a URL source might be a news website or<br>a GitHub repository. |
| `title` | The title of a citation source. Examples of source titles might be that of a<br>news article or a book. |
| `license` | The license associated with a citation. |
| `publicationDate` | The date a citation was published. Its valid formats are<br>`YYYY`, `YYYY-MM`, and `YYYY-MM-DD`. |
| `avgLogprobs` | Average log probability of the candidate. |
| `logprobsResult` | Returns the top candidate tokens (`topCandidates`) and the<br> actual chosen tokens (`chosenCandidates`) at each step. |
| `token` | Generative AI models break down text data into tokens for processing,<br> which can be characters, words, or phrases. |
| `logProbability` | A log probability value that indicates the model's confidence for a<br> particular token. |
| `promptTokenCount` | Number of tokens in the request. |
| `candidatesTokenCount` | Number of tokens in the response(s). |
| `totalTokenCount` | Number of tokens in the request and response(s). |

## Examples

### Text Generation

Generate a text response from a text input.

[Gen AI SDK for Python](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#gen-ai-sdk-for-python)[Python (OpenAI)](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#python-openai)[Go](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#go)More

See more code actions.

[View on GitHub](https://github.com/GoogleCloudPlatform/python-docs-samples/blob/HEAD/genai/text_generation/textgen_with_txt.py)

Light code theme

Dark code theme

Send feedback

```
from google import genai
from google.genai.types import HttpOptions

client = genai.Client(http_options=HttpOptions(api_version="v1"))
response = client.models.generate_content(
    model="gemini-2.5-flash",
    contents="How does AI work?",
)
print(response.text)
# Example response:
# Okay, let's break down how AI works. It's a broad field, so I'll focus on the ...
#
# Here's a simplified overview:
# ...
```

You can call the Inference API by using the OpenAI library. For more information, see
[Call Vertex AI models by using the OpenAI library](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/call-vertex-using-openai-library).






See more code actions.

[View on GitHub](https://github.com/GoogleCloudPlatform/python-docs-samples/blob/HEAD/generative_ai/chat_completions/chat_completions_non_streaming_text.py)

Light code theme

Dark code theme

Send feedback

```
from google.auth import default
import google.auth.transport.requests

import openai

# TODO(developer): Update and un-comment below lines
# project_id = "PROJECT_ID"
# location = "us-central1"

# Programmatically get an access token
credentials, _ = default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
credentials.refresh(google.auth.transport.requests.Request())

# OpenAI Client
client = openai.OpenAI(
    base_url=f"https://{location}-aiplatform.googleapis.com/v1/projects/{project_id}/locations/{location}/endpoints/openapi",
    api_key=credentials.token,
)

response = client.chat.completions.create(
    model="google/gemini-2.0-flash-001",
    messages=[{"role": "user", "content": "Why is the sky blue?"}],
)

print(response)
```

See more code actions.

[View on GitHub](https://github.com/GoogleCloudPlatform/golang-samples/blob/HEAD/genai/text_generation/textgen_with_txt.go)

Light code theme

Dark code theme

Send feedback

```
import (
	"context"
	"fmt"
	"io"

	"google.golang.org/genai"
)

// generateWithText shows how to generate text using a text prompt.
func generateWithText(w io.Writer) error {
	ctx := context.Background()

	client, err := genai.NewClient(ctx, &genai.ClientConfig{
		HTTPOptions: genai.HTTPOptions{APIVersion: "v1"},
	})
	if err != nil {
		return fmt.Errorf("failed to create genai client: %w", err)
	}

	resp, err := client.Models.GenerateContent(ctx,
		"gemini-2.5-flash",
		genai.Text("How does AI work?"),
		nil,
	)
	if err != nil {
		return fmt.Errorf("failed to generate content: %w", err)
	}

	respText := resp.Text()

	fmt.Fprintln(w, respText)
	// Example response:
	// That's a great question! Understanding how AI works can feel like ...
	// ...
	// **1. The Foundation: Data and Algorithms**
	// ...

	return nil
}
```

### Using multimodal prompt

Generate a text response from a multimodal input, such as text and an image.

[Gen AI SDK for Python](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#gen-ai-sdk-for-python)[Python (OpenAI)](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#python-openai)[Go](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#go)More

See more code actions.

[View on GitHub](https://github.com/GoogleCloudPlatform/python-docs-samples/blob/HEAD/genai/text_generation/textgen_with_txt_img.py)

Light code theme

Dark code theme

Send feedback

```
from google import genai
from google.genai.types import HttpOptions, Part

client = genai.Client(http_options=HttpOptions(api_version="v1"))
response = client.models.generate_content(
    model="gemini-2.5-flash",
    contents=[\
        "What is shown in this image?",\
        Part.from_uri(\
            file_uri="gs://cloud-samples-data/generative-ai/image/scones.jpg",\
            mime_type="image/jpeg",\
        ),\
    ],
)
print(response.text)
# Example response:
# The image shows a flat lay of blueberry scones arranged on parchment paper. There are ...
```

You can call the Inference API by using the OpenAI library. For more information, see
[Call Vertex AI models by using the OpenAI library](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/call-vertex-using-openai-library).






See more code actions.

[View on GitHub](https://github.com/GoogleCloudPlatform/python-docs-samples/blob/HEAD/generative_ai/chat_completions/chat_completions_non_streaming_image.py)

Light code theme

Dark code theme

Send feedback

```

from google.auth import default
import google.auth.transport.requests

import openai

# TODO(developer): Update and un-comment below lines
# project_id = "PROJECT_ID"
# location = "us-central1"

# Programmatically get an access token
credentials, _ = default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
credentials.refresh(google.auth.transport.requests.Request())

# OpenAI Client
client = openai.OpenAI(
    base_url=f"https://{location}-aiplatform.googleapis.com/v1/projects/{project_id}/locations/{location}/endpoints/openapi",
    api_key=credentials.token,
)

response = client.chat.completions.create(
    model="google/gemini-2.0-flash-001",
    messages=[\
        {\
            "role": "user",\
            "content": [\
                {"type": "text", "text": "Describe the following image:"},\
                {\
                    "type": "image_url",\
                    "image_url": "gs://cloud-samples-data/generative-ai/image/scones.jpg",\
                },\
            ],\
        }\
    ],
)

print(response)
```

See more code actions.

[View on GitHub](https://github.com/GoogleCloudPlatform/golang-samples/blob/HEAD/genai/text_generation/textgen_with_txt_img.go)

Light code theme

Dark code theme

Send feedback

```
import (
	"context"
	"fmt"
	"io"

	genai "google.golang.org/genai"
)

// generateWithTextImage shows how to generate text using both text and image input
func generateWithTextImage(w io.Writer) error {
	ctx := context.Background()

	client, err := genai.NewClient(ctx, &genai.ClientConfig{
		HTTPOptions: genai.HTTPOptions{APIVersion: "v1"},
	})
	if err != nil {
		return fmt.Errorf("failed to create genai client: %w", err)
	}

	modelName := "gemini-2.5-flash"
	contents := []*genai.Content{
		{Parts: []*genai.Part{
			{Text: "What is shown in this image?"},
			{FileData: &genai.FileData{
				// Image source: https://storage.googleapis.com/cloud-samples-data/generative-ai/image/scones.jpg
				FileURI:  "gs://cloud-samples-data/generative-ai/image/scones.jpg",
				MIMEType: "image/jpeg",
			}},
		},
			Role: genai.RoleUser},
	}

	resp, err := client.Models.GenerateContent(ctx, modelName, contents, nil)
	if err != nil {
		return fmt.Errorf("failed to generate content: %w", err)
	}

	respText := resp.Text()

	fmt.Fprintln(w, respText)

	// Example response:
	// The image shows an overhead shot of a rustic, artistic arrangement on a surface that ...

	return nil
}
```

### Streaming text response

Generate a streaming model response from a text input.

[Gen AI SDK for Python](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#gen-ai-sdk-for-python)[Python (OpenAI)](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#python-openai)[Go](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference#go)More

See more code actions.

[View on GitHub](https://github.com/GoogleCloudPlatform/python-docs-samples/blob/HEAD/genai/text_generation/textgen_with_txt_stream.py)

Light code theme

Dark code theme

Send feedback

```
from google import genai
from google.genai.types import HttpOptions

client = genai.Client(http_options=HttpOptions(api_version="v1"))

for chunk in client.models.generate_content_stream(
    model="gemini-2.5-flash",
    contents="Why is the sky blue?",
):
    print(chunk.text, end="")
# Example response:
# The
#  sky appears blue due to a phenomenon called **Rayleigh scattering**. Here's
#  a breakdown of why:
# ...
```

You can call the Inference API by using the OpenAI library. For more information, see
[Call Vertex AI models by using the OpenAI library](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/call-vertex-using-openai-library).






See more code actions.

[View on GitHub](https://github.com/GoogleCloudPlatform/python-docs-samples/blob/HEAD/generative_ai/chat_completions/chat_completions_streaming_text.py)

Light code theme

Dark code theme

Send feedback

```
from google.auth import default
import google.auth.transport.requests

import openai

# TODO(developer): Update and un-comment below lines
# project_id = "PROJECT_ID"
# location = "us-central1"

# Programmatically get an access token
credentials, _ = default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
credentials.refresh(google.auth.transport.requests.Request())

# OpenAI Client
client = openai.OpenAI(
    base_url=f"https://{location}-aiplatform.googleapis.com/v1/projects/{project_id}/locations/{location}/endpoints/openapi",
    api_key=credentials.token,
)

response = client.chat.completions.create(
    model="google/gemini-2.0-flash-001",
    messages=[{"role": "user", "content": "Why is the sky blue?"}],
    stream=True,
)
for chunk in response:
    print(chunk)
```

See more code actions.

[View on GitHub](https://github.com/GoogleCloudPlatform/golang-samples/blob/HEAD/genai/text_generation/textgen_with_txt_stream.go)

Light code theme

Dark code theme

Send feedback

```
import (
	"context"
	"fmt"
	"io"

	genai "google.golang.org/genai"
)

// generateWithTextStream shows how to generate text stream using a text prompt.
func generateWithTextStream(w io.Writer) error {
	ctx := context.Background()

	client, err := genai.NewClient(ctx, &genai.ClientConfig{
		HTTPOptions: genai.HTTPOptions{APIVersion: "v1"},
	})
	if err != nil {
		return fmt.Errorf("failed to create genai client: %w", err)
	}

	modelName := "gemini-2.5-flash"
	contents := genai.Text("Why is the sky blue?")

	for resp, err := range client.Models.GenerateContentStream(ctx, modelName, contents, nil) {
		if err != nil {
			return fmt.Errorf("failed to generate content: %w", err)
		}

		chunk := resp.Text()

		fmt.Fprintln(w, chunk)
	}

	// Example response:
	// The
	//  sky is blue
	//  because of a phenomenon called **Rayleigh scattering**. Here's the breakdown:
	// ...

	return nil
}
```

## Model versions

To use the [auto-updated version](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versioning#auto-updated-version),
specify the model name without the trailing version number, for example `gemini-2.0-flash` instead of `gemini-2.0-flash-001`.

For more information, see [Gemini model versions and lifecycle](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versioning#gemini-model-versions).

## What's next

- Learn more about the [Gemini API in Vertex AI](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/gemini).
- Learn more about [Function\\
calling](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/function-calling).
- Learn more about [Grounding responses for Gemini models](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/ground-gemini).

Was this helpful?



 Send feedback



Except as otherwise noted, the content of this page is licensed under the [Creative Commons Attribution 4.0 License](https://creativecommons.org/licenses/by/4.0/), and code samples are licensed under the [Apache 2.0 License](https://www.apache.org/licenses/LICENSE-2.0). For details, see the [Google Developers Site Policies](https://developers.google.com/site-policies). Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2026-04-29 UTC.


Need to tell us more?






\[\[\["Easy to understand","easyToUnderstand","thumb-up"\],\["Solved my problem","solvedMyProblem","thumb-up"\],\["Other","otherUp","thumb-up"\]\],\[\["Hard to understand","hardToUnderstand","thumb-down"\],\["Incorrect information or sample code","incorrectInformationOrSampleCode","thumb-down"\],\["Missing the information/samples I need","missingTheInformationSamplesINeed","thumb-down"\],\["Other","otherDown","thumb-down"\]\],\["Last updated 2026-04-29 UTC."\],\[\],\[\]\]