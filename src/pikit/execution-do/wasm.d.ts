/**
 * QuickJS's WebAssembly, as `quickjs.ts` imports it: on Cloudflare the bundler makes a `.wasm` import a
 * compiled module (wrangler's default rule, `CompiledWasm`); under Bun the import is the file's path.
 */
declare module "@jitl/quickjs-wasmfile-release-sync/wasm" {
  const wasm: WebAssembly.Module | string;
  export default wasm;
}
