import { ChatBubble } from "iconoir-react";
import { defineView } from "@/lib/views";
import { ConversationPage } from "./conversation";
import { HomePage } from "./home";

/**
 * The chat: the home (`/conversations`: a new conversation of the dashboard's own) and every
 * conversation (`/conversations/:id`). The shell lists them in its sidebar and tabs, not as a view.
 */
export default defineView({
  id: "conversations",
  title: "Chats",
  icon: ChatBubble,
  requires: ["agent.observe"],
  order: 10,
  pages: [
    { path: "/conversations", component: HomePage, fill: true },
    { path: "/conversations/:id", component: ConversationPage, fill: true },
  ],
});
