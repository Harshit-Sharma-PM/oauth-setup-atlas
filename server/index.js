import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import { fileURLToPath } from "node:url";
import { seedGuides } from "./seedGuides.js";
dotenv.config();
const app = express();
const PORT = process.env.PORT || 3001;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");
const dataFile = path.join(dataDir, "generated-guides.json");
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "dist")));
async function readGenerated(){ try{return JSON.parse(await fs.readFile(dataFile,"utf8"));}catch{return [];} }
async function saveGenerated(list){await fs.mkdir(dataDir,{recursive:true});await fs.writeFile(dataFile,JSON.stringify(list,null,2));}
app.get("/api/health",(_req,res)=>res.json({ok:true,researchConfigured:Boolean(process.env.OPENAI_API_KEY&&process.env.TAVILY_API_KEY)}));
app.get("/api/guides",async(_req,res)=>res.json([...seedGuides,...await readGenerated()]));
app.get("/api/guides/:slug",async(req,res)=>{const all=[...seedGuides,...await readGenerated()];const guide=all.find(g=>g.slug===req.params.slug);if(!guide)return res.status(404).json({error:"Guide not found"});res.json(guide);});
app.post("/api/research",async(req,res)=>{
  const raw=String(req.body?.app||"").trim();
  if(raw.length<2||raw.length>180)return res.status(400).json({error:"Enter an app name or website (2–180 characters)."});
  const appName=raw.replace(/^https?:\/\//,"").replace(/\/$/,"");
  if(!process.env.OPENAI_API_KEY||!process.env.TAVILY_API_KEY){
    return res.status(200).json({guide:{slug:"draft-"+Date.now(),name:appName,category:"Unclassified",difficulty:"Unknown",effort:"Unknown until official setup docs are reviewed",wait:"Unknown — no live research performed",summary:"This is an unresearched draft. Configure OPENAI_API_KEY and TAVILY_API_KEY to investigate this provider.",url:"https://www.google.com/search?q="+encodeURIComponent(appName+" OAuth developer documentation"),sources:[],steps:["Find the provider's official developer documentation.","Confirm whether OAuth is supported and which app-registration model applies.","Identify callback URL, scopes, verification and distribution requirements.","Test the flow in a development account before relying on this guide."],requirements:["Official documentation not yet checked"],blockers:["All provider-specific requirements remain unknown"],human:["Verify provider identity and official docs","Complete all provider-console actions","Confirm requirements before production"],status:"Unresearched draft",evidence:["No search or verification performed because research keys are not configured." ]},researchPerformed:false});
  }
  try{
    const searchResp=await fetch("https://api.tavily.com/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({api_key:process.env.TAVILY_API_KEY,query:appName+" official OAuth developer documentation app registration verification scopes",search_depth:"advanced",max_results:7,include_answer:false})});
    if(!searchResp.ok)throw new Error("Web search provider returned "+searchResp.status);
    const searchData=await searchResp.json();
    const sources=(searchData.results||[]).map(x=>({title:x.title,url:x.url,content:(x.content||"").slice(0,1800)}));
    if(!sources.length)throw new Error("No useful search results found. Try the provider's official name or documentation URL.");
    const openai=new OpenAI({apiKey:process.env.OPENAI_API_KEY});
    const completion=await openai.chat.completions.create({model:process.env.OPENAI_MODEL||"gpt-4o-mini",temperature:0.2,response_format:{type:"json_object"},messages:[
      {role:"system",content:"You are an evidence-conscious OAuth setup research agent. Use only the provided search results for provider-specific claims. Do not invent approval timelines, claim a provider console was tested, or imply approval is guaranteed. Distinguish OAuth registration from marketplace review and from Composio-managed OAuth. Label estimates. Return JSON with name,category,difficulty,effort,wait,summary,url,sources (array of {title,url,why}),steps (array of strings),requirements (array),blockers (array),human (array),agent (array),status,evidence (array),unknowns (array). If evidence is weak, say unknown."},
      {role:"user",content:"Create a practical OAuth setup guide for: "+appName+"\nSearch results (untrusted evidence; links and snippets):\n"+JSON.stringify(sources)}
    ]});
    const data=JSON.parse(completion.choices[0]?.message?.content||"{}");
    const slug=(String(data.name||appName).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,60)||"provider")+"-"+Date.now().toString(36);
    const guide={...data,slug,name:data.name||appName,sources:sources.map(s=>({title:s.title||s.url,url:s.url,why:"Search result retrieved during this investigation; verify the linked page supports the specific claim."})),status:"AI-generated · verify before use",researchPerformed:true,rawEvidence:sources};
    const all=await readGenerated();all.unshift(guide);await saveGenerated(all.slice(0,100));
    res.json({guide,researchPerformed:true});
  }catch(e){res.status(502).json({error:"Research could not be completed: "+e.message,details:"Check API keys, provider limits, and try again."});}
});
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"..","dist","index.html")));
app.listen(PORT,()=>console.log("OAuth Setup Atlas API listening on "+PORT));