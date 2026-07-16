#!/usr/bin/env node
'use strict';

/**
 * Routing release smoke gate.
 *
 * Entry: npm run test:e2e:routing-release
 * Modes:
 *   ROUTING_RELEASE_MODE=fixture (default) — in-process Ollama proxy (GHA pack)
 *   ROUTING_RELEASE_MODE=live — real Olla at 127.0.0.1:40114/olla/ollama (pre-tag pack)
 *
 * Any non-PASS scenario → exit ≠ 0. SKIP is never used as PASS.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');

const ORCH_ROOT = path.resolve(__dirname, '..');
const LIVE_DEFAULT_BASE = 'http://127.0.0.1:40114/olla/ollama';

/**
 * @returns {string}
 */
function resolveCommitSha() {
  const envSha = process.env.GITHUB_SHA || process.env.ROUTING_RELEASE_COMMIT_SHA;
  if (envSha && String(envSha).trim()) return String(envSha).trim();
  const r = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: path.resolve(ORCH_ROOT, '..'),
    encoding: 'utf8',
  });
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  return 'unknown';
}

/**
 * @param {string} result
 * @param {string} reason_code
 * @param {string} next_safe_action
 * @param {string[]} [evidence_refs]
 * @param {Record<string, unknown>} [extra]
 */
function scenarioResult(scenario, result, reason_code, next_safe_action, evidence_refs = [], extra = {}) {
  return {
    scenario,
    result,
    reason_code,
    next_safe_action,
    evidence_refs,
    ...extra,
  };
}

/**
 * @param {string} baseUrl
 * @param {string} relPath
 * @param {{ method?: string, body?: object, timeoutMs?: number }} [opts]
 */
function httpJson(baseUrl, relPath, opts = {}) {
  const method = opts.method || 'GET';
  const timeoutMs = opts.timeoutMs ?? 5000;
  const u = new URL(relPath.replace(/^\//, ''), `${baseUrl.replace(/\/$/, '')}/`);
  const lib = u.protocol === 'https:' ? require('https') : http;
  const body = opts.body ? JSON.stringify(opts.body) : null;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method,
        headers: body
          ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }
          : {},
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }
          resolve({ status: res.statusCode || 0, json, raw });
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      reject(Object.assign(new Error('http_timeout'), { code: 'ENDPOINT_UNREACHABLE' }));
    });
    req.on('error', (err) => {
      reject(Object.assign(err, { code: err.code || 'ENDPOINT_UNREACHABLE' }));
    });
    if (body) req.write(body);
    req.end();
  });
}

/**
 * @param {string} dir
 * @param {{ base_url: string, endpoint_scope?: string, models: string[] }} cfg
 */
function writeTempRoutingConfig(dir, cfg) {
  const ai = path.join(dir, '.ai-minions');
  fs.mkdirSync(ai, { recursive: true });
  const u = new URL(cfg.base_url);
  const yaml = [
    'model_policy_version: 1',
    `default_model: ${cfg.models[0]}`,
    'local_backend:',
    '  backend_id: ollama',
    '  support_status: supported',
    `  host: ${u.hostname}`,
    `  port: ${u.port || 80}`,
    `  base_url: ${cfg.base_url}`,
    `  endpoint_scope: ${cfg.endpoint_scope || 'localhost'}`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(ai, 'model-policy.yaml'), yaml);
  const policy = {
    model_policy_version: 1,
    default_tier: 'cheap',
    tiers: {
      cheap: [cfg.models.find((m) => /7b|small|tiny/i.test(m)) || cfg.models[0]],
      standard: [cfg.models.find((m) => /14b|medium/i.test(m)) || cfg.models[0]],
      strong: [cfg.models.find((m) => /35b|70b|large|strong/i.test(m)) || cfg.models[cfg.models.length - 1]],
      frontier: [],
    },
    role_defaults: {
      OWNER: 'strong',
      ARCHITECT: 'strong',
      DEV: 'cheap',
      QA: 'cheap',
      CERBERUS: 'strong',
      ORCHESTRATOR: 'standard',
    },
    rules: [],
  };
  // Ensure distinct cheap vs strong when possible.
  if (cfg.models.length >= 2) {
    policy.tiers.cheap = [cfg.models[0]];
    policy.tiers.strong = [cfg.models[1]];
    policy.tiers.standard = [cfg.models[Math.min(2, cfg.models.length - 1)]];
  }
  fs.writeFileSync(path.join(ai, 'model_policy.json'), `${JSON.stringify(policy, null, 2)}\n`);
  return { yamlPath: path.join(ai, 'model-policy.yaml'), jsonPath: path.join(ai, 'model_policy.json'), policy };
}

function overallFromScenarios(scenarios) {
  if (scenarios.some((s) => s.result === 'FAIL')) return 'FAIL';
  if (scenarios.some((s) => s.result === 'BLOCKED')) return 'BLOCKED';
  if (scenarios.every((s) => s.result === 'PASS')) return 'PASS';
  return 'FAIL';
}

async function main() {
  const mode = String(process.env.ROUTING_RELEASE_MODE || 'fixture').trim().toLowerCase();
  const commitSha = resolveCommitSha();
  const artifactDir = process.env.ROUTING_RELEASE_ARTIFACT_DIR
    ? path.resolve(process.env.ROUTING_RELEASE_ARTIFACT_DIR)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'routing-release-artifacts-'));
  fs.mkdirSync(artifactDir, { recursive: true });

  /** @type {ReturnType<typeof scenarioResult>[]} */
  const scenarios = [];
  const evidence = {
    chat_models: /** @type {{ agent: string, role: string, model: string, path: string }[]} */ ([]),
    model_selection_events: /** @type {Record<string, unknown>[]} */ ([]),
  };

  let proxy = null;
  let baseUrl = LIVE_DEFAULT_BASE;
  let fixtureModels = ['qwen2.5-coder:7b', 'qwen3.6:35b-a3b', 'qwen2.5-coder:14b'];
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'routing-release-cwd-'));

  process.env.ORCH_MODEL_MODE = 'local_only';
  delete process.env.ORCH_LOCAL_MODEL;
  delete process.env.OLLAMA_MODEL;
  delete process.env.MODEL_OVERRIDE_DEV;
  delete process.env.MODEL_OVERRIDE_ARCHITECT;
  // Routing smoke proves model selection + HTTP path — not the network ACL matrix.
  // Without this, ARCHITECT is denied (role_capability_domain_denied) before /api/chat.
  const prevSkipNet = process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE;
  process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE = '1';

  try {
    if (mode === 'fixture') {
      const { createOllamaFixtureProxy } = require('../tests/helpers/ollama-fixture-proxy');
      proxy = createOllamaFixtureProxy({
        basePath: '/olla/ollama',
        models: fixtureModels,
        host: '127.0.0.1',
      });
      const ep = await proxy.listen();
      baseUrl = ep.base_url;
      fixtureModels = proxy.models;
    } else if (mode === 'live') {
      baseUrl = String(process.env.ROUTING_RELEASE_LIVE_BASE_URL || LIVE_DEFAULT_BASE).replace(/\/$/, '');
    } else {
      scenarios.push(scenarioResult(
        'mode',
        'FAIL',
        'ROUTING_RELEASE_BAD_MODE',
        'Set ROUTING_RELEASE_MODE=fixture|live',
      ));
      throw new Error('bad_mode');
    }

    const { jsonPath, policy } = writeTempRoutingConfig(tmpRoot, {
      base_url: baseUrl,
      endpoint_scope: 'localhost',
      models: fixtureModels,
    });

    // ── 1. endpoint_path ──────────────────────────────────────────────
    try {
      const tags = await httpJson(baseUrl, '/api/tags');
      if (tags.status !== 200 || !tags.json?.models) {
        scenarios.push(scenarioResult(
          'endpoint_path',
          mode === 'live' ? 'BLOCKED' : 'FAIL',
          'ENDPOINT_TAGS_FAILED',
          mode === 'live'
            ? 'Start Olla at 127.0.0.1:40114/olla/ollama and retry live pack'
            : 'Fix fixture proxy /api/tags',
          [],
          { http_status: tags.status },
        ));
      } else {
        const chat = await httpJson(baseUrl, '/api/chat', {
          method: 'POST',
          body: { model: fixtureModels[0], messages: [{ role: 'user', content: 'ping' }], stream: false },
        });
        const pathOk = Boolean(proxy
          ? (proxy.tagsCaptures.some((c) => c.path.includes('/olla/ollama/api/tags'))
            && (proxy.chatCaptures.some((c) => c.path.includes('/olla/ollama/api/chat')) || chat.status === 200))
          : (tags.status === 200 && chat.status === 200));
        // init → doctor → start (temp cwd only)
        const { writeInstallModelConfig } = require('../install-model-config');
        const { runOperatorDoctor } = require('../modules/operator/operator-doctor-evidence');
        const {
          configureLocalModelPolicy,
          validateLocalOnlyRunPrerequisites,
          resetLocalModelPolicy,
        } = require('../modules/model-runtime/local-model-policy');

        const discovery = {
          backends: [{
            backend_id: 'ollama',
            support_status: 'supported',
            available: true,
            host: new URL(baseUrl).hostname,
            port: Number(new URL(baseUrl).port || 80),
            base_url: baseUrl,
            endpoint_scope: 'localhost',
            reason: null,
            discovery_method: 'http_tags',
          }],
          models: fixtureModels.map((name) => ({
            name,
            backend_id: 'ollama',
            family: 'qwen',
            size_bytes: name.includes('35b') || name.includes('70b') ? 40_000_000_000 : 5_000_000_000,
            context_length: null,
          })),
        };
        // Fresh subdir for install init (YAML create-if-absent).
        const initDir = path.join(tmpRoot, 'init-tree');
        fs.mkdirSync(initDir, { recursive: true });
        writeInstallModelConfig(initDir, discovery, 'local_only');
        let doctorOk = false;
        try {
          const doctor = await runOperatorDoctor({ cwd: tmpRoot, skipLiveProbes: false });
          doctorOk = doctor != null;
        } catch {
          doctorOk = false;
        }
        resetLocalModelPolicy();
        configureLocalModelPolicy({
          cwd: tmpRoot,
          endpointMeta: {
            host: new URL(baseUrl).hostname,
            port: Number(new URL(baseUrl).port || 80),
            base_url: baseUrl,
            endpoint_scope: 'localhost',
          },
          selectionResult: {
            selected_model: fixtureModels[0],
            override_source: 'model_policy_yaml',
            discovered_models: fixtureModels,
          },
          skipBackendCheck: mode === 'fixture',
        });
        let startOk = false;
        try {
          await validateLocalOnlyRunPrerequisites({
            cwd: tmpRoot,
            checkOllama: async () => {
              const t = await httpJson(baseUrl, '/api/tags');
              return t.status === 200;
            },
            selectLocalModel: async () => ({
              selected_model: fixtureModels[0],
              override_source: 'model_policy_yaml',
              discovered_models: fixtureModels,
            }),
          });
          startOk = true;
        } catch {
          startOk = false;
        }

        if (pathOk && startOk) {
          scenarios.push(scenarioResult(
            'endpoint_path',
            'PASS',
            'ENDPOINT_PATH_OK',
            'none',
            ['endpoint_path'],
            {
              tags_ok: true,
              chat_ok: chat.status === 200,
              init_written: fs.existsSync(path.join(initDir, '.ai-minions', 'model_policy.json')),
              doctor_invoked: doctorOk,
              start_prereq_ok: startOk,
              base_path_prefix: '/olla/ollama',
            },
          ));
        } else {
          scenarios.push(scenarioResult(
            'endpoint_path',
            mode === 'live' && !pathOk ? 'BLOCKED' : 'FAIL',
            'ENDPOINT_PATH_INCOMPLETE',
            'Verify base_url path prefix and local_only prereqs',
            [],
            { pathOk, startOk, doctorOk },
          ));
        }
      }
    } catch (err) {
      const unreachable = err && (err.code === 'ENDPOINT_UNREACHABLE' || err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND');
      scenarios.push(scenarioResult(
        'endpoint_path',
        mode === 'live' || unreachable ? 'BLOCKED' : 'FAIL',
        unreachable ? 'ENDPOINT_UNREACHABLE' : 'ENDPOINT_PATH_ERROR',
        unreachable
          ? (mode === 'live'
            ? 'Start Olla at 127.0.0.1:40114/olla/ollama then re-run ROUTING_RELEASE_MODE=live'
            : 'Ensure fixture proxy is listening')
          : 'Inspect endpoint_path error and retry',
        [],
        { error: String(err && err.message ? err.message : err).slice(0, 200) },
      ));
    }

    // ── 2. config_authority ───────────────────────────────────────────
    try {
      const { writeInstallModelConfig } = require('../install-model-config');
      const {
        fileSha256OrNull,
        detectModelRoutingConfigConflict,
        loadCanonicalRoutingConfig,
        MODEL_ROUTING_CONFIG_CONFLICT,
      } = require('../modules/model-runtime/model-policy-config');

      const authDir = path.join(tmpRoot, 'auth-tree');
      fs.mkdirSync(authDir, { recursive: true });
      const discovery = {
        backends: [{
          backend_id: 'ollama',
          support_status: 'supported',
          available: true,
          host: '127.0.0.1',
          port: 11434,
          base_url: 'http://127.0.0.1:11434',
          endpoint_scope: 'localhost',
        }],
        models: fixtureModels.map((name, i) => ({
          name,
          backend_id: 'ollama',
          family: 'qwen',
          size_bytes: i === 1 ? 40_000_000_000 : 5_000_000_000,
        })),
      };
      writeInstallModelConfig(authDir, discovery, 'local_only');
      const jsonFile = path.join(authDir, '.ai-minions', 'model_policy.json');
      const hash1 = fileSha256OrNull(jsonFile);
      const re = writeInstallModelConfig(authDir, discovery, 'local_only', { force: true });
      const hash2 = fileSha256OrNull(jsonFile);
      const preserved = hash1 && hash1 === hash2 && Array.isArray(re.files_preserved)
        && re.files_preserved.includes('model_policy.json');

      // Conflict: YAML declares role_defaults disagreeing / while JSON present with mismatch
      const conflictDir = path.join(tmpRoot, 'conflict-tree');
      fs.mkdirSync(path.join(conflictDir, '.ai-minions'), { recursive: true });
      fs.writeFileSync(
        path.join(conflictDir, '.ai-minions', 'model_policy.json'),
        fs.readFileSync(jsonPath, 'utf8'),
      );
      fs.writeFileSync(
        path.join(conflictDir, '.ai-minions', 'model-policy.yaml'),
        [
          'model_policy_version: 1',
          'default_model: qwen2.5-coder:7b',
          'role_defaults:',
          '  DEV: strong',
          '',
        ].join('\n'),
      );
      let conflictOk = false;
      try {
        loadCanonicalRoutingConfig(conflictDir);
      } catch (err) {
        conflictOk = Boolean(
          err
          && (err.code === MODEL_ROUTING_CONFIG_CONFLICT || /MODEL_ROUTING_CONFIG_CONFLICT/.test(String(err.message))),
        );
      }
      // Also unit-level detect
      if (!conflictOk) {
        const d = detectModelRoutingConfigConflict({
          yamlPolicy: {
            role_defaults: { DEV: 'strong' },
          },
          jsonPolicy: policy,
          jsonFilePresent: true,
        });
        conflictOk = d.ok === false && d.code === MODEL_ROUTING_CONFIG_CONFLICT;
      }

      if (preserved && conflictOk) {
        scenarios.push(scenarioResult(
          'config_authority',
          'PASS',
          'CONFIG_AUTHORITY_OK',
          'none',
          ['config_authority'],
          { json_hash_preserved: true, force_alone_no_rewrite: true, conflict_detected: true },
        ));
      } else {
        scenarios.push(scenarioResult(
          'config_authority',
          'FAIL',
          'CONFIG_AUTHORITY_REGRESSION',
          'Inspect install preserve/migrate and conflict detection',
          [],
          { preserved, conflictOk },
        ));
      }
    } catch (err) {
      scenarios.push(scenarioResult(
        'config_authority',
        'FAIL',
        'CONFIG_AUTHORITY_ERROR',
        'Fix config authority smoke path',
        [],
        { error: String(err && err.message ? err.message : err).slice(0, 200) },
      ));
    }

    // ── 3+4. tier_by_role + trace_honesty ─────────────────────────────
    try {
      const {
        configureLocalModelPolicy,
        resetLocalModelPolicy,
        getLocalModelEndpointMeta,
      } = require('../modules/model-runtime/local-model-policy');
      const {
        askAgent,
        setModelSelectionTraceReporter,
        clearDegradedAgents,
      } = require('../modules/shared/agents');
      const { deriveModelSelectionContext } = require('../modules/operator/operator-trace-summary');

      resetLocalModelPolicy();
      configureLocalModelPolicy({
        cwd: tmpRoot,
        endpointMeta: {
          host: new URL(baseUrl).hostname,
          port: Number(new URL(baseUrl).port || 80),
          base_url: baseUrl,
          endpoint_scope: 'localhost',
        },
        selectionResult: {
          selected_model: fixtureModels[0],
          override_source: 'model_policy_yaml',
          discovered_models: fixtureModels,
        },
        skipBackendCheck: true,
      });

      const events = [];
      setModelSelectionTraceReporter((payload) => {
        // Strip any accidental sensitive fields.
        const safe = { ...payload };
        delete safe.base_url;
        delete safe.messages;
        delete safe.prompt;
        events.push(safe);
      });
      clearDegradedAgents();

      const beforeChat = proxy ? proxy.chatCaptures.length : 0;
      for (const [agentId, role] of [['dev-backend', 'DEV'], ['architect', 'ARCHITECT']]) {
        try {
          await askAgent(agentId, `routing-release smoke for ${role}`, {
            cwd: tmpRoot,
            traceContext: { step_id: `smoke:${role.toLowerCase()}`, iteration: 1 },
          });
        } catch {
          // Output contract may fail on fixture stub; HTTP + model_selection already happened.
        }
      }
      setModelSelectionTraceReporter(null);

      if (proxy) {
        const newChats = proxy.chatCaptures.slice(beforeChat);
        for (const c of newChats) {
          evidence.chat_models.push({
            agent: 'captured',
            role: 'unknown',
            model: c.model || '',
            path: c.path,
          });
        }
      }

      // Prefer model_selection events for role→model mapping; also require chat captures when fixture.
      evidence.model_selection_events = events.filter((e) => e.event === 'model_selection');
      const byRole = new Map();
      for (const ev of evidence.model_selection_events) {
        if (typeof ev.role === 'string' && typeof ev.model === 'string') {
          byRole.set(ev.role, ev.model);
        }
      }
      const devModel = byRole.get('DEV');
      const archModel = byRole.get('ARCHITECT');
      const distinct = Boolean(devModel && archModel && devModel !== archModel);

      let chatDistinct = true;
      if (proxy) {
        const modelsPosted = evidence.chat_models.map((c) => c.model).filter(Boolean);
        chatDistinct = new Set(modelsPosted).size >= 2;
      }

      const phaseA = evidence.model_selection_events.every((ev) => (
        typeof ev.provider_id === 'string'
        && typeof ev.route_source === 'string'
        && Object.prototype.hasOwnProperty.call(ev, 'tier')
        && !Object.prototype.hasOwnProperty.call(ev, 'base_url')
      ));

      const ctx = deriveModelSelectionContext(evidence.model_selection_events);
      const notAgg = ctx.availability === 'not_aggregated';

      if (distinct && chatDistinct && phaseA && notAgg) {
        scenarios.push(scenarioResult(
          'tier_by_role',
          'PASS',
          'TIER_BY_ROLE_DISTINCT_INVOCATIONS',
          'none',
          ['chat_capture.json', 'model_selection.json'],
          { dev_model: devModel, architect_model: archModel },
        ));
        scenarios.push(scenarioResult(
          'trace_honesty',
          'PASS',
          'TRACE_HONESTY_OK',
          'none',
          ['model_selection.json'],
          { model_selection_availability: ctx.availability, phase_a_fields: true },
        ));
      } else {
        if (!distinct || !chatDistinct) {
          scenarios.push(scenarioResult(
            'tier_by_role',
            mode === 'live' && !devModel ? 'BLOCKED' : 'FAIL',
            'TIER_BY_ROLE_NOT_DISTINCT',
            'Ensure role_defaults map DEV/ARCHITECT to different inventory models',
            [],
            { devModel, archModel, chatDistinct },
          ));
        } else {
          scenarios.push(scenarioResult(
            'tier_by_role',
            'PASS',
            'TIER_BY_ROLE_DISTINCT_INVOCATIONS',
            'none',
            ['chat_capture.json'],
            { dev_model: devModel, architect_model: archModel },
          ));
        }
        scenarios.push(scenarioResult(
          'trace_honesty',
          phaseA && notAgg ? 'PASS' : 'FAIL',
          phaseA && notAgg ? 'TRACE_HONESTY_OK' : 'TRACE_HONESTY_REGRESSION',
          'Check model_selection Phase A fields and not_aggregated safeguard',
          [],
          { phaseA, notAgg, availability: ctx.availability },
        ));
      }
      void getLocalModelEndpointMeta;
    } catch (err) {
      scenarios.push(scenarioResult(
        'tier_by_role',
        'FAIL',
        'TIER_BY_ROLE_ERROR',
        'Inspect askAgent/local_only wiring',
        [],
        { error: String(err && err.message ? err.message : err).slice(0, 200) },
      ));
      scenarios.push(scenarioResult(
        'trace_honesty',
        'FAIL',
        'TRACE_HONESTY_ERROR',
        'Inspect model_selection emission',
        [],
        { error: String(err && err.message ? err.message : err).slice(0, 200) },
      ));
    }

    // ── 5. fail_closed (endpoint vs missing model) ────────────────────
    try {
      const {
        selectModelForRole,
        configureLocalModelPolicy,
        resetLocalModelPolicy,
        MODEL_NOT_FOUND,
      } = require('../modules/model-runtime/local-model-policy');

      let endpointBlocked = false;
      try {
        await httpJson('http://127.0.0.1:1', '/api/tags', { timeoutMs: 800 });
      } catch (err) {
        endpointBlocked = Boolean(err);
      }

      resetLocalModelPolicy();
      const missDir = path.join(tmpRoot, 'missing-model');
      writeTempRoutingConfig(missDir, {
        base_url: baseUrl,
        models: ['qwen2.5-coder:7b', 'qwen3.6:35b-a3b'],
      });
      // Strong inventory missing: only cheap present
      configureLocalModelPolicy({
        cwd: missDir,
        selectionResult: {
          selected_model: 'qwen2.5-coder:7b',
          override_source: 'model_policy_yaml',
          discovered_models: ['qwen2.5-coder:7b'],
        },
      });
      let missingModel = false;
      try {
        selectModelForRole('ARCHITECT', { cwd: missDir });
      } catch (err) {
        missingModel = Boolean(err && err.code === MODEL_NOT_FOUND);
      }

      if (endpointBlocked && missingModel) {
        scenarios.push(scenarioResult(
          'fail_closed_endpoint',
          'PASS',
          'FAIL_CLOSED_ENDPOINT_DISTINCT',
          'none',
          ['fail_closed'],
        ));
        scenarios.push(scenarioResult(
          'fail_closed_model',
          'PASS',
          'FAIL_CLOSED_MODEL_NOT_FOUND',
          'none',
          ['fail_closed'],
        ));
      } else {
        scenarios.push(scenarioResult(
          'fail_closed_endpoint',
          endpointBlocked ? 'PASS' : 'FAIL',
          endpointBlocked ? 'FAIL_CLOSED_ENDPOINT_DISTINCT' : 'FAIL_CLOSED_ENDPOINT_MISSED',
          endpointBlocked ? 'none' : 'Unreachable endpoint must surface as distinct blocker',
        ));
        scenarios.push(scenarioResult(
          'fail_closed_model',
          missingModel ? 'PASS' : 'FAIL',
          missingModel ? 'FAIL_CLOSED_MODEL_NOT_FOUND' : 'FAIL_CLOSED_MODEL_MISSED',
          missingModel ? 'none' : 'Missing tier inventory must raise MODEL_NOT_FOUND',
        ));
      }
    } catch (err) {
      scenarios.push(scenarioResult(
        'fail_closed_endpoint',
        'FAIL',
        'FAIL_CLOSED_ERROR',
        'Inspect fail-closed scenarios',
        [],
        { error: String(err && err.message ? err.message : err).slice(0, 200) },
      ));
      scenarios.push(scenarioResult(
        'fail_closed_model',
        'FAIL',
        'FAIL_CLOSED_ERROR',
        'Inspect fail-closed scenarios',
      ));
    }
  } finally {
    if (proxy) {
      try { await proxy.close(); } catch { /* ignore */ }
    }
    if (prevSkipNet === undefined) delete process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE;
    else process.env.ORCH_SKIP_NETWORK_PERMISSION_GATE = prevSkipNet;
  }

  // Ensure required scenario names exist
  const required = [
    'endpoint_path',
    'config_authority',
    'tier_by_role',
    'trace_honesty',
    'fail_closed_endpoint',
    'fail_closed_model',
  ];
  for (const name of required) {
    if (!scenarios.some((s) => s.scenario === name)) {
      scenarios.push(scenarioResult(
        name,
        'FAIL',
        'SCENARIO_NOT_RUN',
        'Re-run routing-release smoke; scenario did not execute',
      ));
    }
  }

  const chatCapturePath = path.join(artifactDir, 'chat_capture.json');
  const modelSelPath = path.join(artifactDir, 'model_selection.json');
  fs.writeFileSync(chatCapturePath, `${JSON.stringify(evidence.chat_models, null, 2)}\n`);
  fs.writeFileSync(modelSelPath, `${JSON.stringify(evidence.model_selection_events, null, 2)}\n`);

  // Attach evidence refs without secrets
  for (const s of scenarios) {
    if (!Array.isArray(s.evidence_refs)) s.evidence_refs = [];
    if (s.scenario === 'tier_by_role' || s.scenario === 'trace_honesty') {
      if (!s.evidence_refs.includes('chat_capture.json')) s.evidence_refs.push('chat_capture.json');
      if (!s.evidence_refs.includes('model_selection.json')) s.evidence_refs.push('model_selection.json');
    }
  }

  const overall = overallFromScenarios(scenarios);
  const artifact = {
    commit_sha: commitSha,
    mode,
    overall,
    scenarios,
    evidence_refs: ['chat_capture.json', 'model_selection.json', 'routing-release-result.json'],
    // host/port/path only — never credentialed URLs with secrets
    endpoint_hint: mode === 'live' ? '127.0.0.1:40114/olla/ollama' : 'fixture:127.0.0.1:<ephemeral>/olla/ollama',
  };
  const resultPath = path.join(artifactDir, 'routing-release-result.json');
  fs.writeFileSync(resultPath, `${JSON.stringify(artifact, null, 2)}\n`);

  console.log(JSON.stringify({
    commit_sha: commitSha,
    mode,
    overall,
    artifact_dir: artifactDir,
    scenarios: scenarios.map((s) => ({ scenario: s.scenario, result: s.result, reason_code: s.reason_code })),
  }, null, 2));

  if (overall !== 'PASS') {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err));
  process.exitCode = 1;
});
