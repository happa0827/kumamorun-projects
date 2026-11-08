import { defineConfig } from "void/config";

export default defineConfig({
  routing: {
    typedRoutes: true,
  },
  worker: {
    compatibility_date: "2026-02-24",
  },
  head: {
    title: "くまもーるん",
    // Arc UI のアクセント色。data-theme（light / dark）は下のスクリプトが描画の前に決める。
    htmlAttrs: { lang: "ja", "data-accent": "green" },
    meta: [
      { charset: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "description", content: "くまもーるんの今の守り状態を見るサイト" },
    ],
    link: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Inter:wght@400;500;600&family=Noto+Sans+JP:wght@400;500;700&display=swap",
      },
    ],
    script: [
      {
        // 保存した設定 → OS の設定の順でテーマを決める。描画の前に走らせて、ちらつきを防ぐ。
        innerHTML:
          'try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="light"}',
      },
    ],
  },
});
