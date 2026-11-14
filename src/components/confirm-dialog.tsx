// 取り消せない操作の前に確かめるダイアログ。
// hold を渡すと、確かめるボタンが押し続けて決める HoldAction になる（取り消せない操作。品を既定に戻すなど、やり直せる操作には付けない）。
import { useState, type ReactElement, type ReactNode } from "react";
import { Button } from "@/components/arc/button/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/arc/dialog/dialog";
import { HoldAction } from "./hold-action";

/** 押し終えてから閉じるまでの間。完了の表示（チェック）が見えるようにする。 */
const HOLD_CLOSE_DELAY = 600;

export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  confirmVariant = "danger",
  hold,
  onConfirm,
}: {
  trigger: ReactElement;
  title: string;
  description: string;
  /** 確かめるボタンの文言。hold のときは「長押しで…」の形にする。 */
  confirmLabel: string;
  /** 確かめるボタンの見た目。消す操作は danger、買う操作は primary。 */
  confirmVariant?: "primary" | "danger";
  /** 押し続けて決める。confirmedLabel は押し終えたあとの文言。 */
  hold?: { confirmedLabel: string; icon?: ReactNode };
  /** false を返すと閉じない（失敗を呼び出し側で表示するとき） */
  onConfirm: () => Promise<boolean | void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    const result = await onConfirm();
    if (result !== false && hold) await new Promise((r) => setTimeout(r, HOLD_CLOSE_DELAY));
    setBusy(false);
    if (result !== false) setOpen(false);
    return result;
  };

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
          {hold ? (
            <HoldAction
              label={confirmLabel}
              confirmedLabel={hold.confirmedLabel}
              tone={confirmVariant === "danger" ? "danger" : "accent"}
              {...(hold.icon ? { icon: hold.icon } : {})}
              onConfirm={run}
            />
          ) : (
            <Button type="button" variant={confirmVariant} loading={busy} onClick={run}>
              {confirmLabel}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
