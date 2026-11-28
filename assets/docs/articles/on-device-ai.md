---
title: On-device AI (Gemini Nano, Apple Intelligence)
slug: on-device-ai
summary: With Gemini Nano (Android) or Apple Intelligence (iPhone), the AI built into the phone reads the bank messages Arth doesn't know and helps with setup. Nothing leaves the phone.
tags: [AI, Gemini, Nano, Apple Intelligence, iPhone, on-device, unrecognised, messages, SMS, setup, privacy]
contextKeys: [on-device-ai]
phrasings:
  - What is on-device AI?
  - What does Gemini Nano do in Arth?
  - Does on-device AI work on iPhone?
  - Apple Intelligence in Arth
  - Arth didn't read one of my bank messages
  - What does Read by AI mean?
  - Why is a transaction marked AI?
  - Does the AI send my messages anywhere?
  - Turn off on-device AI
  - Set up on this phone
  - My phone doesn't show On-device AI
  - Download the on-device model
  - Same place different names
  - Why does Catch Up say looks like an EMI?
  - Your month headline
  - Search in plain words
---

Some newer phones have a small AI model that runs on the phone itself: Gemini Nano on Android, Apple Intelligence on iPhone (iPhone 15 Pro or later, iOS 26). Arth can use it in two ways. Both run entirely on your phone: no message, amount or account is sent anywhere.

## Reading messages Arth doesn't know

Arth reads bank messages with its own patterns and your templates. When neither recognises a message, on-device AI reads it instead. Arth then checks the AI's answer against the message itself:

- The amount must be written in the message.
- The account digits must be written in the message.
- Money in or out must match the message's own words.

An answer that fails these checks is left out. One that passes becomes a transaction waiting in **Catch Up**, marked **Read by on-device AI · check it**. Nothing counts in your reports until you approve it.

The phone only lets the AI run while Arth is open. Messages that arrive while Arth is closed wait, and Arth reads a few at a time the next time you open it.

## Help during setup

- **First read of your messages:** switch on *Read the rest with on-device AI* and it reads what Arth's patterns couldn't. If Android still needs to download the model, it does that while Arth reads.
- **Your accounts:** when Arth can't tell whether an account is a bank account, card or wallet, the AI reads a few of its messages and suggests one. You still tap the right type.
- **Set up on this phone:** the AI puts your biggest merchants into your categories. You review each one before anything changes, the same way as replies from Claude, ChatGPT or Gemini. The budget step then fills in figures from what you really spent.

## More it can do

Each of these has its own switch in **Settings → AI → On this phone**:

- **Pictures Arth can't read:** when a payment picture's amount or merchant can't be found, the AI reads the picture's text. It only fills empty fields, and only with what's written on the picture.
- **Categories for new merchants:** when no mapping or rule knows a merchant, Catch Up suggests one of your categories, marked "Suggested by on-device AI". Tap the category to change it.
- **Learn message formats:** after you approve two messages the AI read in the same format, a **Learn a message format** card in Catch Up offers to read that format by itself. Say yes and a template reads it from then on, instantly, without the AI.
- **Same place, different names:** a **Same place?** card in Catch Up (and in Settings → Merchants) shows names the AI thinks are one place. Arth only asks about names that already look alike or were paid to the same UPI ID. **Not the same** is remembered.
- **What a payment was:** for a bank message that mentions a mandate, EMI, SIP or card bill, Catch Up may say "Looks like an EMI · Link it to the loan". Tapping it opens that action. Tap × to dismiss it.
- **Your month headline:** the Your month card at the top of Insights gets a catchy one-line headline. Arth works out every fact itself; the AI only words them. A headline with any number or name that isn't in Arth's own figures is dropped, and the plain headline shows instead.
- **Voice and search in plain words:**
  - Saying "spent 300 on chai at office canteen by UPI" fills in the merchant, category and payment mode.
  - Searching "Swiggy over 500" in Transactions turns into filters.

## Settings

Go to **Settings → AI → On this phone** to:

- turn reading on or off
- see whether the model is ready, or download it (on iPhone: turn on Apple Intelligence in the iPhone's Settings → Apple Intelligence & Siri)
- see how many messages are waiting, and read them now
- read older unread messages too

Each AI run is saved in **Settings → Transaction messages → Scan history**, next to the message scans.

## If you don't see it

On this phone works only on phones that have Gemini Nano or Apple Intelligence. On other phones, Settings → AI says so in one grey line, and Arth reads messages exactly as before. Your AI assistant (ChatGPT, Gemini or Claude) still works on every phone: see **AI in Arth**. Messages it can't read wait in **Settings → Transaction messages**, under *messages Arth couldn't read*, where you can teach Arth the format with a template.
