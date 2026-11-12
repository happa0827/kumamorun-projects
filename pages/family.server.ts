// 家族（親だけ）。子供の一覧と追加、子供のログインリンク、招待コード、親の一覧。
import { progress } from "@schema";
import { defineHandler, defineHead, type InferProps } from "void";
import { db, inArray } from "void/db";
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
  const [flowerRows, statuses] = await Promise.all([
    ids.length
      ? db
          .select({ id: progress.accountId, flowers: progress.flowers })
          .from(progress)
          .where(inArray(progress.accountId, ids))
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
      flowers: flowers.get(p.id) ?? 0,
      appRunning: statuses[i]?.appRunning ?? false,
      keeping: statuses[i]?.status?.keeping === true,
    })),
  };
});

export const head = defineHead(() => ({ title: "家族 | くまもーるん" }));
