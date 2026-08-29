import { defineConfig } from 'vite'

/**
 * 独立构建可嵌入网页的桌宠 widget（迁移自 CodexPetDesk vite.widget.config.js）。
 *
 * 产物：
 *   dist-widget/codex-pet-widget.js   （经典 script 标签，挂 window.CodexPet）
 *   dist-widget/codex-pet-widget.es.js（ESM 模块）
 *
 * 使用：
 *   <script src="/dist-widget/codex-pet-widget.js"></script>
 *   <script>CodexPet.mount({ pet: "/pets/hachiroku/pet.json" });</script>
 */
export default defineConfig({
  build: {
    outDir: 'dist-widget',
    emptyOutDir: true,
    lib: {
      entry: 'src/widget/codex-pet-widget.ts',
      name: 'CodexPet',
      formats: ['iife', 'es'],
      fileName: (format) => (format === 'es' ? 'codex-pet-widget.es.js' : 'codex-pet-widget.js'),
    },
    rollupOptions: {
      output: {
        exports: 'named',
      },
    },
  },
})
