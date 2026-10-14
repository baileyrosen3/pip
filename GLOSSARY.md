# Pip

A desktop companion for Omarchy: a character whose body is a phone and who acts on the user's desktop.

## Character

**Pip**:
The character as a whole, wherever he appears (phone, desktop, bar).
_Avoid_: Bluey, the bot, the assistant

**Home screen**:
The phone screen showing Pip: one flat colour and his two eyes, nothing else.
_Avoid_: face screen, avatar screen

**Eyes**:
Pip's only features; two blobs that change shape to show every emotion, state and activity.
_Avoid_: face, avatar

**Eye style**:
How the eyes are rendered (Flat, Glass, Glow); never changes how they move.
_Avoid_: face style, skin, theme

**Pointer**:
Pip's flying on-screen presence on the desktop (Arrow, Orb, Eyes or Tile); separate from the user's own mouse cursor.
_Avoid_: cursor (reserved for the user's mouse)

## Conversation

**Brain**:
The voice AI service that listens and replies for Pip (Gemini Live, OpenAI Realtime, GPT-Live).
_Avoid_: provider, model, backend

**Awake / asleep**:
Whether Pip is in a session: awake means the phone mic streams and a brain is connected; asleep means neither.
_Avoid_: on/off, active

**Session**:
One awake period, from waking to sleeping.
_Avoid_: conversation, call

**Auto-sleep**:
Pip falling asleep on his own after a set time with no speech, so brains stop listening and billing.

**Reply mode**:
When Pip answers: when you talk, when you say "Pip", or when you hold the phone screen.
_Avoid_: answer mode, trigger

**Talk out loud**:
Pip replying with speech on the phone as well as text.
_Avoid_: voice mode, TTS

**Caption**:
The text of Pip's reply, shown under his eyes on the phone and in a bubble by his pointer on the desktop.
_Avoid_: subtitle, message

**Meeting notes**:
The recorded, speaker-labelled transcript of a session, saved as files on the computer. Off unless the user turns it on.
_Avoid_: recording, transcript (alone)

## Desktop

**Computer control**:
Pip clicking, typing, pressing keys, scrolling, dragging and opening things on the desktop when asked. Off until the user opts in.
_Avoid_: computer use, automation

**Phone access**:
Pip's tailnet-only HTTPS address that the phone opens; Tailscale is the only supported way to reach him.
_Avoid_: pairing server, remote access

**Pairing**:
Letting a phone talk to Pip: automatic for the user's own Tailscale account, by QR code for anyone else.
