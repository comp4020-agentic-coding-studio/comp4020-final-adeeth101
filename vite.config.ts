import {defineConfig} from 'vite';
export default defineConfig({
  base:'/assets/',
  build:{outDir:'dist/client',emptyOutDir:true,manifest:true,rollupOptions:{input:'client/main.ts'}},
});
