/** How the dashboard shows names: no imports, so the kit's tests read it as it is. */

/**
 * An agent's name as the dashboard shows it (the stored name stays as it is): its words, split at
 * `-` and `_`, the first one capitalized. `assistant` is "Assistant", `support-bot` "Support bot".
 */
export function assistantName(name: string): string {
  const words = name.split(/[-_]+/).filter((word) => word !== "").join(" ");
  return words === "" ? name : words.charAt(0).toLocaleUpperCase() + words.slice(1);
}
