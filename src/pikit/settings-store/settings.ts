/**
 * The `settings` contract over a source of stored values: the App's table (`table.ts`), or on
 * Cloudflare the settings object's, read through calls (`calls.ts`). The declarations are this App's:
 * every App of a deployment runs the same components, so each declares the same. With it, the
 * store's own operator side (`SettingsStore`: `set` and `sections`), which its routes and calls use:
 * never the contract's, whose components only declare and read.
 *
 * - **What `get` answers** is the defaults with each stored top-level key over them, kept only while
 *   the schema accepts it: a key a deploy made invalid (a model no provider has now, an agent removed)
 *   takes its default, logged, and the rest of the stored value still applies.
 * - **What `set` stores** is the value as the operator sent it, whole, once its merge over the defaults
 *   is valid. Logged with the operator, the component and the keys it holds, never their values.
 * - Validation is TypeBox's (`Value.Check`) on the declared JSON Schema; a refusal names where the
 *   value is wrong (`/mode`), never what it is.
 * - **Never a secret** (the contract's two checks, `@pikit/contracts`' settings.ts): `declare` refuses
 *   a schema whose secret-named string is free (`secretSettingProblem`) and defaults holding a
 *   credential; `set` refuses, as `invalid_value`, a value holding one (`credentialSettingProblem`:
 *   a known credential's shape, `/prompt`, never the value).
 */

import type { AppContext, Logger } from "@pikit/core";
import {
  credentialSettingProblem,
  isJsonObject,
  type Operator,
  type Settings,
  SettingsError,
  type SettingsSchema,
  type SettingsValue,
  secretSettingProblem,
} from "@pikit/contracts";
import Value from "typebox/value";

/** One component's settings, as `sections` lists them (the dashboard's Settings dialog). JSON. */
export interface SettingsSection {
  component: string;
  schema: SettingsSchema;
  defaults: SettingsValue;
  /** `get`'s answer. */
  value: SettingsValue;
}

/** A value `set` refuses: its message says where the value is wrong, never the value. */
export class InvalidSettingsError extends Error {
  readonly code = "invalid_value";
  constructor(message: string) {
    super(message);
    this.name = "InvalidSettingsError";
  }
}

/**
 * settings-store's operator side, which its routes (the dashboard) and its calls use. Refusals:
 * `SettingsError` (`unknown_component`) for a component that declared nothing, `InvalidSettingsError`
 * (`invalid_value`) for a value its schema refuses.
 */
export interface SettingsStore {
  /** Stores `value` as `component`'s whole value, `operator`'s change; answers the value `get` now gives. */
  set(component: string, value: SettingsValue, operator: Operator, ctx: AppContext): Promise<SettingsValue>;
  /** Every declared component's settings, by name. */
  sections(ctx: AppContext): Promise<SettingsSection[]>;
}

/** Where stored values are: every component's value as `set` stored it. */
export interface SettingsSource {
  read(ctx: AppContext): Promise<Readonly<Record<string, SettingsValue>>>;
  write(component: string, value: SettingsValue, operator: Operator, ctx: AppContext): Promise<void>;
}

/** One component's declaration. */
interface Declared {
  schema: SettingsSchema;
  defaults: SettingsValue;
}

/** This App's declarations, which every view of its settings (local, remote) shares. */
export interface Declarations {
  declare(component: string, schema: SettingsSchema, defaults: SettingsValue): void;
  get(component: string): Declared | undefined;
  names(): string[];
}

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Where `value` is wrong for `schema`, never what it is: `/mode` (must be equal to one of the allowed values). */
function problem(schema: SettingsSchema, value: unknown): string {
  const [first] = Value.Errors(schema as never, value);
  if (first === undefined) return "it does not fit the schema";
  return `${first.instancePath === "" ? "the value" : first.instancePath} ${first.message}`;
}

export function createDeclarations(): Declarations {
  const declared = new Map<string, Declared>();
  return {
    declare(component, schema, defaults) {
      if (typeof component !== "string" || component === "") throw new TypeError("settings-store: a component is named by a non-empty string");
      if (declared.has(component)) throw new Error(`settings-store: "${component}" declared its settings already`);
      if (!isJsonObject(defaults) || !Value.Check(schema as never, defaults)) {
        throw new Error(`settings-store: the defaults "${component}" declares do not fit its schema: ${problem(schema, defaults)}`);
      }
      // A setting is never a secret (the contract): a schema may only name one, and no default holds one.
      const secret = secretSettingProblem(schema) ?? credentialSettingProblem(defaults);
      if (secret !== undefined) throw new Error(`settings-store: "${component}" declares settings where ${secret}`);
      declared.set(component, { schema, defaults: copy(defaults) });
    },
    get: (component) => declared.get(component),
    names: () => [...declared.keys()].sort(),
  };
}

/** `component`'s value: `stored`'s keys over the defaults, each kept while the schema accepts it. */
function valueOf(component: string, { schema, defaults }: Declared, stored: SettingsValue | undefined, logger: Logger): SettingsValue {
  let value: Record<string, unknown> = { ...defaults };
  const dropped: string[] = [];
  for (const [key, each] of Object.entries(stored ?? {})) {
    const candidate = { ...value, [key]: each };
    if (Value.Check(schema as never, candidate)) value = candidate;
    else dropped.push(key);
  }
  if (dropped.length > 0) {
    logger.warn("settings-store: stored settings the schema no longer accepts are left out; their defaults apply", { component, keys: dropped });
  }
  return copy(value) as SettingsValue;
}

const unknown = (component: string) => new SettingsError("unknown_component", `"${component}" declared no settings`);

/** `settings` and the store's operator side over `declarations` and `source`. */
export function createSettings(declarations: Declarations, source: SettingsSource): Settings & SettingsStore {
  const declared = (component: string): Declared => {
    const found = declarations.get(component);
    if (found === undefined) throw unknown(component);
    return found;
  };

  return {
    declare: (component, schema, defaults) => declarations.declare(component, schema, defaults),

    async get<T extends SettingsValue>(component: string, ctx: AppContext): Promise<T> {
      const declaration = declared(component);
      return valueOf(component, declaration, (await source.read(ctx))[component], ctx.logger) as T;
    },

    async set(component: string, value: SettingsValue, operator: Operator, ctx: AppContext) {
      const declaration = declared(component);
      if (!isJsonObject(value)) throw new InvalidSettingsError("a component's settings are a JSON object");
      const merged = { ...declaration.defaults, ...value };
      if (!Value.Check(declaration.schema as never, merged)) throw new InvalidSettingsError(`"${component}": ${problem(declaration.schema, merged)}`);
      const credential = credentialSettingProblem(value);
      if (credential !== undefined) throw new InvalidSettingsError(`"${component}": ${credential}`);
      await source.write(component, copy(value), operator, ctx);
      ctx.logger.info("settings-store: settings changed", { component, operator: operator.id, keys: Object.keys(value).sort() });
      return copy(merged) as SettingsValue;
    },

    async sections(ctx: AppContext) {
      const stored = await source.read(ctx);
      return declarations.names().map((component): SettingsSection => {
        const declaration = declared(component);
        return { component, schema: copy(declaration.schema), defaults: copy(declaration.defaults), value: valueOf(component, declaration, stored[component], ctx.logger) };
      });
    },
  };
}
