import { defineConfig } from 'void/config';

export default defineConfig({
  routing: {
    typedRoutes: true,
  },
  worker: {
    compatibility_date: '2026-02-24',
  },
  head: {
    title: 'くまもーるん',
    htmlAttrs: { lang: 'ja' },
    meta: [
      { charset: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    ],
  },
});
