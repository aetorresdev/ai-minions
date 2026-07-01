#!/usr/bin/env node
/** Shim: orchestrator/ cwd → repo-root scripts/run-modular-closeout-evidence.mjs */
import { delegateRootScript } from "./delegate-root-script.mjs";

delegateRootScript("scripts/run-modular-closeout-evidence.mjs");
