// POST /api/app/v1/evolve  { expectedStage, nextStage, flowersToAdd }
// 成長か開花かはアプリ（Rust）が決める。サーバーは不変条件を確かめ、
// 今の段階が expectedStage のときだけ、段階と花を1つの文で書く。
//   成長: nextStage = expectedStage + 1、flowersToAdd = 0
//   開花: expectedStage = 5、nextStage = 0、flowersToAdd = 1 または 2（夜桜だけ 2）
// 一致しなければ 409 と今の値。不変条件の違反は 422。
import { progress } from "@schema";
import { defineHandler } from "void";
import { and, db, eq, sql } from "void/db";
import { z } from "zod";
import { parseBody } from "../../../../src/server/body";
import { requireDevice } from "../../../../src/server/device-auth";
import { BLOOM_FLOWERS, Stage } from "../../../../src/server/shapes";

const Body = z.object({ expectedStage: Stage, nextStage: Stage, flowersToAdd: z.number().int() });

function isAllowed({ expectedStage, nextStage, flowersToAdd }: z.infer<typeof Body>): boolean {
  const grow = nextStage === expectedStage + 1 && flowersToAdd === 0;
  const bloom =
    expectedStage === 5 &&
    nextStage === 0 &&
    (BLOOM_FLOWERS as readonly number[]).includes(flowersToAdd);
  return grow || bloom;
}

export const POST = defineHandler(requireDevice, async (c) => {
  const body = await parseBody(c, Body);
  if (!body.ok) return body.response;
  if (!isAllowed(body.data)) return c.json({ error: "invariant_violation" }, 422);

  const { accountId } = c.get("device");
  const { expectedStage, nextStage, flowersToAdd } = body.data;
  const now = Date.now();

  // 行がなければ段階 0、花 0 で作り、そのうえで比較つきの更新をする。D1 の batch は1つのトランザクション。
  const [, updated] = await db.batch([
    db
      .insert(progress)
      .values({ accountId, stage: 0, flowers: 0, updatedAt: now })
      .onConflictDoNothing(),
    db
      .update(progress)
      .set({
        stage: nextStage,
        flowers: sql`${progress.flowers} + ${flowersToAdd}`,
        updatedAt: now,
      })
      .where(and(eq(progress.accountId, accountId), eq(progress.stage, expectedStage)))
      .returning({ stage: progress.stage, flowers: progress.flowers }),
  ]);
  if (updated[0]) return updated[0];

  const [current] = await db
    .select({ stage: progress.stage, flowers: progress.flowers })
    .from(progress)
    .where(eq(progress.accountId, accountId));
  return c.json({ error: "conflict", current }, 409);
});
