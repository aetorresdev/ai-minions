#!/usr/bin/env node
/** Shim: orchestrator/ cwd → repo-root scripts/run-install-evidence.mjs */
import { delegateRootScript } from "./delegate-root-script.mjs";

delegateRootScript("scripts/run-install-evidence.mjs");
