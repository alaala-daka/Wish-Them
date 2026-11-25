import { emptyData, type AppData } from './domain';

/** 旧版本草稿没有 choices/meta：读回时补齐，避免问卷分支读取 undefined */
function normalize(data: AppData): AppData {
  const base = emptyData();
  return {
    ...base,
    ...data,
    draft: {
      ...base.draft,
      ...data.draft,
      answers: data.draft?.answers?.length === 5 ? data.draft.answers : base.draft.answers,
      choices: data.draft?.choices?.length === 5 ? data.draft.choices : base.draft.choices,
      meta: data.draft?.meta ?? {},
    },
    wish: data.wish
      ? {
        ...data.wish,
        tasks: (data.wish.tasks ?? []).map((task) => ({
          ...task,
          tags: task.tags?.length ? task.tags : ['心意'],
        })),
      }
      : null,
  };
}
let dbPromise: Promise<IDBDatabase> | undefined;
function database() {
  return (dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('yuanta-postoffice', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('app');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}
export async function loadData(): Promise<AppData> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('app');
    const r = tx.objectStore('app').get('personal');
    r.onsuccess = () => resolve(r.result?.version === 1 ? normalize(r.result as AppData) : emptyData());
    r.onerror = () => reject(r.error);
  });
}
export async function saveData(data: AppData) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('app', 'readwrite');
    tx.objectStore('app').put(data, 'personal');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export async function prepareImage(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('请选择 JPG、PNG 或 WebP 图片。');
  if (file.size > 20 * 1024 * 1024) throw new Error('图片不能超过20MB，请换一张。');
  const bitmap = await createImageBitmap(file);
  const ratio = Math.min(1, 720 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * ratio);
  canvas.height = Math.round(bitmap.height * ratio);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器无法处理图片，请重试。');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.85, 0.7, 0.55, 0.4, 0.25, 0.15]) {
    const data = canvas.toDataURL('image/jpeg', quality);
    if (Math.ceil((data.length - 23) * 0.75) <= 200 * 1024) return data;
  }
  throw new Error('图片压缩后仍然过大，请选择更简单的图片。');
}
