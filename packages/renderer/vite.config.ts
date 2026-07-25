import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwind from '@tailwindcss/vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 默认为生产模式，仅在 dev 时为 false
// 可通过 npm run dev 启动开发模式，或设置环境变量 VITE_MODE=dev
const isProd = process.env.VITE_MODE !== 'dev' && process.env.NODE_ENV !== 'development';

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      $lib: path.resolve(__dirname, './src/lib'),
    },
  },
  plugins: [
    svelte(),
    tailwind(),
    paraglideVitePlugin({
      project: path.resolve(__dirname, './project.inlang'),
      outdir: path.resolve(__dirname, './src/lib/paraglide'),
    })
  ],
  build: {
    // Electron 场景的安全阈值
    chunkSizeWarningLimit: 1024,
    // 小于 4kb 资源转 base64，减少文件数量
    assetsInlineLimit: 4096,
    // Electron 41 最优：不做语法降级，编译最快
    target: 'esnext',
    // 生产关闭 SourceMap，保护源码；开发开启方便调试
    sourcemap: !isProd,
    // 生产强制压缩，开发关闭压缩提升热更新速度
    minify: isProd ? 'esbuild' : false,
    // 构建前清空 dist（避免旧文件残留）
    emptyOutDir: isProd,

    rollupOptions: {
      external: ['@app/main'],
      output: {
        // 文件名添加 hash：文件变化才更新，静态资源强缓存
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',

        manualChunks(id) {
          // 核心框架（首屏必须）
          if (id.includes('svelte/src')) return 'svelte-core';
          if (id.includes('bits-ui/dist')) return 'bits-ui';
          // 重型依赖 → 独立 chunk，由动态 import 按需拉入
          if (id.includes('monaco-editor')) return 'monaco-editor';
          if (id.includes('shiki')) return 'shiki';
          if (id.includes('@iconify-json/twemoji')) return 'iconify-twemoji';
          if (id.includes('@tabler/icons-svelte')) return 'tabler-icons';
          // 流程图相关（仅 FlowPage）
          if (id.includes('@dagrejs/dagre') || id.includes('graphology')) return 'flow-engine';
          if (id.includes('@xyflow')) return 'xyflow';
          // 其它 UI 库
          if (id.includes('svelte-motion/src')) return 'svelte-motion';
          if (id.includes('@floating-ui')) return 'floating-ui';
          if (id.includes('paneforge')) return 'paneforge';
          // 不做兜底 vendor，让小依赖跟随业务 chunk
        }
      }
    },
  },
})