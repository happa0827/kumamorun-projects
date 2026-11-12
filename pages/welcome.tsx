// アカウントの種類を選ぶ。大人、親（新しい家族を作る）、または招待コードで家族に入る（親か子供）。
// 種類はあとから変えられないので、選ぶ前に確かめる。
import { useState } from "react";
import { Baby, User, Users } from "lucide-react";
import { Alert } from "@/components/arc/alert/alert";
import { Button } from "@/components/arc/button/button";
import { Card } from "@/components/arc/card/card";
import { Input } from "@/components/arc/input/input";
import { ConfirmDialog } from "../src/components/confirm-dialog";
import type { Props } from "./welcome.server";

type Choice = { kind: "adult" | "parent" } | { inviteCode: string };

export default function WelcomePage(props: Props) {
  if (!("next" in props)) return null; // loader が移動させる
  return <Welcome next={props.next} name={props.name} />;
}

function Welcome({ next, name }: { next: string; name: string }) {
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [joining, setJoining] = useState(false);

  /** 種類を決める。成功したら移動先へ。ダイアログを閉じてよければ true。 */
  const choose = async (choice: Choice): Promise<boolean> => {
    setError(null);
    const response = await fetch("/api/account/kind", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(choice),
    });
    if (response.ok || response.status === 409) {
      // 409 はもう選んである（別のタブなど）。どちらでも先へ進む。
      location.href = next;
      return true;
    }
    setError(
      response.status === 400
        ? "招待コードが違うか、期限が切れています。親に新しいコードをもらってください"
        : `選べませんでした（${response.status}）`,
    );
    return true;
  };

  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "");

  return (
    <>
      <section className="panel" aria-labelledby="welcome-title">
        <div className="panel-head">
          <h1 id="welcome-title">{name ? `${name}さん、ようこそ` : "ようこそ"}</h1>
          <p className="lead">アカウントの種類を選んでください。あとから変えられません。</p>
        </div>
        <Alert
          tone="danger"
          title={error ?? ""}
          open={error !== null}
          onDismiss={() => setError(null)}
        />
        <ul className="cards">
          <li>
            <Card
              avatar={<User size={20} strokeWidth={1.75} aria-hidden="true" />}
              title="大人"
              description="自分でアプリを使い、スタート制限もショップも自分で決めます。"
              action={
                <ConfirmDialog
                  trigger={
                    <Button type="button" size="sm">
                      大人にする
                    </Button>
                  }
                  title="大人のアカウントにしますか？"
                  description="あとから親や子供には変えられません。"
                  confirmLabel="大人にする"
                  confirmVariant="primary"
                  onConfirm={() => choose({ kind: "adult" })}
                />
              }
            />
          </li>
          <li>
            <Card
              avatar={<Users size={20} strokeWidth={1.75} aria-hidden="true" />}
              title="親"
              description="新しい家族を作ります。子供の状況を見て、ショップの品と購入の通知を決めます。自分ではアプリを使いません。"
              action={
                <ConfirmDialog
                  trigger={
                    <Button type="button" size="sm">
                      家族を作る
                    </Button>
                  }
                  title="親のアカウントにして、家族を作りますか？"
                  description="もう家族があるなら、作らずに、その家族の親から招待コードをもらってください。"
                  confirmLabel="家族を作る"
                  confirmVariant="primary"
                  onConfirm={() => choose({ kind: "parent" })}
                />
              }
            />
          </li>
        </ul>
      </section>

      <section className="panel" aria-labelledby="invite-title">
        <div className="panel-head">
          <h2 id="invite-title">
            <Baby size={18} strokeWidth={1.75} aria-hidden="true" /> 招待コードで家族に入る
          </h2>
          <p className="muted">
            子供と、2人目からの親は、家族の親にもらった招待コードを入れてください。コードで、親か子供かが決まります。
          </p>
        </div>
        <form
          className="name-form"
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            if (joining || normalized.length !== 8) return;
            setJoining(true);
            await choose({ inviteCode: normalized });
            setJoining(false);
          }}
        >
          <Input
            label="招待コード"
            placeholder="ABCD-EFGH"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
              setError(null);
            }}
          />
          <div className="row">
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              loading={joining}
              disabled={normalized.length !== 8}
            >
              家族に入る
            </Button>
          </div>
        </form>
      </section>
    </>
  );
}
