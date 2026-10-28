# OAuth Setup Atlas

Evidence-aware OAuth setup guides for developers and AI agent builders.

## Live demo and source

- **Live app:** https://oauth-setup-atlas.onrender.com/
- **Source repository:** https://github.com/Harshit-Sharma-PM/oauth-setup-atlas

## Scope

A focused working slice toward the requested 100-app library. The starter catalogue contains six seed guides: GitHub, Gmail / Google APIs, Slack, Microsoft identity platform, Shopify, and Salesforce. Unknown apps can be researched on demand. Guides separate initial setup effort from external approval or review wait, identify likely blockers and human hand-offs, and make uncertainty visible. This is not a completed library of 100 curated guides.

## Requirements

- Node.js 18+
- For live research: `GEMINI_API_KEY` and `TAVILY_API_KEY`

## Run locally

```bash
npm install
cp .env.example .env
# Add your private keys to .env, if using live research
npm run dev
```

Vite typically serves the frontend at http://localhost:5173 and the Express API at port 3001.

For a production-style local run:

```bash
npm run build
npm start
```

## Live research agent

Set `GEMINI_API_KEY` and `TAVILY_API_KEY` in the server environment. Optionally set `GEMINI_MODEL` and `PORT`. The default model is configured in `server/index.js` and `render.yaml`. Keep API keys server-side; never commit a real `.env` file or expose keys through frontend variables.

The research flow uses Tavily to retrieve web search results and Gemini to structure a guide from those results. It can take several seconds because it calls external services. Search snippets are evidence to inspect, not proof that OAuth is supported, that a provider console was tested, or that approval is guaranteed. When OAuth support cannot be confirmed from the retrieved evidence, the app should present a verification report and mark the setup path as unknown rather than inventing provider-specific steps.

## Key decisions and evidence

- Check whether the integration can use Composio's managed-auth flow before assuming a developer must register and maintain their own provider OAuth app. See the [Composio managed authentication documentation](https://docs.composio.dev/toolkits/managed-auth).
- Distinguish OAuth app registration and user authorization from admin consent, provider verification, and marketplace review. These are separate requirements and may not all apply.
- Report active setup effort separately from external review or approval wait. Do not promise review timelines without reliable evidence.
- Treat AI-generated guidance as a starting point that needs verification. Distinguish documented information, estimates, unknowns, and actual testing. Do not label a provider-console flow as tested unless it was actually tested.
- Make the human/agent boundary explicit: the agent can research and draft a checklist, but it cannot sign in to provider consoles, safely manage a user's private credentials, make legal declarations, or obtain approval on the user's behalf.
- Guide links use `/guide/<slug>` plus a URL-fragment payload. The **Share guide** control copies the current guide link. The fragment lets the shared guide render without depending entirely on the server's temporary generated-guide record; anyone with the link can read the guide data encoded in it, so do not put secrets or private information in a guide.

## Limitations

- The starter catalogue contains six seed guides; it is not 100 completed or continuously maintained provider guides.
- Provider requirements can change. Always verify important requirements against the provider's current official documentation.
- Generated guides are AI-produced and may contain errors or incomplete evidence. Retrieved sources should be checked to confirm that they support the claims being made. A successful search does not prove OAuth support.
- Generated guides are also saved to a local JSON file on the server. Render's free filesystem is ephemeral, so this server-side catalogue may reset after a restart or redeploy. Shared links include the guide content in the URL fragment and can continue to render from that fragment, but they do not create a permanent server-side library entry. Long-term shared library storage needs a persistent database.
- This is a demo, not production-hardened software. Production use would need rate limiting, robust input/output schema validation, SSRF protections for any future URL-fetching features, source freshness checks, durable storage, automated tests, and a security review.

## Deploy to Render

1. Open [Render](https://render.com/) and create a Blueprint from this repository's `render.yaml`.
2. Select the `main` branch.
3. Add `GEMINI_API_KEY` and `TAVILY_API_KEY` as secret environment values. Do not put the keys in source code or frontend variables.
4. Deploy and check the [health endpoint](https://oauth-setup-atlas.onrender.com/api/health). It should return `ok: true`; `researchConfigured` should be `true` when both research keys are set.
5. Test at least one seed guide and several unfamiliar apps, including an app for which public OAuth support is unclear.

Render's free web services may sleep after inactivity. The first request after sleep can take around 30–60 seconds or longer, so the demo may initially appear slow. Before sharing the assignment, open the live app and health endpoint to warm the service, then test guide generation. A warm-up is temporary; the service can sleep again later.

## Manual pre-submission test checklist

This short checklist is intentionally included in the README so a reviewer or developer can repeat the critical checks. Tick items only after actually completing them.

- [ ] Open the live homepage and confirm it loads; check `/api/health` for `ok: true` and `researchConfigured: true`.
- [ ] Open each of the six seed guides.
- [ ] Generate guides for 5–6 unfamiliar apps, including one obscure app and one with limited public OAuth documentation.
- [ ] Try an app that does not appear to support public OAuth and a clearly invalid or nonexistent app name. The app should state that support is unverified or evidence is insufficient, rather than inventing a confirmed setup path.
- [ ] Inspect generated sources, uncertainty, and any approval or effort estimates.
- [ ] Use **Share guide** and open the link in a private/incognito window or another browser. Confirm the guide still renders from the shared URL.
- [ ] Check the repository for accidental credentials. Keep real API keys only in Render's secret environment and in your local ignored `.env` file.
- [ ] Open the live app and health endpoint shortly before presenting to reduce the chance of a cold start.

