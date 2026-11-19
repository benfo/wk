import { briefInbox, checkCaptured } from "./commands/capture.js";
import { hooks } from "./commands/flow.js";
import { briefPrinciples, startPrinciples } from "./commands/principles.js";
import { briefHooks } from "./commands/views.js";

/** Wires each feature into the moments it speaks at. Imported once by run.ts. */
let wired = false;
export function wireFeatures(): void {
  if (wired) return;
  wired = true;
  hooks.onStart.push(startPrinciples);
  hooks.onCheck.push(checkCaptured);
  briefHooks.push(briefInbox, briefPrinciples);
}
