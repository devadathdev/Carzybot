import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 3000);
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml' };

function respond(res, status, body, type='application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

async function chat(body) {
  const message = String(body?.message || '').trim();
  const mode = String(body?.mode || 'crazy').toLowerCase();
  if (!message) return { ok:false, error:'Message is required.' };

  const agents = mode === 'code' ? ['orchestrator','coding','critic']
    : mode === 'research' ? ['orchestrator','research','critic']
    : mode === 'plan' ? ['orchestrator','planning','critic']
    : ['orchestrator','reasoning','critic'];

  const challenge = mode === 'crazy';
  return {
    ok: true,
    mode,
    execution: agents,
    response: challenge
      ? `CRAZY MODE\n\nI understand the goal: “${message}”\n\nFirst challenge: the idea is only as strong as its unproven assumptions. Before building blindly, identify the user, the painful problem, the strongest alternative, and the fastest experiment that could prove demand.\n\nNext action: turn this into a concrete experiment with a measurable success condition.`
      : `I’ve routed this to ${agents.slice(1).join(' + ')}. For the MVP, the next step is to define the smallest executable version of: “${message}”.`,
    disclaimer: 'MVP orchestration response — connect a local model provider for full inference.'
  };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') return respond(res, 200, JSON.stringify({ ok:true, service:'crazy-bot', status:'healthy' }));
    if (req.method === 'GET' && req.url === '/api/status') return respond(res, 200, JSON.stringify({ local:true, network:false, agents:['orchestrator','reasoning','critic','coding','research','planning'], version:'1.0.0-mvp' }));
    if (req.method === 'POST' && req.url === '/api/chat') {
      let raw='';
      for await (const chunk of req) raw += chunk;
      return respond(res, 200, JSON.stringify(await chat(JSON.parse(raw || '{}'))));
    }
    if (req.method === 'GET') {
      const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
      const safe = path.replace(/\.\./g, '');
      const file = join(root, 'public', safe);
      try { return respond(res, 200, await readFile(file), mime[extname(file)] || 'application/octet-stream'); }
      catch { return respond(res, 404, JSON.stringify({ error:'Not found' })); }
    }
    return respond(res, 405, JSON.stringify({ error:'Method not allowed' }));
  } catch (err) { return respond(res, 500, JSON.stringify({ ok:false, error:err.message })); }
});

server.listen(port, '0.0.0.0', () => console.log(`Crazy Bot listening on ${port}`));
