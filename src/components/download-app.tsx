// 「アプリをインストール」。/api/app/download が最新の Windows インストーラーへ移動させる。
import { Download } from "lucide-react";
import { Button } from "@/components/arc/button/button";

export function DownloadAppButton({ primary = false }: { primary?: boolean }) {
  return (
    <Button
      type="button"
      variant={primary ? "primary" : "secondary"}
      className={primary ? "full" : undefined}
      onClick={() => {
        location.href = "/api/app/download";
      }}
    >
      <Download size={16} strokeWidth={1.75} aria-hidden="true" />
      アプリをインストール（Windows）
    </Button>
  );
}
