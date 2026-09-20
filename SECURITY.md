# Security

## What is public, and what is not
| Value | Where | Public? |
| --- | --- | --- |
| Supabase project URL, anon / publishable key | baked into `dist/index.html`, GitHub Actions **variables** | Yes, by design (protected by row-level security) |
| `OPENROUTER_API_KEY` / `GEMINI_API_KEY` | Supabase Edge Function **secrets** only | **No.** Never in the repo, the bundle, GitHub variables, or chat |
| Supabase service-role / secret key | nowhere in this project | **No.** The build refuses to embed one |

## Controls in the code
- The occupancy tables are read-only for the anon key (RLS plus revoked write grants); the simulator function and the curve/config tables are not callable or readable by API roles.
- The advisor function injects the system prompt and tool list itself, validates and size-limits every request, allow-lists browser origins (`ALLOWED_ORIGINS`), rate-limits per visitor and per day, redacts keys from any error it reports, and never returns an upstream response body.
- The advisor's answers are guarded: numbers that no tool returned and places no tool returned are rejected.
- All dynamic text is HTML-escaped before it reaches the DOM.

## Handling a leaked key
Revoke it at the provider immediately (OpenRouter -> Keys, Google AI Studio, Supabase -> Project Settings -> API Keys), create a new one, update the Supabase secret, and redeploy the function. Do not just delete the message it was posted in.

## Reporting
This is a hackathon prototype. Report problems to the repository owner by opening a private message or an issue that does not include the secret itself.
