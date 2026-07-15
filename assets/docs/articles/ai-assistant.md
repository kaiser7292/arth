---
title: AI assistant
slug: ai-assistant
summary: Arth's on-device AI can answer questions about your finances, search your transactions in plain English, and run entirely without an internet connection.
tags: [AI, assistant, chat, on-device, local model, natural language, NL search, privacy, data access, model download]
contextKeys: [ai-assistant, ai-chat, settings-ai]
phrasings:
  - How does the AI assistant work?
  - Is the AI in Arth connected to the internet?
  - Download AI model
  - Enable AI in Arth
  - Arth AI chat
  - Ask Arth a question
  - Natural language search
  - Find expenses using AI
  - What data does the AI see?
  - AI privacy
  - How to talk to Arth
  - AI model download
  - Local AI model
  - Disable AI assistant
  - AI data access settings
  - Search transactions with AI
---

Arth includes an **on-device AI assistant** that runs entirely on your phone — no internet connection required, no data sent to any server. You can ask it questions about your finances, search your transactions in plain English, and get an instant summary of where your money is going.

## Setting it up

The AI model does not come pre-installed because it is large (approximately 1–2 GB depending on the model). To use the assistant:

1. Open **Settings → AI Assistant**.
2. Tap **Download** next to the model you want. Arth supports multiple model sizes — a smaller model downloads faster and uses less storage but may give less nuanced answers; a larger model is more capable but slower on older phones.
3. Wait for the download to complete. You can continue using Arth while it downloads.
4. Once downloaded, toggle **Enable AI Assistant** to on.

You can delete a downloaded model at any time from the same screen to reclaim storage, and re-download it later.

## Talking to the AI

Open the AI chat from the **Goals tab → AI Assistant card** or from the floating chat button if it is visible on your home screen.

The chat shows a few suggested questions to get you started — tap one or type your own question. For example:

- "How much did I spend on food this month?"
- "What were my biggest expenses in March?"
- "Did I overspend on any category last month?"
- "How is my savings rate trending?"

The assistant answers using your own data. Responses stream in real time, similar to a messaging conversation. Tap and hold any response to copy it.

Your last 30 conversations are saved in the chat history. The history is stored on-device and is not included in your Arth backup.

## Natural language search

With **NL Search enabled** (Settings → AI Assistant → Natural Language Search), the main transaction search bar in Arth understands plain-English queries. Instead of filtering by exact category, you can type "coffee last week" or "online shopping above 1000" and Arth will interpret it using the AI model.

NL Search requires the AI model to be downloaded and enabled.

## Data access controls

By default the AI can see a summary of your data, but you can control exactly which categories it can access. In Settings → AI Assistant → Data Access:

- **Accounts** — account names, types, and balances
- **Budget** — your budget categories and limits
- **Expenses** — individual transaction history
- **Hisaab** — family lending and borrowing records
- **Vault** — saved credentials (off by default; only enable if you want to ask about stored account details)

Toggle any category off to prevent the AI from accessing that data. The AI only has read access — it cannot create, edit, or delete any record.

## Privacy

Because the model runs locally, your financial data never leaves your device for AI purposes. The assistant does not connect to any Anthropic server, OpenAI server, or any other external API. The model itself is downloaded once and runs offline thereafter.

## Common situations

**"The AI gives a wrong answer."** The on-device model is smaller than cloud-based AI and may occasionally make mistakes on complex multi-step queries. For critical numbers, verify by checking the relevant screen directly.

**"The download keeps failing."** Check your internet connection and available storage. The model requires a stable connection to download. If it fails mid-way, tap Download again — it will attempt to resume.

**"I want to use the AI but save space."** Choose the smallest available model. You can always delete it later and re-download a larger one if the answers feel too limited.

**"The chat history is gone."** Chat history is stored in-app only (not in the backup file). Clearing the app's cache or reinstalling Arth will erase the chat history.

## Related

- Secure your financial data: [Biometric and PIN lock](lock)
- Store credentials securely: [Vault — storing credentials and passwords](vault)
- Search transactions manually: [Transactions tab](transactions)
