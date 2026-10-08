/**
 * A `.md` file imported `with { type: "text" }` is its text: Bun's loader, and wrangler's Text rule
 * (deployment-cloudflare's `wrangler.jsonc`). bun-types says so for TypeScript 7.1 and later only.
 */
declare module "*.md" {
  const text: string;
  export default text;
}
