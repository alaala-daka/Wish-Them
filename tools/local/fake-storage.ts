/**
 * 内存版对象存储：只为本地跑通 presign → 浏览器 PUT → complete 的链路。
 *
 * 与线上差异：签名 URL 只是可读的假地址，不代表权限模型；`put()` 模拟浏览器直传，
 * 只有测试代码会调用它。线上必须用 `storage.download()` 实测字节后才把文件标 ready。
 */
import type { StorageClient } from '../../backend/lib/types.ts';

interface StoredObject {
  bytes: Uint8Array;
  contentType: string;
}

export class FakeStorage implements StorageClient {
  private readonly objects = new Map<string, StoredObject>();
  private readonly publicBase: string;

  /**
   * @param publicBase 本地 HTTP 服务地址。空串生成同源相对路径（Vite 代理到本机后端），
   *                   冒烟测试仍用默认的 storage.local 假地址。
   */
  constructor(publicBase = 'https://storage.local') {
    this.publicBase = publicBase;
  }

  private publicUrl(kind: 'upload' | 'get', objectPath: string, query = ''): string {
    const base = this.publicBase.replace(/\/$/, '');
    return `${base}/${kind}/${encodeURIComponent(objectPath)}${query}`;
  }

  async createSignedUploadUrl(objectPath: string, _options: { upsert: boolean }): Promise<{ signedUrl: string }> {
    return { signedUrl: this.publicUrl('upload', objectPath) };
  }

  async createSignedUrl(objectPath: string, expiresInSeconds: number): Promise<{ signedUrl: string }> {
    return { signedUrl: this.publicUrl('get', objectPath, `?expires=${expiresInSeconds}`) };
  }

  async download(objectPath: string): Promise<Response> {
    const object = this.objects.get(objectPath);
    if (!object) return new Response('object not found', { status: 404 });
    return new Response(object.bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        'content-type': object.contentType,
        'content-length': String(object.bytes.byteLength),
      },
    });
  }

  async remove(objectPaths: string[]): Promise<unknown> {
    for (const path of objectPaths) this.objects.delete(path);
    return { removed: objectPaths.length };
  }

  /** 测试专用：模拟浏览器直传后的对象 */
  put(objectPath: string, bytes: Uint8Array, contentType: string): void {
    this.objects.set(objectPath, { bytes, contentType });
  }

  has(objectPath: string): boolean {
    return this.objects.has(objectPath);
  }
}