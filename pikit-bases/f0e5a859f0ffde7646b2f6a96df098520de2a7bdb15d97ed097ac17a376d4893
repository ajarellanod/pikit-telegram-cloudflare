/**
 * How proposals-github reaches GitHub, in one place: the `github` contract (@pikit/contracts'
 * github.ts), whichever provider connects it (`github-app`: a GitHub App the operator creates from the
 * dashboard; `github-token`: a token and a repository setting). The rest of the component asks this
 * module, never a secret or a setting of its own.
 *
 * - **The repository** is `github.repository(ctx)`, asked at each call: `undefined` while GitHub is not
 *   connected, which is `not_connected` here, pointing to the dashboard's Settings → GitHub.
 * - **The token** is `github.token(ctx)`, asked for every call to GitHub and never kept: the provider
 *   answers one that lasts long enough, and caches it if it wants to. One token reads, opens, merges and
 *   closes: what the agent may not do is kept from it by the tools, which never read `github` for it.
 */

import type { AppContext, Pikit } from "@pikit/core";
import { isGitHubNotConnected, ProposalsError } from "@pikit/contracts";

/** Where an operator connects GitHub: the provider's dashboard section. */
export const CONNECT = "the dashboard's Settings → GitHub";

export interface GitHubAccess {
  /** `owner/name`, or `undefined` while GitHub is not connected. */
  repository(ctx: AppContext): Promise<string | undefined>;
  /** A token for the repository; `ProposalsError("not_connected")` while none is connected. */
  token(ctx: AppContext): Promise<string>;
}

/** Called in `setup`: it declares what it uses (`github`). */
export function createGitHubAccess(pikit: Pikit): GitHubAccess {
  const github = pikit.use("github");
  return {
    repository: (ctx) => github.get().repository(ctx),
    async token(ctx) {
      try {
        return await github.get().token(ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isGitHubNotConnected(error)) throw new ProposalsError("not_connected", 503, `Self-improvement is not connected: ${message}. Connect GitHub in ${CONNECT}`);
        throw new ProposalsError("unavailable", 502, `GitHub's access failed: ${message}`);
      }
    },
  };
}
