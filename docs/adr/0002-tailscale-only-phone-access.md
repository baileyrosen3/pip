# Phone access is Tailscale only

The phone reaches Pip only through Tailscale Serve (HTTPS on the user's tailnet), never plain LAN or the public internet. Browsers only allow the microphone over HTTPS, Tailscale provides real certificates and identity (same-account phones pair without a code), and nothing is exposed outside the tailnet. A LAN mode with self-signed certificates was rejected: every phone would need a trusted CA installed and the pairing token would cross networks we don't control.
