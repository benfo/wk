import { briefInbox, checkCaptured } from "./commands/capture.js";
import { hooks } from "./commands/flow.js";
import { doneProject } from "./commands/homes.js";
import { briefPrinciples, startPrinciples } from "./commands/principles.js";
import { startRelated } from "./commands/related.js";
import { briefReview, checkTidy } from "./commands/review.js";
import { briefDrift, startChecks } from "./commands/setup.js";
import { briefDue, doneTriggers, startTriggers } from "./commands/triggers.js";
import { briefHooks } from "./commands/views.js";

/** Wires each feature into the moments it speaks at. Order is the order lines print. */
let wired = false;
export function wireFeatures(): void {
  if (wired) return;
  wired = true;
  hooks.onStart.push(startPrinciples, startTriggers, startRelated, startChecks);
  hooks.onCheck.push(checkCaptured, (ctx, store) => checkTidy(ctx, store));
  hooks.onDone.push(doneTriggers, doneProject);
  briefHooks.push(briefDrift, briefDue, briefInbox, briefReview, briefPrinciples);
}
