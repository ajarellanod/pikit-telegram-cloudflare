/**
 * The process killed after each commit in turn (`createConvergenceConformance`): whatever the point, every admitted
 * message ends settled, and its answer reaches the user.
 *
 * Around this component, two doubles play the parts the registry's components play:
 * - a runtime, as `runtime-pi` uses `agent.submissions`: it records a message once Pi holds it and
 *   before the ack, settles it when its run ends, retries a settlement it could not write, and at
 *   start resumes the pending conversations. Pi's session is a map outside `storage.sql`: durable, and
 *   never cut, as a JSONL session is not part of the app's database. A redelivered message is a
 *   duplicate, and opening its conversation resumes a run nobody drives, as Pi does;
 * - a channel, as `channel-telegram` reads `answers`: from a cursor it keeps in `storage.sql`, applied
 *   to the platform, then saved.
 */

import { afterAll, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AppContext, defineComponent } from "@pikit/core";
import { type AgentSubmissions, type RunSettlement } from "@pikit/contracts";
import { type ConvergenceFixture, createConvergenceConformance, type ProcessLife } from "@pikit/contracts/testing";
import submissionsSql from "./index.ts";
import { openTestDatabase } from "./storage.test-support.ts";

const directories: string[] = [];
afterAll(() => {
  for (const dir of directories) rmSync(dir, { recursive: true, force: true });
});

const MESSAGES = ["r1", "r2"];
const CONVERSATION = { key: "chat:1", agent: "support", sessionId: "session-1" };
const RETRY_MS = 1_000;

const runOf = (requestId: string): RunSettlement => ({ conversation: CONVERSATION, requestId, requestIds: [requestId], kind: "completed", text: `answer: ${requestId}` });

function fixture(): ConvergenceFixture {
  const dir = mkdtempSync(join(tmpdir(), "pikit-submissions-convergence-"));
  directories.push(dir);
  const records = openTestDatabase(join(dir, "pikit.db"));
  /** Pi's session: what it holds of each message. Outlives every process. */
  const session = new Map<string, "running" | "done">();
  /** What the platform received, across every process. */
  const delivered: string[] = [];
  let runtime: { dispatch(requestId: string): Promise<void> } | undefined;
  let channel: { drain(): Promise<void> } | undefined;
  let submissions: AgentSubmissions | undefined;

  const runtimeDouble = (life: ProcessLife) =>
    defineComponent({
      name: "runtime-double",
      setup(pikit) {
        const handle = pikit.use("agent.submissions");
        return {
          async start(ctx) {
            const s = handle.get();
            submissions = s;
            // A settlement that could not be written is tried again later, as the adapter does.
            const settle = async (requestId: string, background: AppContext): Promise<void> => {
              try {
                await s.settled(runOf(requestId), background);
              } catch (error) {
                if (life.dead) throw error;
                void background.clock.sleep(RETRY_MS).then(() => (life.dead ? undefined : settle(requestId, background).catch(() => {})));
              }
            };
            const finish = async (requestId: string, background: AppContext) => {
              session.set(requestId, "done");
              await settle(requestId, background);
            };
            // At start: the conversations with pending messages, resumed (or settled from Pi's result).
            for (const { requestIds } of await s.pending(ctx)) {
              for (const requestId of requestIds) if (session.has(requestId)) await finish(requestId, ctx);
            }
            runtime = {
              async dispatch(requestId) {
                const known = session.get(requestId);
                if (known !== undefined) {
                  // A duplicate; opening its conversation resumes a run nobody drives.
                  if (known === "running") await finish(requestId, ctx);
                  return;
                }
                session.set(requestId, "running");
                await s.admitted(CONVERSATION, requestId, ctx);
                await finish(requestId, ctx);
              },
            };
          },
        };
      },
    });

  const channelDouble = (life: ProcessLife) =>
    defineComponent({
      name: "channel-double",
      setup(pikit) {
        const handle = pikit.use("agent.submissions");
        const storage = pikit.use("storage.sql");
        return {
          async start() {
            const s = handle.get();
            const sql = storage.get();
            await sql.run("CREATE TABLE IF NOT EXISTS channel_double_cursor (name TEXT PRIMARY KEY, cursor TEXT NOT NULL)");
            channel = {
              async drain() {
                const [row] = await sql.query<{ cursor: string }>("SELECT cursor FROM channel_double_cursor WHERE name = 'answers'");
                const page = await s.answers.read(row?.cursor, 10);
                for (const { cursor, fact } of page.items) {
                  if (life.dead) throw new Error("the process is dead");
                  delivered.push(fact.requestId);
                  await sql.run("INSERT INTO channel_double_cursor (name, cursor) VALUES ('answers', ?) ON CONFLICT (name) DO UPDATE SET cursor = excluded.cursor", [cursor]);
                }
              },
            };
          },
        };
      },
    });

  return {
    database: records.database,
    retryAfterMs: RETRY_MS,
    components: (life) => [submissionsSql, runtimeDouble(life), channelDouble(life)],
    async scenario({ signal }) {
      // The platform delivers each message until it is acknowledged: once `dispatch` resolves.
      for (const requestId of MESSAGES) await (runtime as NonNullable<typeof runtime>).dispatch(requestId);
      const deadline = Date.now() + 3_000;
      while (!MESSAGES.every((id) => delivered.includes(id))) {
        if (signal.aborted) throw signal.reason;
        if (Date.now() > deadline) throw new Error(`answers delivered: ${JSON.stringify(delivered)}`);
        await (channel as NonNullable<typeof channel>).drain();
        await Bun.sleep(1);
      }
    },
    async invariant({ app }) {
      const s = submissions as AgentSubmissions;
      const ctx = app.context();
      const pending = await s.pending(ctx);
      if (pending.length > 0) throw new Error(`still pending: ${JSON.stringify(pending)}`);
      for (const id of MESSAGES) {
        if ((await s.get(CONVERSATION, id, ctx))?.kind !== "settled") throw new Error(`${id} is not settled`);
        if (!delivered.includes(id)) throw new Error(`${id}'s answer never reached the user`);
      }
      // One per run; a settlement retried after a storage failure may land after a later one.
      const answers = (await s.answers.read(undefined, 100)).items.map((i) => i.fact.requestId).sort();
      if (answers.join() !== MESSAGES.join()) throw new Error(`answers ${JSON.stringify(answers)}, expected one per run`);
    },
    dispose: () => records.close(),
  };
}

for (const c of createConvergenceConformance(fixture)) {
  test(`submissions-sql ${c.group}: ${c.name}`, () => c.run(), 60_000);
}
