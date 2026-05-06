"use strict";

/**
 * Optional adapters for tools whose argv semantics are not fully expressible in the manifest (e.g. complex CLIs).
 * Register new adapters here — no orchestrator core edits beyond this module.
 */
const terraform = require("./terraform");
const kubectl = require("./kubectl");
const awsCli = require("./aws-cli");
const git = require("./git");
const filesystem = require("./filesystem");

const adapters = {
  terraform: {
    classify(args, _ctx) {
      return terraform.classify(args);
    },
  },
  kubectl: {
    classify(args, _ctx) {
      return kubectl.classify(args);
    },
  },
  aws: {
    classify(args, _ctx) {
      return awsCli.classify(args);
    },
  },
  git: {
    classify(args, _ctx) {
      return git.classify(args);
    },
  },
  filesystem: {
    classify(args, ctx) {
      return filesystem.classify(args, ctx);
    },
  },
};

const ADAPTER_IDS = new Set(Object.keys(adapters));

module.exports = {
  adapters,
  ADAPTER_IDS,
};
