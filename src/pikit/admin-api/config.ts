/** admin-api's config, the same for both halves (`admin-api`, and `admin-api-worker` on Cloudflare). */

import Type from "typebox";

export const Config = Type.Object({
  /** How often an idle event stream gets a comment, so that nothing between closes it. */
  heartbeatMs: Type.Integer({ minimum: 1000, default: 15_000 }),
  /**
   * The model that titles conversations (`provider/modelId`, one of the App's providers), through
   * `model.complete`. Absent: each conversation's agent's model. Read where runs settle: on Cloudflare
   * the objects' App (`admin-api`), not the Worker's.
   */
  titleModel: Type.Optional(Type.String({ pattern: "^[^/\\s]+/\\S+$", description: "provider/modelId of the model that titles conversations; absent, each conversation's agent's model" })),
});
