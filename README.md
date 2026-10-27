# OAuth Setup Atlas

Evidence-aware OAuth setup guides for developers and AI agent builders.

## Scope
A focused working slice toward the requested 100-app library. Starter providers: GitHub, Gmail/Google APIs, Slack, Microsoft identity platform, Shopify, and Salesforce. Guides separate OAuth setup from provider verification or marketplace approval, estimate active effort separately from external waiting, identify blockers and human handoffs, and label uncertainty.

## Requirements
- Node.js 18+
- Optional live research keys: `OPENAI_API_KEY` and `TAVILY_API_KEY`

## Run locally
```bash
npm install
cp .env.example .env
npm run dev
```
Vite typically serves at http://localhost:5173 and the Express API at port 3001.

For a production-style local run:
```bash
npm run build
npm start
```

## Live research agent
Set `OPENAI_API_KEY`, `TAVILY_API_KEY`, and optionally `PORT=3001` in the server environment. Never commit `.env` or expose keys to browser code. Without research keys, unknown apps must be shown as unresearched drafts, not as verified guides. The agent's web research is not equivalent to completing a provider-console setup.

## Decisions and evidence
- Check Composio managed OAuth support before assuming developers must register their own provider app.
- Separate OAuth registration and authorization from app verification, admin consent, and marketplace review.
- Keep active setup time separate from provider review wait; do not promise approval timelines without evidence.
- Treat generated summaries as leads to verify. Evidence states should distinguish Documented, Tested, Estimated, and Unknown.
- The agent cannot log in to provider consoles, handle private credentials, submit legal declarations, or obtain approval on a user's behalf.

## Limitations
The seed catalogue is not 100 completed guides. Provider requirements can change; check official documentation. No guide should claim a provider-console test unless it was actually performed. Generated guide storage in a local JSON file is suitable only for a demo/single instance. Production hardening needs rate limits, SSRF protections, source freshness tracking, schema validation, automated tests, durable storage, and security review.

## Deployment
Use a Node.js host that supports Express. Run `npm run build`, set research keys as server-side secrets, and run `npm start`. Test live guide generation with valid keys before presenting it as operational.