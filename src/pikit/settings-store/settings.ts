/**
 * The `settings` contract over a source of stored values: the App's table (`table.ts`), or on
 * Cloudflare the settings object's, read through calls (`calls.ts`). The declarations are this App's:
 * every App of a deployment runs the same components, so each declares the same.
 *
 * - **What `get` answers** is the defaults with each stored top-level key over them, kept only while
 *   the schema accepts it: a key a deploy made invalid (a model no provider has now, an agent removed)
 *   takes its default, logged, and the rest of the stored value still applies.
 * - **What `set` stores** is the value as the operator sent it, whole, once its merge over the defaults
 *   is valid. Logged with the operator, the component and the keys it holds, never their values.
 * - Validation is TypeBox's (`Value.Check`) on the declared JSON Schema; a refusal names where the
 *   value is wrong (`/mode`), never what it is.
 */

import type { AppContext, Logger } from "@pikit/core";
import { isJsonObject, type Operator, type Settings, SettingsError, type SettingsSchema, type SettingsSection, type SettingsValue } from "@pikit/contracts";
import Value from "typebox/value";

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

/** `settings` over `declarations` and `source`. */
export function createSettings(declarations: Declarations, source: SettingsSource): Settings {
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

    async set(component, value, operator, ctx) {
      const declaration = declared(component);
      if (!isJsonObject(value)) throw new SettingsError("invalid_value", "a component's settings are a JSON object");
      const merged = { ...declaration.defaults, ...value };
      if (!Value.Check(declaration.schema as never, merged)) throw new SettingsError("invalid_value", `"${component}": ${problem(declaration.schema, merged)}`);
      await source.write(component, copy(value), operator, ctx);
      ctx.logger.info("settings-store: settings changed", { component, operator: operator.id, keys: Object.keys(value).sort() });
      return copy(merged) as SettingsValue;
    },

    async sections(ctx) {
      const stored = await source.read(ctx);
      return declarations.names().map((component): SettingsSection => {
        const declaration = declared(component);
        return { component, schema: copy(declaration.schema), defaults: copy(declaration.defaults), value: valueOf(component, declaration, stored[component], ctx.logger) };
      });
    },
  };
}
