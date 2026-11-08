// アプリ向け API の本文の検証。計画書では形の不正は 422（再試行しない）なので、
// withValidator の 400 ではなく、ここで 422 を返す。
import type { Context } from "hono";
import type { z } from "zod";

export async function parseBody<T extends z.ZodType>(
  c: Context,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, response: c.json({ error: "invalid_json" }, 422) };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return { ok: false, response: c.json({ error: "invalid_body", issues: result.error.issues }, 422) };
  }
  return { ok: true, data: result.data };
}
