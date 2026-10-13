import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'spec/browser',testMatch:'**/*.pw.ts',timeout:45000,workers:1,outputDir:'.playwright/results',use:{baseURL:process.env.APP_URL??'http://localhost:8180',browserName:'chromium',trace:'retain-on-failure'},reporter:'list'});
