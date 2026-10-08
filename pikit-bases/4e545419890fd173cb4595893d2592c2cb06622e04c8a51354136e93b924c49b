/**
 * admin-proposals: the dashboard's side of the agent's changes to itself (SPEC §6). Its routes and its
 * Proposals view (`view/`) list, show, approve and reject the proposals that `proposals` holds; its
 * Settings section (`settings/`) shows whether they can be made and approved now, and the deploys
 * that follow. Where proposals live and what approving does are the provider's: GitHub pull requests
 * merged through GitHub's API (`proposals-github`, Cloudflare), or branches of a repository on the
 * server that the deployer next to the app merges, checks and deploys (`proposals-local`). Nothing
 * here knows which.
 *
 * - **Every route asks `admin.auth` first** (without a provider, nobody is an operator): without an
 *   operator, `401` and `proposals` is not asked.
 * - **Answers JSON** (`api.ts`): the contract's shapes; an action's refusal is `409` (`404` for
 *   `not_found`), a provider's failure (`ProposalsError`) its own status, `{ error, message }`.
 * - **Approve and reject are logged** with the operator and the proposal.
 *
 * Targets: `server` and `durable`. On Cloudflare it goes in both Apps (`apps.worker: "default"`): the
 * Worker's App serves its routes; the objects' copy is never reached (as admin-api's).
 */

import { type AppContext, defineComponent } from "@pikit/core";
import { type Operator, ProposalsError } from "@pikit/contracts";
import { type ApproveResponse, MAX_COMMENT, type RejectResponse } from "./api.ts";

export * from "./api.ts";

const NAME = "admin-proposals";
/** The largest body an action takes. */
const MAX_BODY = 64 * 1024;
const ROUTE = "/admin/api/admin-proposals";

/** An answer that is not a success. */
class Refusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message ?? code);
  }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });

export default defineComponent({
  name: NAME,
  setup(pikit) {
    // Its routes answer operators only; without a provider, nobody.
    const auth = pikit.useOptional("admin.auth");
    const proposals = pikit.use("proposals");

    /** The operator, or a `401`; then `work`'s answer, a refusal or a provider's failure as JSON. */
    const route =
      (work: (request: Request, ctx: AppContext, operator: Operator) => Promise<Response>) =>
      async (request: Request, ctx: AppContext): Promise<Response> => {
        const operator = await auth.get()?.verify(request, ctx);
        if (operator === undefined) return json({ error: "unauthorized" }, 401, { "www-authenticate": 'Bearer realm="pikit"' });
        try {
          return await work(request, ctx, operator);
        } catch (error) {
          if (error instanceof Refusal) return json({ error: error.code, message: error.message }, error.status, error.headers);
          if (error instanceof ProposalsError) {
            return json({ error: error.code, message: error.message }, error.status, error.retryAfter === undefined ? {} : { "retry-after": String(error.retryAfter) });
          }
          throw error;
        }
      };

    /** `:id` of the request's path: a pull request's number, a branch's topic (`/` encoded). */
    const idOf = (request: Request): string => {
      const segment = new URL(request.url).pathname.split("/")[4] ?? "";
      let id: string;
      try {
        id = decodeURIComponent(segment);
      } catch {
        throw new Refusal(404, "not_found", "no such proposal");
      }
      if (id === "" || id.length > 200) throw new Refusal(404, "not_found", "no such proposal");
      return id;
    };

    /** The request's JSON object (`{}` when it has no body). */
    const bodyOf = async (request: Request): Promise<Record<string, unknown>> => {
      if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) throw new Refusal(413, "too_large");
      const text = await request.text();
      if (text.length > MAX_BODY) throw new Refusal(413, "too_large");
      if (text.trim() === "") return {};
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new Refusal(400, "invalid_request", "the body is not JSON");
      }
      if (typeof body !== "object" || body === null || Array.isArray(body)) throw new Refusal(400, "invalid_request", "the body is a JSON object");
      return body as Record<string, unknown>;
    };

    /** A refusal of `proposals` as an answer: `404` for what is not a proposal, `409` for the rest. */
    const refused = (outcome: { code: string; message: string }) => json({ error: outcome.code, message: outcome.message }, outcome.code === "not_found" ? 404 : 409);

    pikit.provideKeyed(
      "http.route",
      `GET ${ROUTE}/status`,
      route(async (_request, ctx) => json(await proposals.get().status(ctx))),
    );

    pikit.provideKeyed(
      "http.route",
      `GET ${ROUTE}`,
      route(async (_request, ctx) => json(await proposals.get().list(ctx))),
    );

    pikit.provideKeyed(
      "http.route",
      `GET ${ROUTE}/:id`,
      route(async (request, ctx) => json(await proposals.get().get(idOf(request), ctx))),
    );

    pikit.provideKeyed(
      "http.route",
      `POST ${ROUTE}/:id/approve`,
      route(async (request, ctx, operator) => {
        const id = idOf(request);
        const body = await bodyOf(request);
        if (body.override !== undefined && typeof body.override !== "boolean") throw new Refusal(400, "invalid_request", "override is true or false");
        if (body.head !== undefined && (typeof body.head !== "string" || !/^[0-9a-f]{40}$/.test(body.head))) throw new Refusal(400, "invalid_request", "head is a commit's 40 hexadecimal digits");
        const outcome = await proposals.get().approve(id, { operator, ...(typeof body.head === "string" && { head: body.head }), ...(body.override === true && { override: true }) }, ctx);
        if (!outcome.ok) return refused(outcome);
        ctx.logger.info("admin-proposals: approved", { operator: operator.id, id, head: outcome.head, merged: outcome.merged });
        const answer: ApproveResponse = { id: outcome.id, head: outcome.head, merged: outcome.merged, message: outcome.message };
        return json(answer);
      }),
    );

    pikit.provideKeyed(
      "http.route",
      `POST ${ROUTE}/:id/reject`,
      route(async (request, ctx, operator) => {
        const id = idOf(request);
        const body = await bodyOf(request);
        if (body.comment !== undefined && (typeof body.comment !== "string" || body.comment.length > MAX_COMMENT)) {
          throw new Refusal(400, "invalid_request", `comment is text of at most ${MAX_COMMENT} characters`);
        }
        const comment = typeof body.comment === "string" ? body.comment.trim() : "";
        const outcome = await proposals.get().reject(id, { operator, ...(comment !== "" && { comment }) }, ctx);
        if (!outcome.ok) return refused(outcome);
        ctx.logger.info("admin-proposals: rejected", { operator: operator.id, id, commented: comment !== "" });
        const answer: RejectResponse = { id: outcome.id, closed: true, message: outcome.message };
        return json(answer);
      }),
    );
  },
});
