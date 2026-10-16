# Bank IB | Infobip WhatsApp proof of concept

An English-language fictional customer-service demo for the Infobip Solutions Engineering assignment. This repository contains the **external Node.js mock API** and fictional procedures. The WhatsApp chatbot, buttons, human-agent queue, and analytics are configured separately in Infobip; their settings are not exported here.

The required journey is: request a CPF, validate its format and check digits through the mock API, collect or confirm name and email, allow **Confirm** or **Change**, then transfer the confirmed conversation and collected information to a human agent. A menu-free Gemini assistant and an opt-in outbound **phone** call through Infobip Calls API/SIP are optional extensions. The call is a regular phone call, not WhatsApp Business Calling. This repository does not implement post-call transcripts, summaries, or email delivery.

AI support and voice are optional extensions to the required CPF, confirmation and human-transfer journey.

## Run and deploy

Use **Node.js 20 or newer**. In the repository root:

```bash
npm install
npm test
npm start
```

Use `GET http://localhost:3000/health` to check the process. The base URL (`/`) returns HTTP 404 by design. To deploy on Render, connect the repository as a **Web Service**, select Node, set **Build Command** to `npm install` and **Start Command** to `npm start`, and add the environment values described in [`.env.example`](.env.example). The service binds Render's `PORT` on `0.0.0.0`. Do not upload a populated `.env` or paste provider API keys into Answers.

The server requires no credentials for CPF lookup: submit **synthetic CPF values only**. The assistant requires Gemini and an application token. Outbound calls remain disabled until explicitly configured.

## API contract

| Method and route | Purpose | Authentication | Status |
| --- | --- | --- | --- |
| `GET /health` | Returns `{ "ok": true, "voiceEnabled": false }` when voice is disabled. | None | Implemented. |
| `POST /customers/lookup` | Checks CPF format and digits and searches a fictional one-record registry. | None; test data only | Implemented. |
| `POST /assistant/ask` | Chooses a fictional procedure and returns an English answer, routing and priority. | `x-ib-demo-token: <ASSISTANT_WEBHOOK_TOKEN>` | Implemented; general questions require Gemini. |
| `POST /voice/start-conversation` | Starts an opt-in outbound `PHONE` call to the allowlisted number. | Same application token | Code implemented; live integration unverified. |
| `POST /webhooks/infobip/calls` | On `CALL_ESTABLISHED`, requests an Infobip SIP dialog. | HTTP Basic credentials in Infobip event subscription | Code implemented; live integration unverified. |
| `POST /webhooks/openai` | Verifies webhook signature and accepts an incoming Realtime SIP call. | Signed OpenAI webhook | Code implemented; live integration unverified. |

### CPF lookup

Send `POST /customers/lookup` with `Content-Type: application/json` and `{ "cpf": "123.456.789-09" }`. HTTP 200 responses:

```json
{"cpfValid":"YES","registered":"YES","name":"Ana Demo","email":"ana.demo@example.com"}
```

```json
{"cpfValid":"YES","registered":"NO"}
```

```json
{"cpfValid":"NO","registered":"NO"}
```

Synthetic test cases: `123.456.789-09` is registered; `987.654.321-00` is valid but unregistered; `111.111.111-11` is invalid. Missing or non-string CPF receives HTTP 400. This registry does **not** authenticate customers or check a government database.

A format regex accepts 11 digits or `ddd.ddd.ddd-dd`; another rejects repeated digits. The code calculates check digits using `L = 10*d1 + 9*d2 + ... + 2*d9` and `M = 10*d2 + 9*d3 + ... + 2*d10`, following [this explanation of the CPF algorithm](https://www.cnnbrasil.com.br/nacional/saiba-o-que-diz-o-numero-do-seu-cpf/). The next digit is `0` when the remainder modulo 11 is `0` or `1`; otherwise it is `11 - remainder`. For the registered sample, `L = 210` produces `d10 = 0` and `M = 244` produces `d11 = 9`. Regex checks syntax; arithmetic checks validity.

### Assistant and Answers mapping

Set `GEMINI_API_KEY` and `ASSISTANT_WEBHOOK_TOKEN` in Render. Use only the latter in the Answers API element's `x-ib-demo-token` header. Call `POST https://YOUR-SERVICE.onrender.com/assistant/ask` with JSON key `question` mapped to an Answers text attribute such as `CustomerQuestion`:

```json
{"question":"My card purchase was declined. What should I check?"}
```

Map the parsed response using `$.intent`, `$.answer`, `$.handoff`, `$.agent`, `$.process`, `$.priority`, `$.offerVoice`, and `$.caseSummary` to Answers text attributes. Verify the paths against the **parsed JSON body** in Answers: a raw HTTP preview may wrap `body` as a JSON string. `priority=URGENT` indicates a lost card or suspected fraud and requires immediate human transfer. `handoff=YES` means show `answer`, then use **To Agent**. `offerVoice=YES` applies when `handoff=NO`: the customer can keep chatting or explicitly accept a phone call; declining returns to the question loop. If the customer still needs help, use **To Agent**. `offerVoice=YES` does not imply a call took place.

Card-loss, suspected-fraud and explicit human requests use hard-coded safe responses. General questions call Gemini, using fictional `knowledge/workflows.json` procedures. Individual balances, debt amounts and payment investigations go to a human; no production bank data or action API exists here. Keep a human fallback for Gemini/API failures. Answers must orchestrate buttons, confirmations, chat loops, and transfers: the Node server does not create them.

### Optional outbound phone call

The code includes a gated integration for a **regular phone call**. Enable it only after setting every required value in `.env.example`, configuring an Infobip Calls Configuration and voice event subscription, setting up the SIP trunk and OpenAI Realtime webhook, and testing with the allowlisted recipient. `/health` reports `voiceEnabled=true` when required environment values are present; this does **not** verify external connections or prove a call worked.

After the customer accepts, Answers may call `POST /voice/start-conversation` with the application token and:

```json
{"to":"5511999999999","consent":"YES","caseSummary":"Customer asked about a declined card purchase"}
```

`to` must match `DEMO_ALLOWED_PHONE` exactly in international digits. A successful request returns HTTP 202 with `caseId`, `callId`, `status: "CALLING"`, and `channel: "PHONE"`. HTTP 202 means a call was requested, not that it was answered. Infobip events trigger the SIP dialog, and the OpenAI webhook accepts the incoming SIP leg with English voice instructions. Call correlations are stored in memory; a restart can interrupt callback processing. There is no durable transcript or post-call recap.

In the Infobip event subscription, set **Basic authentication**: username `INFOBIP_EVENTS_USERNAME`, password `INFOBIP_EVENTS_TOKEN`, webhook URL `https://YOUR-SERVICE.onrender.com/webhooks/infobip/calls`. This password is separate from `ASSISTANT_WEBHOOK_TOKEN` and `INFOBIP_API_KEY`. The OpenAI webhook at `/webhooks/openai` uses `OPENAI_WEBHOOK_SECRET` from OpenAI's webhook configuration. Never send Gemini or OpenAI keys in Infobip webhook headers.

The [Infobip Calls API guide](https://www.infobip.com/docs/voice-and-video/calls) describes configurations, event subscriptions and SIP dialogs after `CALL_ESTABLISHED`. Its [subscriptions authentication guide](https://www.infobip.com/docs/subscriptions/manage/authentication-settings) documents Basic credentials. [Answers-to-Conversations documentation](https://www.infobip.com/docs/answers/integrations/conversations) explains **To Agent** and agent-visible attributes. Compare actual voice event JSON from the subscription against the handler before the live demo: automated tests simulate only one event shape.

## Live demonstration checklist

1. In Answers, try an invalid CPF, a valid unregistered CPF and the valid registered sample. Show how the API response populates chatbot attributes.
2. Collect or confirm name and email, choose **Change** to edit a value, then return to the confirmation and choose **Confirm**.
3. Immediately hand over to a person with **To Agent**; show the confirmed attributes and conversation in the agent's Conversations workspace.
4. Show available Infobip operational analytics. If you present the optional AI or voice path, test it separately and distinguish target metrics from measured results.

## Known gaps and evidence

- The repository contains no Answers chatbot export, WhatsApp sender setup, Conversations queue/seat, proof of human handoff, or analytics setup. Verify them in the Infobip portal using the checklist above.
- The basic assignment requires human transfer **after confirmation**. If presenting optional AI support, demonstrate the required transfer path independently.
- The API sends no email or WhatsApp follow-up, records no calls, and creates no transcript or post-call summary. It has no real customer database, bank authentication, live financial records, or production retention policy.
- Tests cover CPF, a synthetic lookup, urgent routing and a mocked voice event. They do not establish live Infobip, Gemini, SIP trunk or OpenAI compatibility.
