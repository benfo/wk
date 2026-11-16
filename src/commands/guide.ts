import fs from "node:fs";
import path from "node:path";
import { parse } from "../frontmatter.js";
import { WkError, type Result } from "../output.js";
import { SKILL_SOURCE } from "./init.js";

export const GUIDE_TOPICS = ["setup", "onboarding"];

/** Prints the agent rules shipped with the package, or one side guide (setup, onboarding). */
export function guide(topic?: string): Result {
  if (topic !== undefined && !GUIDE_TOPICS.includes(topic)) {
    throw new WkError(`No guide "${topic}". Topics: ${GUIDE_TOPICS.join(", ")}.`);
  }
  const file = path.join(SKILL_SOURCE, topic ? `${topic}.md` : "SKILL.md");
  if (!fs.existsSync(file)) throw new WkError(`Rules missing from package: ${file}`);
  // A CRLF checkout leaves blank lines after the frontmatter.
  const body = parse(fs.readFileSync(file, "utf8")).body.replace(/^\s+/, "");
  return { lines: body.split(/\r?\n/), data: { topic: topic ?? null, rules: body }, full: true };
}
