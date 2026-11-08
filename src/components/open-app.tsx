// 「アプリを開く」。使い捨てコードを発行し、kumamorun://auth?code=… でアプリに渡す。
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Alert } from "@/components/arc/alert/alert";
import { Button } from "@/components/arc/button/button";

export function OpenAppButton({ primary = false }: { primary?: boolean }) {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="stack">
      <div className="row">
        <Button
          type="button"
          variant={primary ? "primary" : "secondary"}
          className={primary ? "full" : undefined}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const response = await fetch("/api/login-code", { method: "POST" });
              if (!response.ok)
                throw new Error(`コードを発行できませんでした（${response.status}）`);
              const { url } = (await response.json()) as { url: string };
              setSent(true);
              location.href = url;
            } catch (e) {
              setError(e instanceof Error ? e.message : "コードを発行できませんでした");
            } finally {
              setBusy(false);
            }
          }}
        >
          <ExternalLink size={16} strokeWidth={1.75} aria-hidden="true" />
          アプリを開く
        </Button>
      </div>
      <Alert tone="info" title="アプリに切り替わりましたか？" open={sent && error === null}>
        開かないときは、アプリが入っているか確かめて、もう一度押してください。コードは5分で失効し、一度しか使えません。
      </Alert>
      <Alert
        tone="danger"
        title={error ?? ""}
        open={error !== null}
        onDismiss={() => setError(null)}
      />
    </div>
  );
}
