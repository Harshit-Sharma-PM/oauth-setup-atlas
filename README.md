# OAuth Setup Atlas

Evidence-aware OAuth setup guides for developers and AI agent builders.

## Live demo and source

- **Live app:** https://oauth-setup-atlas.onrender.com/
- **Source repository:** https://github.com/Harshit-Sharma-PM/oauth-setup-atlas

## Scope

A focused working slice toward the requested 100-app library. Starter providers: GitHub, Gmail/Google APIs, Slack, Microsoft identity platform, Shopify, and Salesforce. Unknown apps are researched on demand. Guides separate OAuth setup from provider verification or marketplace approval, estimate active effort separately from external waiting, identify blockers and human handoffs, and label uncertainty. The seed catalogue is not a completed 100-app library.

## Requirements

- Node.js 18+
- Optional live research keys: `GEMINI_API_KEY` and `TAVILY_API_KEY`

## Run locally

```bash
npm install
cp .env.example .env
# Add your private keys to .env (server-side only)
npm run dev
```

Vite typically serves at http://localhost:5173 and the Express API at port 3001.

For a production-style local run:

```bash
npm run build
npm start
```

## Live research agent

Set `GEMINI_API_KEY`, `TAVILY_API_KEY`, and optionally `GEMINI_MODEL=gemini-3.8-flash` and `PORT=3001` in the server environment. Never commit `.env` or expose keys to browser code. Without research keys, unknown apps must be shown as unresearched drafts, not as verified guides. The agent's web research is not equivalent to completing a provider-console setup.

The research path uses Tavily to find web evidence and Gemini to structure a guide from retrieved snippets. Results can take several seconds because this involves external requests. A search result is not proof that OAuth is supported, that a provider console was tested, or that approval is guaranteed. If evidence is missing or ambiguous, mark it unknown and verify the official documentation.

## Decisions and evidence

- Check Composio managed OAuth support before assuming developers must register their own provider app.
- Separate OAuth registration and authorization from app verification, admin consent, and marketplace review.
- Keep active setup time separate from provider review wait; do not promise approval timelines without evidence.
- Treat generated summaries as leads to verify. Evidence states should distinguish Documented, Tested, Estimated, and Unknown.
- The agent cannot log in to provider consoles, handle private credentials, submit legal declarations, or obtain approval on a user's behalf.
- Guide URLs use `/guide/<slug>`; use **Share guide** from a guide page to copy its link.

## Limitations

- The starter catalogue has six seed guides; it is not 100 completed guides.
- Provider requirements can change; check official documentation. No guide should claim a provider-console test unless it was actually performed.
- Generated guide records are currently saved to a local JSON file. Render's free filesystem is ephemeral, so server-stored generated guides may disappear after a restart or redeploy. Treat generated guide URLs as shareable while the record exists; durable, long-term server-side sharing requires persistent storage. This is a known limitation.
- Production hardening needs rate limits, SSRF protections, source freshness tracking, schema validation, automated tests, durable storage, and security review.

## Deployment to Render

1. Open [Render](https://render.com/) and choose **New → Blueprint**.
2. Connect this repository and select the branch containing `render.yaml`.
3. Add `GEMINI_API_KEY` and `TAVILY_API_KEY` as secret values in the service environment. Keep them server-side; never add them to Vite/client variables.
4. Deploy and confirm [`/api/health`](https://oauth-setup-atlas.onrender.com/api/health) responds.
5. Test known seed guides and unfamiliar apps, including an app with unclear OAuth support and an app that does not offer public OAuth.

The Render blueprint uses the free web-service plan when available. Free services sleep after inactivity and the first request after sleep can take roughly 30–60 seconds or longer. **Before submitting the assignment, open the live app and health endpoint to warm the service up**, then test guide generation. Do not claim the app is warmed up unless you have just visited it.

Generated guide storage on Render is ephemeral. For a production service, use durable database storage, rate limiting, input/output validation, source freshness checks, SSRF protection, and a security review. The AI research flow is not provider-console automation and does not complete verification or approval for the user.

## Manual pre-submission test checklist

- [ ] Live homepage loads and `/api/health` reports `ok: true`.
- [ ] Each of the six starter guides opens.
- [ ] Test 5–6 unfamiliar apps, including obscure names and apps with limited public OAuth documentation.
- [ ] Test an app that does not appear to support public OAuth; the output must clearly state uncertainty/no verified OAuth path rather than inventing steps.
- [ ] Check sources and unknowns on generated guides.
- [ ] Open a generated guide link in a private/incognito window or another device while the server record still exists.
- [ ] Confirm no credentials are present in committed files; keep API keys only in Render's secret environment and your local ignored `.env`.
- [ ] Open the live app and health endpoint immediately before sharing the demo to reduce the chance of a cold start.

