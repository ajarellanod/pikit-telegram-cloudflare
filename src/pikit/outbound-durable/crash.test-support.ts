/**
 * For `crash.test.ts` only: a process that stores an answer and dies during its send. Run as
 * `bun crash.test-support.ts <database> <marker>`: it enqueues a two-piece answer, and its transport writes
 * `<marker>` when the first send starts, then never answers. The test kills it with SIGKILL there.
 */

import { writeFileSync } from "node:fs";
import { defineApp, defineComponent, silentLogger } from "@pikit/core";
import outboundDurable from "./index.ts";
import { testStorage } from "./storage.test-support.ts";

const [database = "", marker = ""] = process.argv.slice(2);

const channel = defineComponent({
  name: "crashing-channel",
  setup(pikit) {
    const queue = pikit.useOptional("outbound.queue");
    return {
      async start() {
        const q = queue.get();
        if (q === undefined) throw new Error("no queue");
        q.attach("chat", {
          idempotent: false,
          split: (text) => text.split("|"),
          send: () => {
            writeFileSync(marker, "sending");
            return new Promise(() => {});
          },
        });
        await q.enqueue({ idempotencyKey: "session-1:run-1", channel: "chat", conversationKey: "chat:42", text: "first piece|second piece" });
      },
    };
  },
});

const app = await defineApp({ components: [testStorage(database), outboundDurable, channel], logger: silentLogger }).create();
await app.start();
