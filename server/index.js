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
app.get("/api/health",(_req,res)=>res.json({ok:true,researchConfigured:Boolean(process.env.GEMINI_API_KEY&&process.env.TAVILY_API_KEY),geminiModel:GEMINI_MODEL}));
app.get("/api/guides",async(_req,res)=>res.json([...seedGuides,...await readGenerated()]));
app.get("/api/guides/:slug",async(req,res)=>{const all=[...seedGuides,...await readGenerated()];const guide=all.find(g=>g.slug===req.params.slug);if(!guide)return res.status(404).json({error:"Guide not found"});res.json(guide);});
app.post("/api/research",async(req,res)=>{
  const raw=String(req.body?.app||"").trim();
  if(raw.length<2||raw.length>180)return res.status(400).json({error:"Enter an app name or website (2–180 characters)."});
  const appName=raw.replace(/^https?:\/\//,"").replace(/\/$/,"");
  if(!process.env.GEMINI_API_KEY||!process.env.TAVILY_API_KEY){
    return res.status(200).json({guide:{slug:"draft-"+Date.now(),name:appName,category:"Unclassified",difficulty:"Unknown",effort:"Unknown until official setup docs are reviewed",wait:"Unknown — no live research performed",summary:"This is an unresearched draft. Configure GEMINI_API_KEY and TAVILY_API_KEY to investigate this provider.",url:"https://www.google.com/search?q="+encodeURIComponent(appName+" OAuth developer documentation"),sources:[],steps:["Find the provider's official developer documentation.","Confirm whether OAuth is supported and which app-registration model applies.","Identify callback URL, scopes, verification and distribution requirements.","Test the flow in a development account before relying on this guide."],requirements:["Official documentation not yet checked"],blockers:["All provider-specific requirements remain unknown"],human:["Verify provider identity and official docs","Complete all provider-console actions","Confirm requirements before production"],status:"Unresearched draft",evidence:["No search or verification performed because research keys are not configured."]},researchPerformed:false});
  }
  try{
    const searchResp=await fetch("https://api.tavily.com/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({api_key:process.env.TAVILY_API_KEY,query:appName+" official OAuth developer documentation app registration verification scopes",search_depth:"advanced",max_results:7,include_answer:false})});
    if(!searchResp.ok){const detail=(await searchResp.text()).slice(0,500);throw new Error("Web search provider returned "+searchResp.status+": "+detail);}
    const searchData=await searchResp.json();
    const sources=(searchData.results||[]).map(x=>({title:x.title,url:x.url,content:(x.content||"").slice(0,1800)}));
    if(!sources.length)throw new Error("No useful search results found. Try the provider's official name or documentation URL.");
    const prompt="You are an evidence-conscious OAuth setup research agent. Use only the provided search results for provider-specific claims. Do not invent approval timelines, claim a provider console was tested, or imply approval is guaranteed. Distinguish OAuth registration from marketplace review and from Composio-managed OAuth. Label estimates. Return only valid JSON with name,category,difficulty,effort,wait,summary,url,sources (array of {title,url,why}),steps (array of strings),requirements (array),blockers (array),human (array),agent (array),status,evidence (array),unknowns (array). If evidence is weak, say unknown.\n\nCreate a practical OAuth setup guide for: "+appName+"\nSearch results (untrusted evidence; links and snippets):\n"+JSON.stringify(sources);
    const aiResp=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(GEMINI_MODEL)+":generateContent?key="+encodeURIComponent(process.env.GEMINI_API_KEY),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.2,responseMimeType:"application/json"}})});
    if(!aiResp.ok){const detail=(await aiResp.text()).slice(0,700);throw new Error("Gemini "+GEMINI_MODEL+" returned HTTP "+aiResp.status+": "+detail);}
    const aiData=await aiResp.json();
    const generatedText=aiData.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"";
    if(!generatedText)throw new Error("Gemini returned an empty response.");
    const data=JSON.parse(generatedText);
    const slug=(String(data.name||appName).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,60)||"provider")+"-"+Date.now().toString(36);
    const guide={...data,slug,name:data.name||appName,sources:sources.map(s=>({title:s.title||s.url,url:s.url,why:"Search result retrieved during this investigation; verify the linked page supports the specific claim."})),status:"AI-generated · verify before use",researchPerformed:true,rawEvidence:sources};
    const all=await readGenerated();all.unshift(guide);await saveGenerated(all.slice(0,100));
    res.json({guide,researchPerformed:true});
  }catch(e){res.status(502).json({error:"Research could not be completed: "+e.message,details:"Check API keys, provider limits, and try again."});}
});
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"..","dist","index.html")));
app.listen(PORT,()=>console.log("OAuth Setup Atlas API listening on "+PORT));