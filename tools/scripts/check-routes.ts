/**
 * 路由表自洽校验：manifest.ts 是平台要求「一个 app Function 内手工登记」的唯一入口，
 * 漏登记会让线上出现「文件存在但 404」，这种错误在本地最容易溜过去。
 *
 *   node tools/scripts/check-routes.ts
 *
 * manifest.ts 的实际格式（本脚本按它解析，改动格式要同步改这里）：
 *   import guest, { route as guestRoute } from './auth/guest.ts';
 *   export const routes: RouteModule[] = [{ route: guestRoute, default: guest }];
 * ⇒ 字段唯一真相在各接口文件的 `export const route` 里，manifest 只做登记与排序。
 *
 * 检查项：
 * 1) manifest 里每条登记都能追溯到真实文件，且该文件同时导出 route 声明与 default handler；
 * 2) route.path 与文件位置推导出的逻辑路径一致（例外规则见 fileToPath）；
 * 3) 逻辑路径必须落在 /api/ 下（平台物理路径 = /functions/v1/app + 该逻辑路径）；
 * 4) method/auth/idempotent 取值合法；maxBodyBytes 为 0（无请求体，仅 GET/DELETE）或 128B~1MB；
 * 5) operation 形如 `module.action`，(method, path) 与 operation 都不重复；
 * 6) GET 不参与幂等（重放语义与只读冲突）；写接口 idempotent 不为 none 时必须有 operation；
 * 7) routes 目录下不存在「有文件、没登记」的漏网路由。
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const API_DIR = join(ROOT, 'backend', 'routes');
const MANIFEST = join(API_DIR, 'manifest.ts');
const METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'];
const AUTH = ['none', 'bearer'];
const IDEMPOTENT = ['none', 'optional', 'required'];
const STRING_FIELDS = ['path', 'method', 'auth', 'operation', 'idempotent'] as const;

const problems: string[] = [];

interface Declared {
  file: string;
  path: string;
  method: string;
  auth: string;
  operation: string;
  idempotent: string;
  maxBodyBytes: number;
}

/** manifest.ts → 已登记文件列表（保持声明顺序，顺序即路由匹配顺序） */
function parseManifest(source: string): string[] {
  const aliasToFile = new Map<string, string>();
  for (const m of source.matchAll(/import\s+\w+\s*,\s*\{\s*route\s+as\s+(\w+)\s*\}\s*from\s*'(\.\/[^']+\.ts)'/g)) {
    aliasToFile.set(m[1], m[2]);
  }
  const block = /export const routes[^=]*=([\s\S]*?);/.exec(source)?.[1] ?? '';
  if (block === '') problems.push('manifest.ts 里没解析到 `export const routes = [...]`：格式被改动了');
  const files: string[] = [];
  for (const m of block.matchAll(/\{\s*route:\s*(\w+)/g)) {
    const file = aliasToFile.get(m[1]);
    if (!file) {
      problems.push(`manifest.ts 的 routes 数组引用了未导入的 route 别名 ${m[1]}`);
      continue;
    }
    files.push(file);
  }
  return files;
}

/** 只取 `export const route ... };` 这一段，避免读到 handler 里的同名键 */
function routeBlock(source: string): string | null {
  const start = source.indexOf('export const route');
  if (start < 0) return null;
  const end = source.indexOf('\n};', start);
  return end < 0 ? null : source.slice(start, end);
}

/**
 * 从 route 声明块读字段。
 * 用字符串建正则：单条长正则字面量会让 Node 的类型剥离解析器误判为「非法正则标志」。
 */
function readRouteFields(block: string, file: string): Declared | null {
  const text = (name: string): string | undefined =>
    new RegExp(`${name}:\\s*'([^']*)'`).exec(block)?.[1];
  const number = (name: string): number | undefined => {
    const raw = new RegExp(`${name}:\\s*([\\d_]+)`).exec(block)?.[1];
    return raw === undefined ? undefined : Number(raw.replace(/_/g, ''));
  };
  const missing: string[] = STRING_FIELDS.filter((name) => text(name) === undefined);
  const maxBodyBytes = number('maxBodyBytes');
  if (maxBodyBytes === undefined) missing.push('maxBodyBytes');
  if (missing.length > 0) {
    problems.push(`${file}: route 声明缺字段 ${missing.join(', ')}`);
    return null;
  }
  return {
    file: '',
    path: text('path') as string,
    method: text('method') as string,
    auth: text('auth') as string,
    operation: text('operation') as string,
    idempotent: text('idempotent') as string,
    maxBodyBytes,
  };
}

/**
 * 文件位置 → 逻辑路径：index 省掉文件名；get/update/create 归到目录本身（同一目录不同方法）；
 * `param-` 前缀表示路径参数（`param-id` → `:id`）。平台会拒绝带 `_` 前缀段的 Function 包，
 * 因此不能沿用以 `_` 表示参数的旧约定。
 */
function fileToPath(relative: string): string {
  const parts = relative.replace(/\.ts$/, '').split('/');
  const stem = parts[parts.length - 1];
  if (stem === 'index' || stem === 'get' || stem === 'update' || stem === 'create') parts.pop();
  return `/api/${parts.map((part) => (part.startsWith('param-') ? `:${part.slice(6)}` : part)).join('/')}`;
}

const declared: Declared[] = [];
for (const file of parseManifest(readFileSync(MANIFEST, 'utf8'))) {
  const absolute = normalize(join(API_DIR, file));
  if (!absolute.startsWith(API_DIR)) {
    problems.push(`${file}: 指向 backend/routes 之外`);
    continue;
  }
  if (!existsSync(absolute)) {
    problems.push(`${file}: manifest 登记的文件不存在`);
    continue;
  }
  const source = readFileSync(absolute, 'utf8');
  const hasHandler = new RegExp('export\\s+default\\s+(async\\s+)?function').test(source);
  if (!hasHandler) problems.push(`${file}: 没有导出 default handler（应为 \`export default async function ...\`）`);
  const block = routeBlock(source);
  if (block === null) {
    problems.push(`${file}: 没有 \`export const route\` 声明块（或以 \`};\` 结尾的正常格式被破坏）`);
    continue;
  }
  const item = readRouteFields(block, file);
  if (item === null) continue;
  item.file = file;
  declared.push(item);
}

const seenPathMethod = new Set<string>();
const seenOperation = new Set<string>();

for (const item of declared) {
  const label = `${item.method} ${item.path || '(无 path)'}`;

  const expected = fileToPath(item.file.replace(/^\.\//, ''));
  if (item.path !== expected) {
    problems.push(`${label}: 路径与文件位置不符，按约定应为 ${expected}（若要保留现路径，请改名文件或在本脚本登记例外）`);
  }
  if (!item.path.startsWith('/api/')) problems.push(`${label}: 逻辑路径必须以 /api/ 开头`);
  if (!METHODS.includes(item.method)) problems.push(`${label}: method=${item.method} 非法`);
  if (!AUTH.includes(item.auth)) problems.push(`${label}: auth=${item.auth} 非法`);
  if (!IDEMPOTENT.includes(item.idempotent)) problems.push(`${label}: idempotent=${item.idempotent} 非法`);
  // maxBodyBytes = 0 是「不读请求体」的声明（server.ts 直接把 body 置为 {}），只允许用在无体方法上
  const bodyless = item.method === 'GET' || item.method === 'DELETE';
  if (item.maxBodyBytes === 0) {
    if (!bodyless) problems.push(`${label}: maxBodyBytes=0 表示不读请求体，${item.method} 不能这样声明`);
  } else if (!Number.isInteger(item.maxBodyBytes) || item.maxBodyBytes < 128 || item.maxBodyBytes > 1_048_576) {
    problems.push(`${label}: maxBodyBytes=${item.maxBodyBytes} 应为 0（无请求体）或 128~1048576`);
  }
  if (!/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(item.operation)) {
    problems.push(`${label}: operation=${item.operation} 必须形如 module.action`);
  }
  if (item.method === 'GET' && item.idempotent !== 'none') {
    problems.push(`${label}: GET 不应参与幂等（idempotent=${item.idempotent}）`);
  }
  if (item.method !== 'GET' && item.idempotent !== 'none' && item.operation === '') {
    problems.push(`${label}: 写操作启用了幂等但 operation 为空，幂等作用域算不出来`);
  }
  if (item.method !== 'GET' && item.idempotent === 'required' && item.auth === 'none') {
    problems.push(`${label}: 无鉴权写接口要求幂等，必须给出稳定主体（幂等键作用域会退化成 IP）`);
  }

  const pathKey = `${item.method} ${item.path}`;
  if (seenPathMethod.has(pathKey)) problems.push(`${label}: (method, path) 重复登记`);
  seenPathMethod.add(pathKey);
  if (seenOperation.has(item.operation)) problems.push(`${label}: operation=${item.operation} 重复（幂等作用域会互相覆盖）`);
  seenOperation.add(item.operation);
}

// api 目录下未被登记的文件：新加路由最容易漏这一步
const registered = new Set(declared.map((item) => item.file.replace(/^\.\//, '')));
const walk = (dir: string, prefix: string): void => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { walk(full, `${prefix}${name}/`); continue; }
    if (!name.endsWith('.ts') || name === 'manifest.ts') continue;
    const relative = `${prefix}${name}`;
    if (!registered.has(relative)) problems.push(`backend/routes/${relative} 未在 manifest.ts 登记（线上会 404）`);
  }
};
walk(API_DIR, '');

console.log(`manifest.ts 登记 ${declared.length} 条路由：`);
for (const item of declared) {
  console.log(`  ${item.method.padEnd(6)} ${item.path.padEnd(26)} auth=${item.auth.padEnd(6)} idempotent=${item.idempotent.padEnd(8)} ${item.operation}`);
}
if (problems.length === 0) {
  console.log('✓ 路由表自洽');
} else {
  console.log(`✗ ${problems.length} 处问题：`);
  for (const line of problems) console.log(`  - ${line}`);
  process.exitCode = 1;
}
