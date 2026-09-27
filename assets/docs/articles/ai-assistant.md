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
  - Report an AI answer
  - Which AI model does Arth use?
  - Llama model
  - Local AI model
  - Disable AI assistant
  - AI data access settings
  - Search transactions with AI
---

Arth includes an **on-device AI assistant** that runs entirely on your phone — no internet connection required, no data sent to any server. You can ask it questions about your finances, search your transactions in plain English, and get an instant summary of where your money is going.

## Setting it up

The AI model does not come pre-installed because it is large. Arth AI is built with Meta's **Llama 3.2**, in two sizes: **Llama 3.2 1B** (about 880 MB) and **Llama 3.2 3B** (about 1.9 GB). To use the assistant:

1. Open **Settings → Automation → Arth AI**.
2. Download the model you want. The smaller model downloads faster and uses less storage but may give less nuanced answers; the larger one is more capable but slower on older phones. Wi-Fi is recommended.
3. Wait for the download to complete. You can continue using Arth while it downloads.
4. Once downloaded, turn on **Enable Arth AI**. Tap **Use this model** to switch between downloaded models.

You can delete a downloaded model at any time from the same screen to reclaim storage, and re-download it later.

## Talking to the AI

Once Arth AI is on, tap the **sparkles** icon at the top of the Home tab to open the chat.

The chat shows a few suggested questions to get you started — tap one or type your own question. For example:

- "How much did I spend on food this month?"
- "What were my biggest expenses in March?"
- "Did I overspend on any category last month?"
- "How is my savings rate trending?"

The assistant answers using your own data. Responses stream in real time, similar to a messaging conversation. Tap and hold any response to copy it.

Your chat history is saved on the phone and included in your Arth backup. The downloaded model itself isn't - download it again on a new phone.

## Natural language search

With **NL Search enabled** (Settings → Automation → Arth AI → Natural Language Search), the main transaction search bar in Arth understands plain-English queries. Instead of filtering by exact category, you can type "coffee last week" or "online shopping above 1000" and Arth will interpret it using the AI model.

NL Search requires the AI model to be downloaded and enabled.

## Data access controls

By default the AI can see a summary of your data, but you can control exactly which categories it can access. In Settings → Automation → Arth AI → Data Access:

- **Accounts** — account names, types, and balances
- **Budget** — your budget categories and limits
- **Expenses** — individual transaction history
- **Hisaab** — family lending and borrowing records
- **Vault** — entry titles and renewal dates only. Passwords are never shared with the AI. Off by default.

Toggle any category off to prevent the AI from accessing that data. The AI only has read access — it cannot create, edit, or delete any record.

## Privacy

Because the model runs locally, your financial data never leaves your device for AI purposes. The assistant does not connect to any Anthropic server, OpenAI server, or any other external API. The model itself is downloaded once and runs offline thereafter.

## Common situations

**"The AI gives a wrong answer."** The on-device model is smaller than cloud-based AI and may occasionally make mistakes on complex multi-step queries. For critical numbers, verify by checking the relevant screen directly.

**"The download keeps failing."** Check your internet connection and available storage. The model requires a stable connection to download. If it fails mid-way, tap Download again — it will attempt to resume.

**"I want to use the AI but save space."** Choose the smallest available model. You can always delete it later and re-download a larger one if the answers feel too limited.

**"The chat history is gone."** Chat history is stored in the app and in your backups. Restore a backup to get it back.

**"An answer was wrong or offensive."** Tap **Report this answer** under it, pick a reason and add a note. Arth prepares an email to the developer - nothing is sent until you send it from your email app.

**"The app slows down or crashes."** Switch to the smaller model, or turn off Arth AI in Settings → Automation → Arth AI.

## Related

- Secure your financial data: [Locking the app with Face / Fingerprint](biometric-lock)
- Store credentials securely: [Vault — storing credentials and passwords](vault)
- Search transactions manually: [Transactions tab](transactions)
