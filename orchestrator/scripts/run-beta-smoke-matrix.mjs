#!/usr/bin/env node
/** Shim: orchestrator/ cwd → repo-root scripts/run-beta-smoke-matrix.mjs */
import { delegateRootScript } from "./delegate-root-script.mjs";

delegateRootScript("scripts/run-beta-smoke-matrix.mjs");
