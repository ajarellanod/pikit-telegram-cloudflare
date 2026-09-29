/**
 * The component's step of `pikit configure`, with a scripted person at the terminal and a `.env` in
 * memory: the key is optional, kept when set, asked once in a terminal, and never shown.
 */

import { expect, test } from "bun:test";
import { type ConfigureIO, configure } from "./configure.ts";

const KEY = "brave-test-key-0123456789";

function terminal(options: { interactive?: boolean; env?: Record<string, string>; answers?: string[] } = {}) {
  const env = new Map(Object.entries(options.env ?? {}));
  const answers = [...(options.answers ?? [])];
  const said: string[] = [];
  const asked: string[] = [];
  const io: ConfigureIO = {
    interactive: options.interactive ?? true,
    get: (name) => env.get(name),
    set: (name, value) => void env.set(name, value),
    askSecret: async (question) => {
      asked.push(question);
      const answer = answers.shift();
      if (answer === undefined) throw new Error(`unexpected question: ${question}`);
      return answer;
    },
    say: (line) => void said.push(line),
  };
  return { io, env, said, asked };
}

test("in a terminal, without a key: it says where to get one, asks without echo, and saves it to .env", async () => {
  const t = terminal({ answers: [`  ${KEY}\n`] });
  expect(await configure(t.io)).toEqual([]);
  expect(t.said.join("\n")).toContain("https://api-dashboard.search.brave.com");
  expect(t.asked).toEqual(["BRAVE_API_KEY (Enter skips): "]);
  expect(Object.fromEntries(t.env)).toEqual({ BRAVE_API_KEY: KEY });
  expect(t.said.join("\n")).not.toContain(KEY);
});

test("Enter skips: nothing is written, and nothing is missing (the app starts without it)", async () => {
  const t = terminal({ answers: [""] });
  expect(await configure(t.io)).toEqual([]);
  expect(t.env.size).toBe(0);
  expect(t.said.join("\n")).toContain("Skipped");
});

test("a key already set (in .env or exported) is kept without asking, and not shown", async () => {
  const t = terminal({ env: { BRAVE_API_KEY: KEY } });
  expect(await configure(t.io)).toEqual([]);
  expect(t.asked).toEqual([]);
  expect(t.env.get("BRAVE_API_KEY")).toBe(KEY);
  expect(t.said).toEqual(["  BRAVE_API_KEY: set (web search)"]);
});

test("without a terminal it asks nothing, and nothing is missing", async () => {
  const t = terminal({ interactive: false });
  expect(await configure(t.io)).toEqual([]);
  expect(t.asked).toEqual([]);
  expect(t.env.size).toBe(0);
});
