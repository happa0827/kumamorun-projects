// 家族（親だけ）。子供の一覧と追加、子供のログイン、子供の端末の失効、招待コード、親の一覧。
import { devices, progress } from "@schema";
import { defineHandler, defineHead, type InferProps } from "void";
import { and, db, desc, inArray, isNull } from "void/db";
import { readLiveStatus } from "../src/server/account-data";
import { listFamily } from "../src/server/family";
import { loadViewer } from "../src/server/viewer";

export type Props = InferProps<typeof loader>;

export const loader = defineHandler(async (c) => {
  const viewer = await loadViewer(c, "/family");
  if (viewer instanceof Response) return viewer;
  const { familyId } = viewer.member;
  if (viewer.member.kind !== "parent" || !familyId) return c.redirect("/");

  const people = await listFamily(familyId);
  const children = people.filter((p) => p.kind === "child");
  const ids = children.map((p) => p.id);
  const [flowerRows, deviceRows, statuses] = await Promise.all([
    ids.length
      ? db
          .select({ id: progress.accountId, flowers: progress.flowers })
          .from(progress)
          .where(inArray(progress.accountId, ids))
      : Promise.resolve([]),
    ids.length
      ? db
          .select({
            id: devices.id,
            accountId: devices.accountId,
            name: devices.name,
            lastSeenAt: devices.lastSeenAt,
          })
          .from(devices)
          .where(and(inArray(devices.accountId, ids), isNull(devices.revokedAt)))
          .orderBy(desc(devices.lastSeenAt))
      : Promise.resolve([]),
    Promise.all(ids.map((id) => readLiveStatus(id))),
  ]);
  const flowers = new Map(flowerRows.map((r) => [r.id, r.flowers]));

  return {
    me: viewer.id,
    parents: people
      .filter((p) => p.kind === "parent")
      .map((p) => ({ id: p.id, name: p.name, email: p.email })),
    children: children.map((p, i) => ({
      id: p.id,
      name: p.name,
      email: p.email,
      // 親が作った子供（Google なし。メールアドレスを出さない人）だけ、親がログインさせられる
      createdByParent: p.email === null,
      flowers: flowers.get(p.id) ?? 0,
      appRunning: statuses[i]?.appRunning ?? false,
      keeping: statuses[i]?.status?.keeping === true,
      devices: deviceRows
        .filter((d) => d.accountId === p.id)
        .map(({ id, name, lastSeenAt }) => ({ id, name, lastSeenAt })),
    })),
  };
});

export const head = defineHead(() => ({ title: "家族 | くまもーるん" }));
