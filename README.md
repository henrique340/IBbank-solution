# Bank IB mock customer API

This demo API validates CPF check digits and simulates customer registration for an Infobip WhatsApp chatbot. The implementation and responses are in English. It does **not** check whether a CPF exists in the Receita Federal database.

## Run

Node.js 18 or newer; no dependencies to install:

```bash
npm start
```

## Publish on Render with an HTTPS URL

1. Create a GitHub repository. Upload the *contents* of this folder (`server.js`, `package.json`, `knowledge/`, `README.md`) to the repository root. If you keep the folder inside the repository, set Render's **Root Directory** to that folder instead.
2. In Render, select **New > Web Service** and connect the GitHub repository.
3. Set **Language** to `Node`, **Build Command** to `npm install`, and **Start Command** to `npm start`. Select a compute plan, then create the web service.
4. Copy the assigned URL, such as `https://bank-ib-mock-api.onrender.com`. Test the `POST /customers/lookup` endpoint; opening the base URL in a browser produces a 404 because this demo only provides POST endpoints.

```bash
curl -X POST https://YOUR-SERVICE.onrender.com/customers/lookup \
  -H 'Content-Type: application/json' \
  -d '{"cpf":"123.456.789-09"}'
```

Render sets the `PORT` environment variable; the server binds it on `0.0.0.0`. Free services may take extra time to answer their first request after inactivity. Use sample CPF data only: this demo endpoint is publicly accessible and has no authentication.

## Lookup endpoint

`POST http://localhost:3000/customers/lookup`

Request:

```json
{"cpf":"123.456.789-09"}
```

Possible responses (HTTP 200):

```json
{"cpfValid":"YES","registered":"YES","name":"Ana Demo","email":"ana.demo@example.com"}
```

```json
{"cpfValid":"YES","registered":"NO"}
```

```json
{"cpfValid":"NO","registered":"NO"}
```

Demo inputs: `123.456.789-09` is registered; `987.654.321-00` is valid but unregistered; `111.111.111-11` is invalid. For missing or non-string `cpf`, the API responds with HTTP 400.

## CPF algorithm

The CPF format is checked with a regular expression, followed by check-digit calculation following [CNN Brasil's explanation](https://www.cnnbrasil.com.br/nacional/saiba-o-que-diz-o-numero-do-seu-cpf/):

The format regex accepts `12345678909` or `123.456.789-09`; another regex rejects 11 identical digits. Regex alone cannot validate the check digits, so the code then calculates `L` and `M`.

1. Reject repeated-digit CPFs such as `111.111.111-11`.
2. Compute `L = 10*d1 + 9*d2 + ... + 2*d9` and `r1 = L % 11`. The tenth digit is `0` if `r1` is `0` or `1`, otherwise `11 - r1`.
3. Compute `M = 10*d2 + 9*d3 + ... + 2*d10` and `r2 = M % 11`. The eleventh digit is `0` if `r2` is `0` or `1`, otherwise `11 - r2`.

For `123.456.789-09`, `L = 210`, `r1 = 1`, so `d10 = 0`; `M = 244`, `r2 = 2`, so `d11 = 9`.

The article gives the `0`/`1` rule explicitly for the tenth digit but omits that edge case for the eleventh. The implementation applies the same rule to both digits so every computed check digit remains a single decimal digit.

In `server.js`, the variables `d1` through `d11`, `L`, and `M` follow the article's notation directly.

## Infobip chatbot

Configure a REST API call for this endpoint after collecting the CPF in Answers. If `cpfValid` is `NO`, ask the user to try again. If `registered` is `YES`, show the stored name and email for confirmation. Otherwise, collect name and email from the user and continue the mock onboarding flow.

## Menu-free assistant using fictional Bank IB procedures

The separate `POST /assistant/ask` endpoint accepts a free-form customer question and identifies the most relevant process from `knowledge/workflows.json`. Gemini composes a useful original answer in **English** using that fictional procedure; the API returns the process identifier, owner, urgency, answer and human handoff decision. Customers are not required to select a topic. Lost-card, fraud, explicit human-agent and voice requests are handled immediately without a model call when the message matches the built-in rules. Individual financial data and completed bank actions are never fabricated. This is a mock workflow, not an authenticated account integration or the paid Infobip AgentOS product.

1. Create a Gemini API key in Google AI Studio.
2. In Render, add the environment variables `GEMINI_API_KEY` and `ASSISTANT_WEBHOOK_TOKEN`. Generate a long random `ASSISTANT_WEBHOOK_TOKEN`. Never commit either value.
3. Redeploy the updated `server.js` **and** `knowledge/` directory. The CPF lookup route is still available.
4. Replace the Services menu in Infobip Answers with **Save user response** and the English prompt "How can I help you today? Please do not share a password, CVV or full card number." Save the customer's free-form message to a Text attribute such as `CustomerQuestion`.
5. In the Infobip Answers **API** element, use `POST https://YOUR-SERVICE.onrender.com/assistant/ask`, header `Content-Type: application/json`, header `x-ib-demo-token: YOUR_ASSISTANT_WEBHOOK_TOKEN`, and a JSON body with the key `question` mapped to the `CustomerQuestion` attribute. The placeholder below is illustrative; insert the attribute using the Infobip editor:

```json
{"question":"QUESTION_ATTRIBUTE"}
```

**Do not send `topic`.** The response body has `intent`, `answer`, `handoff`, `agent`, `process`, `priority`, `offerVoice`, and `caseSummary` fields. Save them to Text attributes using JSON paths `$.intent`, `$.answer`, `$.handoff`, `$.agent`, `$.process`, `$.priority`, `$.offerVoice`, and `$.caseSummary`. `priority=URGENT` marks lost-card and suspicious-charge cases. `offerVoice=YES` means a human handoff may be followed by a call **if WhatsApp Business Calling is enabled**; the API cannot initiate a call by itself. If `handoff` is `YES`, send `answer` and then use **To Agent**. For urgent cases, transfer without waiting for a reply; for normal cases, offer a choice to continue by text or request a call. If `handoff` is `NO`, send `answer` and ask "Did that resolve your question?". A "No" or "Human agent" button goes to **To Agent**. A "New question" button returns to a fresh Save user response. On HTTP errors, configure the API element's fallback to a human agent. Configure Inbox/Conversations for a real human transfer.

Example PowerShell smoke test (after deployment and setting the token locally):

```powershell
$headers = @{ 'x-ib-demo-token' = $env:ASSISTANT_WEBHOOK_TOKEN }
Invoke-RestMethod -Uri 'https://YOUR-SERVICE.onrender.com/assistant/ask' -Method Post -Headers $headers -ContentType 'application/json' -Body '{"question":"My card purchase was declined. What should I check?"}'
```

Sample answer shape:

```json
{"intent":"card_declined","agent":"Card Support Specialist","process":"card_declined","priority":"NORMAL","offerVoice":"NO","caseSummary":"Card Support Specialist | card_declined | My card purchase was declined. What should I check?","answer":"First, confirm that you recognize the purchase and check the card details, card status and available limit in the official app. If it still fails, I can connect you with a specialist to check the specific reason.","handoff":"NO"}
```

The model may vary its wording. The application attempts to redact common identifier, card-number and email formats before sending a question to Gemini; do not pass real customer information to this demonstration. No real account balance, payments, card blocks or debt offers are processed. The earlier CPF lookup only validates a fictional registration record and is **not authentication**. Gemini's free tier has limits; provider, hosting and Infobip messaging costs are separate.

## Optional escalation from WhatsApp chat to a voice call

1. Confirm the WhatsApp sender supports calling. In the Infobip Numbers app, select the sender > WhatsApp tab > **Activate WhatsApp voice**. If the option is missing, the account does not currently have WhatsApp voice routes enabled.
2. In Inbox/Conversations, configure an inbound route with channel WhatsApp and communication type Calls, assign it to a queue with a voice-capable agent, and configure a waiting strategy.
3. After **To Agent**, the agent can send a WhatsApp interactive message with a call button inside the active messaging window, or the customer can tap the phone icon in the WhatsApp chat if that icon is enabled for the sender. The **customer** starts this call. For business-initiated calls, first request and receive the customer's WhatsApp call permission.
4. Map `caseSummary`, `intent` and `priority` to Answers Text attributes that are visible to human agents. Add conversation tags for the relevant specialist queue. The phone call is handled by Infobip Inbox, **not by this mock API**. Check the live call and chat experience on your actual sender before claiming unified context for your demo.

WhatsApp Business Calling is an in-app VoIP call. A regular telephone-network (PSTN) call requires a different Infobip voice setup, a voice-capable number and outbound call integration. This package does not create outbound calls, call recordings, post-call summaries or email messages.
