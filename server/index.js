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
    const sources=(searchData.results||[]).map(x=>({title:x.title,url:x.url,content:(x.content||"").slice(0,1800)}));
    if(!sources.length)throw new Error("No useful search results found. Try the provider's official name or documentation URL.");
    const normalizedProvider=appName.toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
    const officialHostFor=(source)=>{try{const host=new URL(source.url).hostname.toLowerCase();if(/whatsapp|meta/i.test(appName)&&(/(^|\.)facebook\.com$|(^|\.)whatsapp\.com$|(^|\.)meta\.com$/.test(host)))return true;const tokens=normalizedProvider.split(" ").filter(t=>t.length>2&&!["business","platform","cloud","api","oauth","integration"].includes(t));return tokens.some(t=>host.includes(t));}catch{return false;}};
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
    const officialOAuthEvidence=sources.some(source=>officialHostFor(source)&&/oauth|authorization code|redirect uri|callback url|authorize endpoint|openid connect/i.test([source.title,source.url,source.content].join(" ")));
    const reportedSupport=["confirmed","not_found","unclear"].includes(data.oauthSupport)?data.oauthSupport:"unclear";
    const oauthSupport=reportedSupport==="confirmed"&&!officialOAuthEvidence?"unclear":reportedSupport;
    const safeData=oauthSupport==="confirmed"?data:{
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
    const rankedSources=sources.map(source=>({title:source.title||source.url,url:source.url,why:officialHostFor(source)?"Likely official provider documentation; confirm it supports the specific claim.":"Third-party or unverified source; use as context, not authoritative proof.",sourceType:officialHostFor(source)?"likely_official":"third_party_or_unverified"}));
    const preferredSource=rankedSources.find(source=>source.sourceType==="likely_official")||rankedSources[0];
    const guide={...safeData,slug,name:safeData.name||appName,url:preferredSource?.url||safeData.url,sources:rankedSources,status:oauthSupport==="confirmed"?"AI-generated · verify before use":safeData.status,researchPerformed:true,rawEvidence:sources,oauthSupport,authMethods:Array.isArray(data.authMethods)?data.authMethods:[],oauthSupportEvidence:data.oauthSupportEvidence||"No specific evidence statement returned; inspect the linked source material."};
    const all=await readGenerated();all.unshift(guide);await saveGenerated(all.slice(0,100));
    res.json({guide,researchPerformed:true});
  }catch(e){const message=String(e?.message||"Unknown research error");res.status(502).json({error:"Research could not be completed: "+message,details:"No guide was saved. Wait a moment and retry; if it continues, check the provider status and API quotas."});}
});
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"..","dist","index.html")));
app.listen(PORT,()=>console.log("OAuth Setup Atlas API listening on "+PORT));