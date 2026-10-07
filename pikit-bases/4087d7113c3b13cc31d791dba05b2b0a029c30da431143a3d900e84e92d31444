/**
 * The Context panel (Beautiful UI's right-hand pane, as its harness shows retrieved chunks): what this
 * conversation's transcript holds besides its words, as far as it is read here: the images sent in it
 * and its sources (`sources.ts`), or an empty state.
 */

import { MediaImage, Xmark } from "iconoir-react";
import ContextCards, { ContextHeader } from "@/components/bui/ContextCards";
import EmptyState from "@/components/bui/EmptyState";
import type { SentImage, Source } from "./sources";

export function ContextPanel({ images, sources, onClose }: { images: SentImage[]; sources: Source[]; onClose: () => void }) {
  return (
    <aside aria-label="Context" className="hidden w-[360px] shrink-0 flex-col overflow-hidden rounded-window border border-line bg-page lg:flex" style={{ animation: "fade-in 300ms ease both" }}>
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3 sm:pl-4">
        <span className="text-[13px] font-semibold text-ink">Context</span>
        <button type="button" aria-label="Close the context" onClick={onClose} className="flex size-6 items-center justify-center rounded-[6px] text-ink-3 transition-colors duration-100 hover:bg-hover hover:text-ink">
          <Xmark width={15} height={15} strokeWidth={2} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {images.length === 0 && sources.length === 0 ? (
          <EmptyState icon={<MediaImage />} title="Nothing here yet" hint="The images sent in this conversation, and what its web searches and fetches found, show here." />
        ) : (
          <div className="flex flex-col gap-6">
            {images.length > 0 && (
              <section className="flex flex-col gap-2">
                <ContextHeader title="Attachments" count={images.length} />
                <div className="grid grid-cols-3 gap-2">
                  {images.map((image, i) => (
                    <img
                      key={image.key}
                      src={`data:${image.mimeType};base64,${image.data}`}
                      alt={`Image ${i + 1}`}
                      title={image.at === undefined ? image.mimeType : `${image.mimeType}, sent ${new Date(image.at).toLocaleString()}`}
                      className="aspect-square w-full rounded-card bg-inset object-cover shadow-card"
                      style={{ animation: `fade-up 400ms cubic-bezier(0.23,1,0.32,1) ${Math.min(i, 8) * 60}ms both` }}
                    />
                  ))}
                </div>
              </section>
            )}
            {sources.length > 0 && <ContextCards header="Sources" chunks={sources} />}
          </div>
        )}
      </div>
    </aside>
  );
}
