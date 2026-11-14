// 取り消せない操作を、押し続けて確かめるボタン。結果が画面に出ているとき（ログアウト、招待コードで家族に入る）は単独で、
// そうでなければ ConfirmDialog の hold で、ダイアログの中で使う。
// Arc の HoldToConfirm に、非同期の処理と、失敗したときの戻しを足す。
import { useState } from "react";
import {
  HoldToConfirm,
  type HoldToConfirmProps,
} from "@/components/arc/hold-to-confirm/hold-to-confirm";

export function HoldAction({
  onConfirm,
  ...props
}: Omit<HoldToConfirmProps, "onConfirm" | "confirmed"> & {
  /** false を返すと、ボタンをすぐ元に戻す（失敗を呼び出し側で表示するとき） */
  onConfirm: () => Promise<boolean | void>;
}) {
  const [confirmed, setConfirmed] = useState(false);
  return (
    <HoldToConfirm
      {...props}
      confirmed={confirmed}
      onConfirm={async () => {
        setConfirmed(true);
        const result = await onConfirm();
        if (result === false) setConfirmed(false);
      }}
    />
  );
}
