import http from 'node:http';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { extname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const root = fileURLToPath(new URL('.', import.meta.url));
const workspace = resolve(process.env.CRAZY_WORKSPACE || join(root, 'workspace'));
const dataDir = resolve(process.env.CRAZY_DATA || join(root, 'data'));
const memoryFile = join(dataDir, 'memory.json');
const auditFile = join(dataDir, 'audit.jsonl');
const port = Number(process.env.PORT || 3000);
const modelProvider = (process.env.MODEL_PROVIDER || 'auto').toLowerCase();
const modelBase = process.env.MODEL_BASE_URL || 'http://localhost:11434';
const modelName = process.env.MODEL_NAME || 'qwen2.5:7b';
const apiKey = process.env.OPENAI_API_KEY || '';
const maxBody = 2_000_000;
const mime = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.txt':'text/plain; charset=utf-8','.md':'text/markdown; charset=utf-8' };

await mkdir(workspace, { recursive:true });
await mkdir(dataDir, { recursive:true });
try { await readFile(memoryFile); } catch { await writeFile(memoryFile, JSON.stringify({ shortTerm:[], projects:{}, longTerm:[] }, null, 2)); }

function json(res,status,body,headers={}) { res.writeHead(status,{ 'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers }); res.end(JSON.stringify(body)); }
function text(res,status,body,type='text/plain; charset=utf-8') { res.writeHead(status,{ 'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff' }); res.end(body); }
function id() { return crypto.randomUUID(); }
function safePath(input) { const target=resolve(workspace, String(input||'')); const rel=relative(workspace,target); if(rel.startsWith('..') || rel.includes('..'+requireSeparator())) throw new Error('Path outside Crazy Bot workspace'); return target; }
function requireSeparator(){ return process.platform==='win32'?'\\':'/'; }
async function body(req) { let raw=''; for await(const c of req){ raw+=c; if(raw.length>maxBody) throw new Error('Request too large'); } return JSON.parse(raw||'{}'); }
async function audit(action, meta={}) { const row={ id:id(), at:new Date().toISOString(), action, ...meta }; await writeFile(auditFile, JSON.stringify(row)+'\n',{flag:'a'}); }
async function loadMemory(){ return JSON.parse(await readFile(memoryFile,'utf8')); }
async function saveMemory(m){ return writeFile(memoryFile,JSON.stringify(m,null,2)); }

const agents = { orchestrator:'Routes intent and coordinates agents.', reasoning:'Breaks problems into assumptions and decisions.', critic:'Finds risks and weak assumptions.', creative:'Generates alternatives.', coding:'Designs implementation and tests.', research:'Structures research and evidence.', planning:'Turns goals into executable plans.', voice:'Coordinates speech interaction.', memory:'Manages explicit memory.' };
function route(mode,message){
  if(mode==='code' || /\b(code|build|debug|bug|api|program|website|app)\b/i.test(message)) return ['orchestrator','coding','critic'];
  if(mode==='research') return ['orchestrator','research','critic'];
  if(mode==='plan') return ['orchestrator','planning','critic'];
  if(mode==='create') return ['orchestrator','creative','critic'];
  return ['orchestrator','reasoning','critic'];
}
function fallback(message,mode,execution){ return `I routed this through ${execution.slice(1).join(' + ')}.\n\nGOAL\n${message}\n\nNEXT MOVE\nDefine the smallest testable version, its success metric, and one concrete action now.${mode==='crazy'?'\n\nCHALLENGE\nWhat assumption would make this fail? Who has the problem badly enough to act? What is the fastest experiment that could disprove it?':''}`; }
async function modelChat(messages){
  const provider=modelProvider==='auto'?(apiKey?'openai':'ollama'):modelProvider;
  if(provider==='none') return null;
  if(provider==='openai' && apiKey){ const r=await fetch((process.env.OPENAI_BASE_URL||'https://api.openai.com/v1')+'/chat/completions',{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${apiKey}`},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-5-mini',messages,temperature:.4})}); if(!r.ok) throw new Error(`Model provider returned ${r.status}`); const d=await r.json(); return d.choices?.[0]?.message?.content||null; }
  if(provider==='ollama'){ const r=await fetch(modelBase.replace(/\/$/,'')+'/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:modelName,messages,stream:false})}); if(!r.ok) throw new Error(`Local model returned ${r.status}`); const d=await r.json(); return d.message?.content||null; }
  return null;
}
async function chat(input){
  const message=String(input.message||'').trim(); if(!message) throw new Error('Message is required.');
  const mode=String(input.mode||'crazy').toLowerCase(), execution=route(mode), memory=await loadMemory();
  let response=null, provider='fallback';
  try { response=await modelChat([{role:'system',content:`You are Crazy Bot. Encourage the person, challenge the idea, build the solution. Mode=${mode}. Agents=${execution.join(', ')}. Be practical and concise.`},{role:'user',content:message}]); if(response) provider=modelProvider==='auto'?(apiKey?'openai':'ollama'):modelProvider; } catch(e) { await audit('model_error',{error:e.message}); }
  if(!response) response=fallback(message,mode,execution);
  memory.shortTerm.push({role:'user',content:message,at:new Date().toISOString()},{role:'assistant',content:response,at:new Date().toISOString()}); memory.shortTerm=memory.shortTerm.slice(-40); await saveMemory(memory); await audit('chat',{mode,execution,provider});
  return {ok:true,id:id(),mode,execution,provider,response,steps:['Understand','Challenge','Explore','Compare','Score','Improve','Execute']};
}
async function listFiles(dir=''){ const base=safePath(dir), entries=await readdir(base,{withFileTypes:true}); return Promise.all(entries.filter(e=>!e.name.startsWith('.')).map(async e=>{const p=join(base,e.name),s=await stat(p);return {name:e.name,type:e.isDirectory()?'directory':'file',size:s.size,modified:s.mtime.toISOString(),path:relative(workspace,p)};})); }

const server=http.createServer(async(req,res)=>{ try{
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&url.pathname==='/health') return json(res,200,{ok:true,service:'crazy-bot',status:'healthy',uptime:process.uptime()});
  if(req.method==='GET'&&url.pathname==='/api/status') return json(res,200,{ok:true,local:true,network:!!apiKey,provider:modelProvider,model:modelProvider==='ollama'?modelName:(process.env.OPENAI_MODEL||'not configured'),agents:Object.keys(agents),version:'2.0.0'});
  if(req.method==='GET'&&url.pathname==='/api/memory') return json(res,200,await loadMemory());
  if(req.method==='POST'&&url.pathname==='/api/chat') return json(res,200,await chat(await body(req)));
  if(req.method==='POST'&&url.pathname==='/api/memory'){const b=await body(req),m=await loadMemory(),item={id:id(),text:String(b.text||'').slice(0,5000),project:String(b.project||'default'),at:new Date().toISOString()};m.longTerm.push(item);await saveMemory(m);await audit('memory_add',{memoryId:item.id});return json(res,201,{ok:true,item});}
  if(req.method==='DELETE'&&url.pathname.startsWith('/api/memory/')){const mid=url.pathname.split('/').pop(),m=await loadMemory();m.longTerm=m.longTerm.filter(x=>x.id!==mid);await saveMemory(m);await audit('memory_delete',{memoryId:mid});return json(res,200,{ok:true});}
  if(req.method==='GET'&&url.pathname==='/api/files') return json(res,200,{ok:true,files:await listFiles(url.searchParams.get('path')||'')});
  if(req.method==='GET'&&url.pathname==='/api/file'){const p=safePath(url.searchParams.get('path'));if(!(await stat(p)).isFile())throw new Error('Not a file');return text(res,200,await readFile(p,'utf8'));}
  if(req.method==='POST'&&url.pathname==='/api/file'){const b=await body(req),p=safePath(b.path),rel=relative(workspace,p);if(!rel||rel.startsWith('..'))throw new Error('Invalid path');await mkdir(resolve(p,'..'),{recursive:true});await writeFile(p,String(b.content||''));await audit('file_write',{path:rel});return json(res,201,{ok:true,path:rel});}
  if(req.method==='GET'){const path=url.pathname==='/'?'/index.html':url.pathname,safe=path.replace(/\.\./g,''),file=join(root,'public',safe);try{return text(res,200,await readFile(file),mime[extname(file)]||'application/octet-stream');}catch{return json(res,404,{error:'Not found'});}}
  return json(res,405,{error:'Method not allowed'});
 }catch(e){await audit('error',{error:e.message});return json(res,400,{ok:false,error:e.message});}});
server.listen(port,'0.0.0.0',()=>console.log(`Crazy Bot listening on ${port}`));
