/**
 * A conversation live, from its server-sent events (`GET /admin/api/conversations/:id/events`): whether
 * a run is going, the answer being written, the tools running. The stream starts with a `snapshot`
 * and a client that fell behind gets a new one, so the state is rebuilt from each snapshot, never from
 * a count of events. What is written for good (entries) is read from the transcript again: `changes`
 * counts the times it changed. Until it is, `entries` holds the ones the stream announced (a message
 * ended, an entry appended), as the transcript gives them: a message shows the moment it is written,
 * not once the transcript is read again. On Cloudflare the stream is polled snapshots, no events: an
 * answer that ended between two snapshots is in `ended` (its last partial) until the transcript has it,
 * so it never leaves the page for the time the transcript takes to be read again.
 *
 * The stream is open only while the dashboard is active (`useActive`: the tab visible, the operator
 * there in the last minutes); it reconnects when it ends (on Cloudflare after a bounded number of
 * polled snapshots) and when the operator comes back.
 */

import { useEffect, useReducer } from "react";
import { useActive } from "@/lib/activity";
import { follow } from "@/lib/api";
import type { RunningTool } from "@/components/pikit/message";
import { INITIAL, type LiveState, reduce } from "./live-state";

export type { LiveState, RunningTool };

/** Follows conversation `id` live while mounted and active, reconnecting after a dropped stream. */
export function useLive(id: string): LiveState & { paused: boolean } {
  const [state, dispatch] = useReducer(reduce, INITIAL);
  const active = useActive();

  // Another conversation: nothing of this one's stays.
  useEffect(() => dispatch({ type: "reset" }), [id]);

  useEffect(() => {
    if (!active) return;
    const stop = new AbortController();
    void (async () => {
      while (!stop.signal.aborted) {
        try {
          const started = follow(`/conversations/${encodeURIComponent(id)}/events`, (event) => dispatch({ type: "event", event }), stop.signal);
          dispatch({ type: "connected" });
          await started;
        } catch {
          // Reconnect below.
        }
        // A stream stopped by this cleanup says nothing: the next one (another id, or a return) owns the state.
        if (stop.signal.aborted) return;
        dispatch({ type: "disconnected" });
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    })();
    return () => stop.abort();
  }, [id, active]);

  return { ...state, paused: !active };
}
