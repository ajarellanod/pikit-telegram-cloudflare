/**
 * What the home's and a conversation's composers share: the images it takes (admin-api's limits, the
 * smaller total on Cloudflare), whether the assistant can search the web, the attachments a message
 * sends, and how an assistant is named (`assistantName`). The "/" menu lists only the commands the App
 * registered (`agent.command`, `GET /admin/api/commands`, read by the shell): the dashboard's own
 * actions (stop, reset, images, web search, the assistant, the views) are its buttons, never commands.
 */

import type { ComposerImage, ImageLimits, PickerOption } from "@/components/bui/PromptBar";
import { IMAGE_TYPES, MAX_DURABLE_IMAGE_BYTES, MAX_IMAGE_BYTES, MAX_IMAGES, WEB_SEARCH_TOOL } from "@/lib/admin-api";
import type { ApiAgent, ApiApp, ApiAttachment } from "@/lib/api";
import { assistantName } from "@/lib/names";

export { assistantName };

export const imageLimits = (app: ApiApp): ImageLimits => ({
  types: IMAGE_TYPES,
  count: MAX_IMAGES,
  bytes: MAX_IMAGE_BYTES,
  ...(app.target === "durable" && { totalBytes: MAX_DURABLE_IMAGE_BYTES }),
});

/** Whether `agent` searches the web (it has `WEB_SEARCH_TOOL`), and why not. */
export function webSearchOf(agents: ApiAgent[] | undefined, agent: string | undefined): { available: boolean; unavailable: string } {
  const found = agents?.find((each) => each.name === agent);
  return {
    available: found?.tools.includes(WEB_SEARCH_TOOL) === true,
    unavailable: agents === undefined ? "The assistants are not read yet" : `${agent === undefined ? "This assistant" : assistantName(agent)} has no web search tool`,
  };
}

export const attachmentsOf = (images: ComposerImage[]): ApiAttachment[] => images.map(({ mimeType, data }) => ({ kind: "image", mimeType, data }));

/** The assistants as the composer's picker lists them: by their shown name, `tag`s for some. */
export const assistantOptions = (names: string[], tag: (name: string) => string | undefined = () => undefined): PickerOption[] =>
  names.map((name) => {
    const tagged = tag(name);
    return { key: name, name: assistantName(name), ...(tagged !== undefined && { tag: tagged }) };
  });
