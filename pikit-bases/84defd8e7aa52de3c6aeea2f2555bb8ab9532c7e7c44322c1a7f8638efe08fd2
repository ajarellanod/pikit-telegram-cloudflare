import { WarningCircle } from "iconoir-react";
import { ApiFailure } from "@/lib/api";

/** An error from the admin API, said plainly. */
export function ErrorNote({ error, title = "Something went wrong" }: { error: Error; title?: string }) {
  return (
    <div role="alert" className="flex gap-2.5 rounded-card bg-red-tint px-3 py-2.5 text-[13px]">
      <WarningCircle width={16} height={16} strokeWidth={2} className="mt-0.5 shrink-0 text-red" />
      <div className="min-w-0">
        <div className="font-medium text-red">{error instanceof ApiFailure ? `${title} (${error.status})` : title}</div>
        <div className="text-ink-2 [overflow-wrap:anywhere]">{error.message}</div>
      </div>
    </div>
  );
}
