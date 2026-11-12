import { devices } from "@schema";
import { defineHandler, defineHead, type InferProps } from "void";
import { and, db, desc, eq, isNull } from "void/db";
import { KIND_LABEL, visibleEmail } from "../src/server/family";
import { loadViewer } from "../src/server/viewer";

export type Props = InferProps<typeof loader>;

export const loader = defineHandler(async (c) => {
  const viewer = await loadViewer(c, "/settings");
  if (viewer instanceof Response) return viewer;

  // 親は自分ではアプリを使わないが、種類ができる前からの利用者が親を選ぶと、それまでの端末が残る。
  // 親でも読んで、残っていれば画面に出して失効できるようにする（settings.tsx）。
  const rows = await db
    .select({
      id: devices.id,
      name: devices.name,
      createdAt: devices.createdAt,
      lastSeenAt: devices.lastSeenAt,
    })
    .from(devices)
    .where(and(eq(devices.accountId, viewer.id), isNull(devices.revokedAt)))
    .orderBy(desc(devices.lastSeenAt));
  return {
    user: {
      // 親が作った子供は仮のメールアドレスなので出さない（null）
      email: visibleEmail(viewer.email),
      name: viewer.name,
      kind: viewer.member.kind,
      kindLabel: KIND_LABEL[viewer.member.kind],
    },
    devices: rows,
  };
});

export const head = defineHead(() => ({ title: "設定 | くまもーるん" }));
