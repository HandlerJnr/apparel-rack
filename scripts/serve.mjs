import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const port = Number(process.env.PORT || 4173);
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webp':'image/webp','.svg':'image/svg+xml','.json':'application/json'};
createServer(async (req,res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    let path = resolve(root, '.' + pathname);
    if (path !== resolve(root) && !path.startsWith(resolve(root)+sep)) { res.writeHead(403).end(); return; }
    if ((await stat(path)).isDirectory()) path = resolve(path,'index.html');
    const body = await readFile(path);
    res.writeHead(200, {'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-store'}).end(body);
  } catch { res.writeHead(404,{'Content-Type':'text/plain'}).end('Not found'); }
}).listen(port,'127.0.0.1',()=>console.log(`Preview: http://localhost:${port}`));
