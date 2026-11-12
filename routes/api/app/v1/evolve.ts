// POST /api/app/v1/evolve  { expectedStage, nextStage, flowersToAdd }
// 成長か開花かはアプリ（Rust）が決める。サーバーは不変条件を確かめ、
// 今の段階が expectedStage のときだけ、段階と花を1つの文で書く。
//   成長: nextStage = expectedStage + 1、flowersToAdd = 0
//   開花: expectedStage = 5、nextStage = 0、flowersToAdd = 1 または 2（夜桜だけ 2）
// 一致しなければ 409 と今の値。不変条件の違反は 422。
// 子供は1日（日本時間）に1回だけ進化できる。2回目は 409 already_evolved_today と今の値（段階と花は変えない）。
// アプリは日付が変わったときに前の日を評価して1回だけ進化するので、ふつうの使い方では当たらない。
// 子供は花でショップの品（親が決めた現実のごほうび）を買えるので、トークンで連打して花を増やせないようにする。
// 大人は自分の花なので確かめない。
import { progress } from "@schema";
import { defineHandler } from "void";
import { and, db, eq, isNull, ne, or, sql } from "void/db";
import { z } from "zod";
import { parseBody } from "../../../../src/server/body";
import { requireDevice } from "../../../../src/server/device-auth";
import { getMember } from "../../../../src/server/family";
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
  // 日本時間の日付（YYYY-MM-DD）
  const today = new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const oncePerDay = (await getMember(accountId))?.kind === "child";

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
        evolvedOn: today,
        updatedAt: now,
      })
      .where(
        and(
          eq(progress.accountId, accountId),
          eq(progress.stage, expectedStage),
          oncePerDay ? or(isNull(progress.evolvedOn), ne(progress.evolvedOn, today)) : undefined,
        ),
      )
      .returning({ stage: progress.stage, flowers: progress.flowers }),
  ]);
  if (updated[0]) return updated[0];

  const [row] = await db
    .select({ stage: progress.stage, flowers: progress.flowers, evolvedOn: progress.evolvedOn })
    .from(progress)
    .where(eq(progress.accountId, accountId));
  const current = row && { stage: row.stage, flowers: row.flowers };
  const tooSoon = oncePerDay && row?.stage === expectedStage && row.evolvedOn === today;
  return c.json({ error: tooSoon ? "already_evolved_today" : "conflict", current }, 409);
});
