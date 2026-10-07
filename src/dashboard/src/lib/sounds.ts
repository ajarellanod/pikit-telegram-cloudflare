/**
 * Interaction sounds (Beautiful UI's InteractionSounds, MIT: see NOTICE): one quiet cue per click on
 * anything interactive, synthesized with @web-kits/audio. On by default; the operator turns them off
 * in the workspace menu, remembered in this browser (`localStorage["pikit-sounds"]`). Nothing makes
 * an AudioContext before the first click.
 *
 * An element picks its cue with `data-sound="press|tick|release|page|pulse"`; inside
 * `[data-sound-silent]` nothing sounds.
 */

import { defineSound, ensureReady, type PlayOptions, setMasterVolume, type VoiceHandle } from "@web-kits/audio";
import { useSyncExternalStore } from "react";

const KEY = "pikit-sounds";

const INTERACTIVE_SELECTOR = [
  "button",
  "a[href]",
  "input:not([type='hidden'])",
  "select",
  "textarea",
  "summary",
  "[role='button']",
  "[role='checkbox']",
  "[role='menuitem']",
  "[role='menuitemcheckbox']",
  "[role='menuitemradio']",
  "[role='option']",
  "[role='radio']",
  "[role='switch']",
  "[role='tab']",
].join(",");

const DISMISS_WORDS = /close|dismiss|remove|delete|collapse|cancel|clear|stop|abort|reset/i;
const PRIMARY_WORDS = /send|save|submit|start|sign in|create|add/i;

type Cue = "press" | "tick" | "release" | "page" | "pulse";
type Play = (options?: PlayOptions) => VoiceHandle;

/** Five short cues, built on the first click (a browser allows audio only after a gesture). */
function buildCues(): Record<Cue, Play> {
  return {
    // most buttons: a crisp transient blended with a bright pluck
    press: defineSound({
      layers: [
        { source: { type: "noise", color: "white" }, filter: { type: "highpass", frequency: 2400 }, envelope: { attack: 0.0003, decay: 0.009, sustain: 0 }, gain: 0.13 },
        { source: { type: "sine", frequency: 680 }, envelope: { attack: 0.0006, decay: 0.022, sustain: 0, release: 0.008 }, gain: 0.24 },
      ],
    }),
    // toggles, tabs, inputs: a light tick
    tick: defineSound({
      source: { type: "square", frequency: 2100 },
      filter: { type: "bandpass", frequency: 2600, resonance: 1.6 },
      envelope: { attack: 0.0004, decay: 0.028, sustain: 0 },
      gain: 0.24,
    }),
    // close, delete, cancel: a light clack
    release: defineSound({
      source: { type: "noise", color: "white" },
      filter: { type: "lowpass", frequency: 1600, resonance: 0.9 },
      envelope: { attack: 0.001, decay: 0.055, sustain: 0 },
      gain: 0.32,
    }),
    // links, navigation: a soft upward blip
    page: defineSound({
      source: { type: "sine", frequency: { start: 430, end: 640 } },
      envelope: { attack: 0.002, decay: 0.11, sustain: 0, release: 0.03 },
      gain: 0.4,
    }),
    // primary actions: a rounder pulse
    pulse: defineSound({
      source: { type: "sine", frequency: 330 },
      filter: { type: "lowpass", frequency: 2200 },
      envelope: { attack: 0.002, decay: 0.13, sustain: 0, release: 0.04 },
      gain: 0.5,
    }),
  };
}

function cueFor(element: Element): Cue {
  const override = element.getAttribute("data-sound");
  if (override === "press" || override === "tick" || override === "release" || override === "page" || override === "pulse") return override;
  const label = `${element.getAttribute("aria-label") ?? ""} ${element.textContent ?? ""}`.trim();
  if (DISMISS_WORDS.test(label)) return "release";
  if (element.matches("input[type='checkbox'], input[type='radio'], select, [role='checkbox'], [role='radio'], [role='switch'], [role='tab'], [aria-pressed]")) return "tick";
  if (element.matches("a[href]")) return "page";
  if (PRIMARY_WORDS.test(label)) return "pulse";
  if (element.matches("input, textarea")) return "tick";
  return "press";
}

function storedOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

let on = storedOn();
let cues: Record<Cue, Play> | undefined;
const listeners = new Set<() => void>();

function onClick(event: MouseEvent): void {
  if (!on || !(event.target instanceof Element)) return;
  const control = event.target.closest(INTERACTIVE_SELECTOR);
  if (control === null || control.closest("[data-sound-silent]") !== null) return;
  if (control.matches(":disabled, [aria-disabled='true']")) return;
  if (cues === undefined) {
    void ensureReady();
    setMasterVolume(0.32);
    cues = buildCues();
  }
  cues[cueFor(control)]();
}

document.addEventListener("click", onClick, true);

export function setSounds(next: boolean): void {
  on = next;
  try {
    localStorage.setItem(KEY, next ? "on" : "off");
  } catch {
    // Not remembered: this page still follows it.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether interaction sounds play. */
export function useSounds(): boolean {
  return useSyncExternalStore(subscribe, () => on);
}
