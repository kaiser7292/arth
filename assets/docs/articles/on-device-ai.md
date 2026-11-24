---
title: On-device AI (Gemini Nano)
slug: on-device-ai
summary: On phones with Gemini Nano, the AI built into the phone reads the bank messages Arth doesn't know and helps with setup. Nothing leaves the phone.
tags: [AI, Gemini, Nano, on-device, unrecognised, messages, SMS, setup, privacy]
contextKeys: [on-device-ai]
phrasings:
  - What is on-device AI?
  - What does Gemini Nano do in Arth?
  - Arth didn't read one of my bank messages
  - What does Read by AI mean?
  - Why is a transaction marked AI?
  - Does the AI send my messages anywhere?
  - Turn off on-device AI
  - Set up on this phone
  - My phone doesn't show On-device AI
  - Download the on-device model
---

Some newer Android phones have Gemini Nano, a small AI model that runs on the phone itself. Arth can use it in two ways. Both run entirely on your phone: no message, amount or account is sent anywhere.

## Reading messages Arth doesn't know

Arth reads bank messages with its own patterns and your templates. When neither recognises a message, on-device AI reads it instead. Arth then checks the AI's answer against the message itself:

- The amount must be written in the message.
- The account digits must be written in the message.
- Money in or out must match the message's own words.

An answer that fails these checks is left out. One that passes becomes a transaction waiting in **Catch Up**, marked **Read by on-device AI · check it**. Nothing counts in your reports until you approve it.

Android only lets the AI run while Arth is open. Messages that arrive while Arth is closed wait, and Arth reads a few at a time the next time you open it.

## Help during setup

- **First read of your messages:** switch on *Read the rest with on-device AI* and it reads what Arth's patterns couldn't. If Android still needs to download the model, it does that while Arth reads.
- **Your accounts:** when Arth can't tell whether an account is a bank account, card or wallet, the AI reads a few of its messages and suggests one. You still tap the right type.
- **Set up on this phone:** the AI puts your biggest merchants into your categories. You review each one before anything changes, the same way as replies from Claude, ChatGPT or Gemini. The budget step then fills in figures from what you really spent.

## Settings

Go to **Settings → On-device AI** to:

- turn reading on or off
- see whether the model is ready, or download it
- see how many messages are waiting, and read them now
- read older unread messages too

Each AI run is saved in **Settings → Transaction messages → Scan history**, next to the message scans.

## If you don't see it

On-device AI shows only on phones that have Gemini Nano. On other phones, Arth reads messages exactly as before. Messages it can't read wait in **Settings → Transaction messages**, under *messages Arth couldn't read*, where you can teach Arth the format with a template.
