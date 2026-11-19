#!/usr/bin/env node
import { run } from "./run.js";

const { code, stdout, stderr } = run(process.argv.slice(2));
if (stdout) process.stdout.write(stdout + "\n");
if (stderr) process.stderr.write(stderr + "\n");
process.exitCode = code;
