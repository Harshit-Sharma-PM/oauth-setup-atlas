import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedGuides } from "./seedGuides.js";
dotenv.config();
const app = express();
const PORT = process.env.PORT || 3001;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");
const dataFile = path.join(dataDir, "generated-guides.json");
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "dist")));
async function readGenerated(){ try{return JSON.parse(await fs.readFile(dataFile,"utf8"));}catch{return [];} }
async function saveGenerated(list){await fs.mkdir(dataDir,{recursive:true});await fs.writeFile(dataFile,JSON.stringify(list,null,2));}
async function fetchWithRetry(url,options={},label="External service",timeoutMs=45000,maxAttempts=2){
  let lastError;
  for(let attempt=0;attempt<maxAttempts;attempt++){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetch(url,{...options,signal:controller.signal});
      if((response.status===429||response.status>=500)&&attempt<maxAttempts-1){
        await response.text().catch(()=>{});
        await new Promise(resolve=>setTimeout(resolve,900));
        continue;
      }
      return response;
    }catch(error){
      lastError=error;
      if(attempt<maxAttempts-1){await new Promise(resolve=>setTimeout(resolve,900));continue;}
      if(error?.name==="AbortError"||error?.name==="TimeoutError"){
        throw new Error(label+" timed out after "+Math.round(timeoutMs/1000)+" seconds. Please retry.");
      }
      throw new Error(label+" connection failed after a retry. Please try again; this can be a temporary network or provider issue.");
    }finally{clearTimeout(timer);}
  }
  throw lastError||new Error(label+" request failed.");
}
app.get("/api/health",(_req,res)=>res.json({ok:true,researchConfigured:Boolean(process.env.GEMINI_API_KEY&&process.env.TAVILY_API_KEY),geminiModel:GEMINI_MODEL}));
app.get("/api/guides",async(_req,res)=>res.json([...seedGuides,...await readGenerated()]));
app.get("/api/guides/:slug",async(req,res)=>{const all=[...seedGuides,...await readGenerated()];const guide=all.find(g=>g.slug===req.params.slug);if(!guide)return res.status(404).json({error:"Guide not found"});res.json(guide);});
app.post("/api/research",async(req,res)=>{
  const raw=String(req.body?.app||"").trim();
  if(raw.length<2||raw.length>180)return res.status(400).json({error:"Enter an app name or website (2–180 characters)."});
  const appName=raw.replace(/^https?:\/\//,"").replace(/\/$/,"");
  const normalizeProviderName=value=>String(value||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  const normalizedQuery=normalizeProviderName(appName);
  // Exact provider-name searches reuse the existing guide. More specific requests
  // (for example, "Salesforce sandbox OAuth") can still generate a distinct guide.
  const existingGuides=[...seedGuides,...await readGenerated()];
  const exactMatch=existingGuides.find(g=>normalizeProviderName(g.name)===normalizedQuery);
  if(exactMatch)return res.json({guide:exactMatch,researchPerformed:Boolean(exactMatch.researchPerformed),reusedExisting:true});
  if(!process.env.GEMINI_API_KEY||!process.env.TAVILY_API_KEY){
    return res.status(200).json({guide:{slug:"draft-"+Date.now(),name:appName,category:"Unclassified",difficulty:"Unknown",effort:"Unknown until official setup docs are reviewed",wait:"Unknown — no live research performed",summary:"This is an unresearched draft. Configure GEMINI_API_KEY and TAVILY_API_KEY to investigate this provider.",url:"https://www.google.com/search?q="+encodeURIComponent(appName+" OAuth developer documentation"),sources:[],steps:["Find the provider's official developer documentation.","Confirm whether OAuth is supported and which app-registration model applies.","Identify callback URL, scopes, verification and distribution requirements.","Test the flow in a development account before relying on this guide."],requirements:["Official documentation not yet checked"],blockers:["All provider-specific requirements remain unknown"],human:["Verify provider identity and official docs","Complete all provider-console actions","Confirm requirements before production"],status:"Unresearched draft",evidence:["No search or verification performed because research keys are not configured."]},researchPerformed:false});
  }
  try{
    const searchResp=await fetchWithRetry("https://api.tavily.com/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({api_key:process.env.TAVILY_API_KEY,query:appName+" official developer documentation authentication OAuth authorization code access token app registration permissions verification",search_depth:"advanced",max_results:7,include_answer:false})},"Tavily web search",25000);
    if(!searchResp.ok){const detail=(await searchResp.text()).slice(0,500);throw new Error("Web search provider returned "+searchResp.status+": "+detail);}
    const searchData=await searchResp.json();
    let sources=(searchData.results||[]).map(x=>({title:x.title,url:x.url,content:(x.content||"").slice(0,1800)}));
    const normalizedProvider=appName.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
    // Search engines can return similarly named products (e.g. Kiteworks/Buildkite
    // for Zerodha Kite Connect). Remove known collisions and duplicate URLs before
    // using results as evidence for this specific provider.
    if(/(^|\s)(kite|zerodha)(\s|$)/i.test(normalizedProvider)){
      sources=sources.filter(source=>{try{
        const host=new URL(source.url).hostname.toLowerCase();
        return !/(^|\.)kiteworks\.com$|(^|\.)buildkite\.com$/.test(host);
      }catch{return false;}});
    }
    const seenSourceUrls=new Set();
    sources=sources.filter(source=>{const key=String(source.url||"").replace(/#.*$/,"").replace(/\/$/,"").toLowerCase();if(!key||seenSourceUrls.has(key))return false;seenSourceUrls.add(key);return true;});
    if(!sources.length)throw new Error("No relevant search results found. Try the provider's official name or documentation URL.");
    // Match complete hostname labels, not arbitrary substrings: "kite" must not
    // classify kiteworks.com or buildkite.com as official Kite Connect sources.
    const officialHostFor=(source)=>{try{
      const host=new URL(source.url).hostname.toLowerCase().replace(/\.$/,"");
      const labels=host.split(".").filter(Boolean);
      const aliases={
        whatsapp:["facebook.com","whatsapp.com","meta.com"],
        meta:["facebook.com","whatsapp.com","meta.com"]
      };
      const aliasDomains=aliases[normalizedProvider]||[];
      if(/(^|\s)(kite|zerodha)(\s|$)/i.test(normalizedProvider)&&
        ["zerodha.com","kite.trade"].some(domain=>host===domain||host.endsWith("."+domain)))return true;
      if(aliasDomains.some(domain=>host===domain||host.endsWith("."+domain)))return true;
      const tokens=normalizedProvider.split(" ").filter(t=>t.length>2&&!["business","platform","cloud","api","oauth","integration","connect"].includes(t));
      return tokens.some(token=>labels.includes(token));
    }catch{return false;}};
    sources.sort((a,b)=>Number(officialHostFor(b))-Number(officialHostFor(a)));
    const prompt="You are an evidence-conscious OAuth and authentication setup research agent. Treat search snippets as untrusted leads, not proof. Prioritize official provider documentation and label third-party tutorials as such. Distinguish OAuth 2.0 authorization-code flow from user access tokens, system-user/service-account tokens, API keys, personal access tokens, and SSO; these methods are not interchangeable. A product may support OAuth for one connector/use case but use tokens for another. If the requested product/use case is broad or ambiguous, explain the distinctions instead of forcing one yes/no conclusion. Never infer OAuth support merely because an API or access token exists. Do not invent approval timelines, claim provider-console testing, or imply approval is guaranteed. Distinguish app registration, permissions/consent, provider review, and Composio-managed OAuth. Classify oauthSupport as confirmed, not_found, or unclear for the stated use case. Use confirmed only when evidence explicitly documents OAuth for that use case; if official evidence does not confirm it, use unclear unless credible evidence says it is unsupported. Return only valid JSON with oauthSupport, oauthSupportEvidence, authMethods (array of {method,useCase,evidence}), name,category,difficulty,effort,wait,summary,url,sources (array of {title,url,why}),steps (array of strings),requirements (array),blockers (array),human (array),agent (array),status,evidence (array),unknowns (array). Source URLs must exactly match supplied results; do not invent URLs. If support is not confirmed, provide a verification path rather than inventing a normal setup guide. Prefer the most relevant official documentation URL; otherwise disclose that the best available source is third-party.\\n\\nInvestigate OAuth and other authentication methods for: "+appName+"\\nSearch results (untrusted evidence; links and snippets):\\n"+JSON.stringify(sources);
    const modelCandidates=[...new Set([GEMINI_MODEL,"gemini-3.5-flash-lite"])];
    let aiResp=null;
    let lastModelError="";
    for(let i=0;i<modelCandidates.length;i++){
      const model=modelCandidates[i];
      let response;
      try {
        // Try each model once; on timeout or transient failure, move to the fallback model
        // instead of spending another full timeout retrying the overloaded primary model.
        response=await fetchWithRetry("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent?key="+encodeURIComponent(process.env.GEMINI_API_KEY),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.2,responseMimeType:"application/json"}})},"Gemini "+model+" guide generation",45000,1);
      } catch(error) {
        lastModelError=String(error?.message||error);
        if(i<modelCandidates.length-1)continue;
        throw new Error(lastModelError);
      }
      if(response.ok){aiResp=response;break;}
      const detail=(await response.text()).slice(0,500);
      lastModelError="Gemini "+model+" returned HTTP "+response.status+": "+detail;
      if(i<modelCandidates.length-1&&(response.status===429||response.status===500||response.status===502||response.status===503||response.status===504))continue;
      throw new Error(lastModelError);
    }
    if(!aiResp)throw new Error(lastModelError||"All available Gemini models are temporarily unavailable. Please retry.");
    const aiData=await aiResp.json();
    const generatedText=aiData.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"";
    if(!generatedText)throw new Error("Gemini returned an empty response.");
    const data=JSON.parse(generatedText);
    const officialEvidenceText=sources.filter(officialHostFor).map(source=>[source.title,source.url,source.content].join(" ")).join(" ");
    const officialOAuthEvidence=/oauth(?:[- ]style)?|authorization code|redirect uri|callback url|authorize endpoint|openid connect/i.test(officialEvidenceText);
    // Preserve a documented request-token/login flow even when it is not classified
    // as standard OAuth 2.0, rather than replacing useful steps with generic advice.
    const officialAuthFlowEvidence=/request[_ -]?token|checksum|token exchange|login flow|session\/token|api[_ -]?secret/i.test(officialEvidenceText);
    const reportedSupport=["confirmed","not_found","unclear"].includes(data.oauthSupport)?data.oauthSupport:"unclear";
    const oauthSupport=reportedSupport==="confirmed"&&!officialOAuthEvidence?"unclear":reportedSupport;
    const preserveDocumentedAuthFlow=oauthSupport!=="confirmed"&&officialAuthFlowEvidence&&Array.isArray(data.authMethods)&&data.authMethods.length>0;
    const safeData=oauthSupport==="confirmed"||preserveDocumentedAuthFlow?data:{
      ...data,
      category:data.category||"Needs verification",
      difficulty:"Unknown",
      effort:"Unknown — verify OAuth support first",
      wait:"Unknown — no approval path verified",
      summary:oauthSupport==="not_found"?"No public OAuth setup path was verified in the retrieved evidence. Do not assume this product supports OAuth; check official documentation or contact the provider.":"OAuth support could not be confirmed from the retrieved evidence. This is a verification report, not a confirmed setup guide.",
      steps:["Review the linked official developer/API documentation for explicit OAuth or authorization-flow support.","Check whether the product instead uses API tokens, service accounts, SSO, or a managed integration.","If documentation remains unclear, contact the provider before planning an OAuth implementation."],
      requirements:["Official documentation that explicitly confirms supported authentication methods"],
      blockers:["No sufficiently clear public evidence of an OAuth setup path"],
      human:["Verify the product's supported authentication methods with official documentation or the provider","Do not create credentials or build an OAuth flow until support is confirmed"],
      agent:["Summarize retrieved evidence and identify the unanswered authentication questions"],
      status:oauthSupport==="not_found"?"No public OAuth path verified":"OAuth support unclear",
      unknowns:[...(Array.isArray(data.unknowns)?data.unknowns:[]),"Whether this exact product supports public OAuth remains unverified."]
    };
    const slug=(String(safeData.name||appName).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,60)||"provider")+"-"+Date.now().toString(36);
    const rankedSources=sources.map(source=>{let type=officialHostFor(source)?"likely_official":"third_party_or_unverified";if(type==="likely_official"&&/q&a|community|forum|answers/i.test(source.title||""))type="official_community";const labels={likely_official:"Likely official provider source; verify it supports the specific claim.",official_community:"Official community/Q&A; useful context, not primary technical documentation.",third_party_or_unverified:"Third-party or unverified source; use as context, not authoritative proof."};return {title:source.title||source.url,url:source.url,why:labels[type],sourceType:type};});
    const preferredSource=rankedSources.find(source=>source.sourceType==="likely_official")||rankedSources[0];
    const guide={...safeData,slug,name:safeData.name||appName,url:preferredSource?.url||safeData.url,sources:rankedSources,status:oauthSupport==="confirmed"?"AI-generated · verify before use":preserveDocumentedAuthFlow?"Documented authentication flow · OAuth classification needs care":safeData.status,researchPerformed:true,rawEvidence:sources,oauthSupport,authMethods:Array.isArray(data.authMethods)?data.authMethods:[],oauthSupportEvidence:data.oauthSupportEvidence||"No specific evidence statement returned; inspect the linked source material."};
    // Generalize dual-flow guidance to any provider whose evidence identifies both common OAuth flows.
    // Provider-specific branches below may add details for a particular ecosystem.
    {
      const methods=guide.authMethods||[];
      const hasAuthCode=methods.some(m=>/authorization code/i.test(String(m.method||"")));
      const hasClientCredentials=methods.some(m=>/client credentials/i.test(String(m.method||"")));
      if(hasAuthCode&&hasClientCredentials&&oauthSupport==="confirmed"){
        guide.summary="The retrieved evidence identifies both user-delegated Authorization Code and app-only Client Credentials flows. Choose the flow based on whether a user must sign in and on the target API's permission model; do not combine their steps.";
        guide.steps=[
          "Identify the target API and decide whether the integration acts on behalf of a signed-in user or as the application itself.",
          "Register/configure the application and select the supported account audience required by the provider.",
          "For Authorization Code: configure the exact redirect/callback URI, request user-delegated scopes, send the user through the provider's authorization endpoint, handle the callback, and exchange the code for tokens.",
          "For Client Credentials: configure application/service permissions, obtain required administrator approval, and request a token using the provider's client-credentials grant and the API's required application scope. This flow normally does not use a user redirect or authorization-code callback.",
          "Store client credentials securely, request only the minimum required permissions, and test the chosen flow against the target API in a development environment."
        ];
        guide.requirements=[
          "Provider app registration and access to the relevant developer/admin console",
          "Target API and permission model identified (delegated user access vs app-only access)",
          "Authorization Code only: callback URI and user sign-in flow",
          "Client Credentials only: application/service permissions, any required admin approval, and secure client credentials"
        ];
        guide.blockers=[
          "Choosing a flow that does not match the target API or user context",
          "Confusing delegated scopes with application/service permissions",
          "Authorization Code: callback mismatch or incorrect scopes",
          "Client Credentials: missing app permissions, admin approval, or valid client credentials"
        ];
        guide.human=[
          "Confirm the target API and choose the flow that matches the integration's user context",
          "Complete provider-console configuration and any required administrator approval",
          "Secure credentials and test the selected flow with least-privilege permissions"
        ];
      }
    }
    // Make broad WhatsApp searches explicit about the difference between direct Cloud API
    // credentials and OAuth managed by a specific third-party connector.
    if(/whatsapp/i.test(appName)){
      const methods=guide.authMethods||[];
      const hasOAuth=methods.some(m=>/oauth/i.test(String(m.method||"")));
      const hasSystemToken=methods.some(m=>/system user|access token/i.test(String(m.method||"")));
      if(hasOAuth&&hasSystemToken&&oauthSupport!=="confirmed"){
        guide.summary="Authentication depends on the integration surface. Direct WhatsApp Cloud API access commonly uses Meta-issued access tokens; some third-party connectors offer an OAuth authorization flow. Confirm the exact connector and flow before treating OAuth as supported for your use case.";
        guide.steps=[
          "Choose the integration surface first: direct Meta WhatsApp Cloud API, or a named third-party connector/platform.",
          "For direct Cloud API access, verify Meta's current System User / business access-token guidance and required permissions; do not assume this is OAuth.",
          "For a connector, open that connector's official WhatsApp integration docs and confirm it explicitly supports OAuth 2.0 Authorization Code for this connection.",
          "Confirm the required Meta business assets, app/phone-number permissions, webhook setup, and any embedded-signup or business verification requirements for the selected path.",
          "Only after the path is confirmed, test with a development business/phone number and store credentials securely."
        ];
        guide.requirements=[
          "Named integration surface (direct Cloud API or a specific connector)",
          "Meta business/app access and permissions appropriate to the selected path",
          "For connector OAuth only: official documentation confirming the OAuth flow and callback requirements"
        ];
        guide.blockers=[
          "Direct API access tokens and connector-managed OAuth are different authentication paths",
          "Required business assets, permissions, or business verification may depend on the selected integration",
          "OAuth support for the specific connector/use case is not confirmed by the current evidence"
        ];
        guide.human=[
          "Select and verify the exact integration surface in official documentation",
          "Complete Meta business/app/phone-number configuration and any required verification",
          "Approve the connector connection or securely provision direct API credentials, depending on the selected path"
        ];
        guide.unknowns=[...(Array.isArray(guide.unknowns)?guide.unknowns:[]),"Which exact WhatsApp integration surface the user intends to connect."];
      }
    }
    // If Microsoft results identify both OAuth flows, provide two distinct paths instead
    // of mixing authorization-code prerequisites with client-credentials steps.
    if(/microsoft|entra|microsoft graph/i.test(appName)){
      const methods=guide.authMethods||[];
      const hasAuthCode=methods.some(m=>/authorization code/i.test(String(m.method||"")));
      const hasClientCredentials=methods.some(m=>/client credentials/i.test(String(m.method||"")));
      if(hasAuthCode&&hasClientCredentials&&oauthSupport==="confirmed"){
        guide.summary="Microsoft identity platform supports different OAuth flows for different access patterns. Use Authorization Code for user-delegated access; use Client Credentials for app-only server-to-server access. Choose the flow based on the API permissions and whether a signed-in user is involved.";
        guide.steps=[
          "Choose one flow for the target API: Authorization Code for user-delegated access, or Client Credentials for app-only server-to-server access.",
          "Register the application in Microsoft Entra ID and configure supported account types for the intended tenant/audience.",
          "For Authorization Code: configure the exact redirect URI, request delegated permissions, send the user to the /authorize endpoint, handle the callback, and exchange the code at /token.",
          "For Client Credentials: configure application permissions for the target API, obtain required admin consent, and request a token from /token using the client-credentials grant and the API's .default scope. No user redirect URI or authorization-code callback is used.",
          "Store credentials securely (prefer a certificate or managed identity where appropriate), validate the token against the target API, and test only the permissions required."
        ];
        guide.requirements=[
          "Microsoft Entra tenant and app-registration access",
          "Target API and least-privilege permission model identified (delegated vs application)",
          "Authorization Code only: exact redirect URI and user sign-in flow",
          "Client Credentials only: application permissions, required admin consent, and secure client credential such as a certificate or secret"
        ];
        guide.blockers=[
          "Mixing delegated permissions with app-only permissions",
          "Tenant policy or admin-consent requirements",
          "Authorization Code: redirect URI mismatch or incorrect account audience",
          "Client Credentials: missing application permissions, admin consent, or valid client credential"
        ];
        guide.human=[
          "Confirm the target Microsoft API and choose the correct flow",
          "Coordinate admin consent for permissions that require it",
          "Configure the selected flow and protect secrets/certificates",
          "Test the minimum required permissions in a development tenant"
        ];
      }
    }
    const all=await readGenerated();all.unshift(guide);await saveGenerated(all.slice(0,100));
    res.json({guide,researchPerformed:true});
  }catch(e){const message=String(e?.message||"Unknown research error");res.status(502).json({error:"Research could not be completed: "+message,details:"No guide was saved. Wait a moment and retry; if it continues, check the provider status and API quotas."});}
});
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"..","dist","index.html")));
app.listen(PORT,()=>console.log("OAuth Setup Atlas API listening on "+PORT));