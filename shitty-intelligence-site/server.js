// Tiny server for the shitty intelligence site. No dependencies.
// Railway variables it reads:
//   CA       pump.fun contract address (required for live data)
//   WALLET   fee wallet address (optional: enables balance + receipts)
//   RPC_URL  your own Solana RPC endpoint (optional: stays server-side, never sent to the browser)
//   X_URL    X profile link (optional)
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
function address(name){
  const v = (process.env[name] || "").trim();
  if(v && !BASE58.test(v)) console.warn(`${name} is set but is not a valid Solana address; ignoring it.`);
  return BASE58.test(v) ? v : "";
}
const CA = address('CA');
const WALLET = address('WALLET');
const RPC_URL = (process.env.RPC_URL || "https://solana-rpc.publicnode.com").trim();
const X_URL = /^https:\/\/(x|twitter)\.com\/\w{1,15}$/.test((process.env.X_URL || "").trim()) ? process.env.X_URL.trim() : "";

const config = { ca: CA, wallet: WALLET, rpc: "/rpc" };
if(X_URL) config.x = X_URL;
const CONFIG_JS = `window.SI_CONFIG = ${JSON.stringify(config)};`;

const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/poop.png': ['poop.png', 'image/png'],
};

// The page only needs three read-only calls, and only about its own two addresses.
const RPC_METHODS = new Set(['getAccountInfo', 'getBalance', 'getSignaturesForAddress']);
const cache = new Map(); // request body -> { at, text }
const CACHE_MS = 10000;

function send(res, status, type, body, extra = {}){
  res.writeHead(status, { 'content-type': type, 'x-content-type-options': 'nosniff', ...extra });
  res.end(body);
}

async function handleRpc(req, res){
  let raw = "";
  for await (const chunk of req){
    raw += chunk;
    if(raw.length > 2000) return send(res, 413, 'application/json', '{"error":"too large"}');
  }
  let call;
  try { call = JSON.parse(raw); } catch { return send(res, 400, 'application/json', '{"error":"bad json"}'); }
  const target = Array.isArray(call.params) ? call.params[0] : null;
  if(!RPC_METHODS.has(call.method) || !target || (target !== CA && target !== WALLET))
    return send(res, 403, 'application/json', '{"error":"not allowed"}');

  const key = JSON.stringify([call.method, call.params]);
  const hit = cache.get(key);
  if(hit && Date.now() - hit.at < CACHE_MS) return send(res, 200, 'application/json', hit.text);
  try {
    const upstream = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: call.method, params: call.params }),
    });
    const text = await upstream.text();
    if(upstream.ok) cache.set(key, { at: Date.now(), text });
    send(res, upstream.ok ? 200 : 502, 'application/json', text);
  } catch (e) {
    send(res, 502, 'application/json', '{"error":"rpc unreachable"}');
  }
}

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if(url === '/config.js') return send(res, 200, 'application/javascript; charset=utf-8', CONFIG_JS, { 'cache-control': 'no-store' });
  if(url === '/rpc' && req.method === 'POST') return handleRpc(req, res);
  const file = FILES[url];
  if(!file || req.method !== 'GET') return send(res, 404, 'text/plain', 'not found');
  fs.readFile(path.join(__dirname, file[0]), (err, data) => {
    if(err) return send(res, 500, 'text/plain', 'error');
    send(res, 200, file[1], data, { 'cache-control': file[0] === 'index.html' ? 'no-cache' : 'public, max-age=86400' });
  });
}).listen(PORT, () => {
  console.log(`shitty intelligence listening on ${PORT}`);
  console.log(CA ? `CA: ${CA}` : 'No CA set. Add a CA variable to show live data.');
  console.log(WALLET ? `Wallet: ${WALLET}` : 'No WALLET set. Balance and receipts are off.');
});
