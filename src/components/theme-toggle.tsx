// ライトとダークの切り替え。選んだテーマは localStorage に残し、次からは描画の前に当てる（void.config.ts）。
import { useSyncExternalStore } from "react";
import { ThemeSwitch, type Theme } from "@/components/arc/theme-switch/theme-switch";

const listeners = new Set<() => void>();
const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
};
const readTheme = (): Theme =>
  document.documentElement.dataset.theme === "dark" ? "dark" : "light";

export function ThemeToggle() {
  // サーバーでは light として描き、ブラウザで実際の値に合わせる
  const theme = useSyncExternalStore(subscribe, readTheme, () => "light" as Theme);

  return (
    <ThemeSwitch
      theme={theme}
      iconOnly
      label={theme === "dark" ? "ライトモードにする" : "ダークモードにする"}
      onThemeChange={(next) => {
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem("theme", next);
        } catch {
          // 保存できない環境では、このページを開いている間だけ切り替える
        }
        for (const listener of listeners) listener();
      }}
    />
  );
}
