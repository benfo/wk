import fs from "node:fs";
import path from "node:path";
import { parse } from "../frontmatter.js";
import { WkError, type Result } from "../output.js";
import { SKILL_SOURCE } from "./init.js";

/** Prints the agent rules shipped with the package, for agents that don't load skills. */
export function guide(): Result {
  const file = path.join(SKILL_SOURCE, "SKILL.md");
  if (!fs.existsSync(file)) throw new WkError(`Rules missing from package: ${file}`);
  const { body } = parse(fs.readFileSync(file, "utf8"));
  return { lines: body.split(/\r?\n/), data: { rules: body }, full: true };
}
