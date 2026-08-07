'use strict';

/** Env keys set by `ai-minions start` / launchRun for child Claude + host hooks. */
const ACTIVE_ENV = 'AI_MINIONS_ACTIVE';
const RUN_ID_ENV = 'AI_MINIONS_RUN_ID';

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
function isAiMinionsActive(env = process.env) {
  const active = String(env[ACTIVE_ENV] ?? '').trim() === '1';
  const runId = String(env[RUN_ID_ENV] ?? '').trim();
  return active && Boolean(runId);
}

/**
 * Mutate env for an active run. Caller must restore via saveEnv/restoreEnv.
 * @param {NodeJS.ProcessEnv} env
 * @param {{ runId: string }} options
 */
function activateAiMinionsEnv(env, options) {
  const runId = String(options?.runId ?? '').trim();
  if (!runId) {
    throw new Error('activateAiMinionsEnv requires runId');
  }
  env[ACTIVE_ENV] = '1';
  env[RUN_ID_ENV] = runId;
}

module.exports = {
  ACTIVE_ENV,
  RUN_ID_ENV,
  isAiMinionsActive,
  activateAiMinionsEnv,
};
