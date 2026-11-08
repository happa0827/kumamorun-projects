// 「アプリを開く」。使い捨てコードを発行し、kumamorun://auth?code=… でアプリに渡す。
import { useState } from "react";

export function OpenAppButton({ primary = false }: { primary?: boolean }) {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <button
        type="button"
        className={primary ? "primary" : undefined}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const response = await fetch("/api/login-code", { method: "POST" });
            if (!response.ok) throw new Error(`コードを発行できませんでした（${response.status}）`);
            const { url } = (await response.json()) as { url: string };
            setLink(url);
            location.href = url;
          } catch (e) {
            setError(e instanceof Error ? e.message : "コードを発行できませんでした");
          } finally {
            setBusy(false);
          }
        }}
      >
        アプリを開く
      </button>
      {link && (
        <p className="muted" role="status">
          アプリが開かないときは、アプリが入っているか確かめて、もう一度押してください。コードは5分で失効し、一度しか使えません。
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
