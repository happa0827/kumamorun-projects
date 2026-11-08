import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";
import { voidPlugin } from "void";
import { voidReact } from "@void/react/plugin";

export default defineConfig({
  // Arc UI（shadcn）が前提にする "@/…" を src/ に向ける。tsconfig.json の paths と揃える。
  resolve: {
    alias: { "@/": fileURLToPath(new URL("./src/", import.meta.url)) },
  },
  plugins: [voidPlugin(), voidReact({ react: { compiler: true } })],
  fmt: {
    // 生成されたマイグレーション、kumamorun-tauri と内容を揃える文書、
    // Arc UI から写した部品（配布元と比べやすいよう元の書き方のまま）は整形しない
    ignorePatterns: ["db/migrations/**", "**/*.md", "src/components/arc/**"],
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
});
