import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 本地开发统一同源：前端请求 /functions/v1/app 与 /__storage，
// 由 Vite 代理到 tools/local/serve.ts（默认 127.0.0.1:8787），避免 CORS 与额外配置。
const proxy = {
  '/functions': 'http://127.0.0.1:8787',
  '/__storage': 'http://127.0.0.1:8787',
};

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173, proxy },
  preview: { host: '127.0.0.1', port: 4173, proxy },
});
