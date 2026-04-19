# Bompton Spotify App — Claude conventions

## Error messages
This app is for a small private crew, not the general public. Always make error messages as informative as possible:

- Surface the underlying cause, not a sanitized "something went wrong"
- Include the specific error code, status, or exception name when there is one
- Say what the user (or operator) should actually do to fix it — env var to set, command to run, dashboard to check
- Don't hide details for "security" or "polish" — there's no anonymous attacker to protect against here
- Server-side: log the full error plus relevant context (user id, request path, params)
- Client-side: show the same level of detail in any error UI (banners, toasts, fallback pages)

This applies to auth flows, API responses, server actions, cron jobs, and any future surface.
