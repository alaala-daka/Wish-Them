/**
 * 本地开发服务器：用 node:http 把请求喂给 backend/server.ts 的 createApp()。
 *
 *   node tools/local/serve.ts            # 默认 http://127.0.0.1:8787
 *   curl -s http://127.0.0.1:8787/api/health
 *   curl -s http://127.0.0.1:8787/functions/v1/app/api/health   # 线上物理路径也可用
 *
 * 除业务 API 外，还托管 /__storage/{upload,get}/... 两段式直传的本地对象存储，
 * 让浏览器可以真正完成「presign → PUT → complete → 签名 URL 展示」全链路。
 *
 * 只用于本地：密钥来自 tools/local/deps.ts 的默认值，数据在内存里，重启即清空。
 * 线上入口是 backend/index.ts（Deno + 平台注入的 _qoder 客户端），不要在这里加业务逻辑。
 */
import http from 'node:http';
import { createApp } from '../../backend/server.ts';
import { createLocalDeps } from './deps.ts';

const PHYSICAL_PREFIX = '/functions/v1/app';
const STORAGE_PREFIX = '/__storage';
const PORT = Number(process.env.PORT ?? 8787);
// 本地开发用真实时钟，前端算出的「今天」才能和任务日期对上；冒烟测试仍用固定时钟。
// 对象存储返回同源相对路径，开发时由 Vite 把 /__storage 代理到这里。
// 本地反复联调/清缓存时不要被游客注册上限卡住（线上仍按配置的 10 次/小时执行）。
const deps = createLocalDeps(new Date().toISOString(), { guestPerHour: 1000, demoPerHour: 1000 }, '/__storage');
const app = createApp(deps);

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function handleStorage(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  const [, , kind, encoded] = url.pathname.split('/');
  if (encoded === undefined) {
    res.writeHead(404).end('not found');
    return;
  }
  let objectPath: string;
  try {
    objectPath = decodeURIComponent(encoded);
  } catch {
    res.writeHead(400).end('bad object key');
    return;
  }

  if (kind === 'upload' && (req.method === 'PUT' || req.method === 'POST')) {
    const bytes = await readBody(req);
    deps.storage.put(objectPath, new Uint8Array(bytes), String(req.headers['content-type'] ?? 'application/octet-stream'));
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('ok');
    return;
  }

  if (kind === 'get' && (req.method === 'GET' || req.method === 'HEAD')) {
    const object = await deps.storage.download(objectPath);
    if (!object.ok) {
      res.writeHead(object.status).end('not found');
      return;
    }
    const bytes = Buffer.from(await object.arrayBuffer());
    res.writeHead(200, {
      'content-type': object.headers.get('content-type') ?? 'application/octet-stream',
      'content-length': String(bytes.byteLength),
      'cache-control': 'private, max-age=600',
    });
    res.end(req.method === 'HEAD' ? undefined : bytes);
    return;
  }

  res.writeHead(405, { allow: kind === 'upload' ? 'PUT, POST' : 'GET, HEAD' }).end('method not allowed');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);

  if (url.pathname.startsWith(STORAGE_PREFIX + '/')) {
    try {
      await handleStorage(req, res, url);
    } catch (error) {
      console.error('[local] storage crashed', error);
      if (!res.headersSent) res.writeHead(500).end('storage error');
    }
    return;
  }

  // 允许省略物理前缀，方便 curl；带前缀时与线上完全一致
  const pathname = url.pathname.startsWith(PHYSICAL_PREFIX) ? url.pathname : PHYSICAL_PREFIX + url.pathname;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);

  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(name, value);
    else if (Array.isArray(value) && value.length > 0) headers.set(name, value[0] as string);
  }

  const method = req.method ?? 'GET';
  const request = new Request(`${url.origin}${pathname}${url.search}`, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' || chunks.length === 0 ? undefined : Buffer.concat(chunks),
  });

  try {
    const response = await app(request);
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error('[local] handler crashed', error);
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 500, data: null, message: 'internal_error' }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[local] yuan-ta api on http://127.0.0.1:${PORT}${PHYSICAL_PREFIX}/api/health`);
  console.log(`[local] object storage on http://127.0.0.1:${PORT}${STORAGE_PREFIX}`);
});
