"use strict";

/**
 * Operator bounded context — CLI/TUI surfaces, explain-run, export, runner preflight/launcher/views, help.
 */
module.exports = {
  ...require("./console-dashboard"),
  ...require("./control-plane-tui"),
  ...require("./explain-run"),
  ...require("./operator-cli-help"),
  ...require("./project-template-cli"),
  ...require("./runner-budget-view"),
  ...require("./runner-launcher"),
  ...require("./runner-preflight"),
  ...require("./runner-trace-viewer"),
  ...require("./runner-tui-cli"),
  ...require("./scenario-metrics-export"),
  ...require("./operator-trace-summary"),
  ...require("./operator-trace-command"),
  ...require("./operator-doctor-evidence"),
  ...require("./operator-context-resume"),
  ...require("./ai-minions-cli"),
};
