# The phone is a web app, not a native app

Pip's phone side ships as a web app served by the user's computer over Tailscale, not a Flutter or native app. One URL works on iPhone and Android with no App Store account, review cycle or install, updates arrive by refreshing, and the same avatar modules draw the eyes in the browser and in the desktop QML, so the character can't drift between renderers.

## Consequences

iOS stops the microphone when the screen locks or another app comes forward, and audio needs a tap to unlock, so Pip only listens while his home screen is open on a phone with the screen on. Revisit with a native app only if background listening becomes a requirement.
