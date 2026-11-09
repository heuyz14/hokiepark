import { createServer } from 'node:http';
import { handle, createLimiter, type Env } from '../../supabase/functions/advisor/handler.ts';
const port = Number(process.env.HOKIEPARK_BACKEND_PORT ?? 8788);
const env: Env = {
  SUPABASE_URL: process.env.SUPABASE_URL ?? process.env.HOKIEPARK_SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ?? process.env.HOKIEPARK_SUPABASE_ANON_KEY,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
};
const limiter = createLimiter();
createServer(async (req, res) => {
  try {
    if (req.url?.split('?')[0] !== '/api/parking-chat') { res.writeHead(404).end(); return; }
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of req) { bytes += chunk.length; if(bytes > 60_000) {res.writeHead(413).end(); return;} chunks.push(chunk); }
    const headers = new Headers();
    for(const [key,value] of Object.entries(req.headers)) if(value) headers.set(key,Array.isArray(value)?value.join(','):value);
    headers.set('x-forwarded-for',req.socket.remoteAddress ?? 'local');
    const request = new Request(`http://localhost:${port}${req.url}`, {method:req.method,headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})});
    const response=await handle(request,env,{fetch,now:Date.now,limiter});
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
  } catch {res.writeHead(500).end('Backend request failed');}
}).listen(port,'127.0.0.1',()=>console.log(`Parking backend: http://localhost:${port}/api/parking-chat`));
