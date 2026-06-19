#!/usr/bin/env node
/** Shim: orchestrator/ cwd → repo-root scripts/audit-product-claims.mjs */
import { delegateRootScript } from "./delegate-root-script.mjs";

delegateRootScript("scripts/audit-product-claims.mjs");
