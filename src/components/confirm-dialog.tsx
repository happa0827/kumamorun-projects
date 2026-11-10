// 取り消せない操作（端末の失効、パスキーの削除、ショップでの購入）の前に確かめるダイアログ。
import { useState, type ReactElement } from "react";
import { Button } from "@/components/arc/button/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/arc/dialog/dialog";

export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  confirmVariant = "danger",
  onConfirm,
}: {
  trigger: ReactElement;
  title: string;
  description: string;
  confirmLabel: string;
  /** 確かめるボタンの見た目。消す操作は danger、買う操作は primary。 */
  confirmVariant?: "primary" | "danger";
  /** false を返すと閉じない（失敗を呼び出し側で表示するとき） */
  onConfirm: () => Promise<boolean | void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={title} description={description}>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <DialogClose asChild>
            <Button type="button" variant="ghost" disabled={busy}>
              やめる
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant={confirmVariant}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              const result = await onConfirm();
              setBusy(false);
              if (result !== false) setOpen(false);
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
