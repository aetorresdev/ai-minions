'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  evaluateCapabilityProbe,
  evaluateRoleCapability,
  PROBE_FIXTURES_PASS,
  PROBE_FIXTURES_FAIL,
  pickCapableModel,
  assertModelMeetsRoleCapability,
  MODEL_CAPABILITY_INSUFFICIENT,
} = require('../modules/model-runtime/role-capability-probes');
const {
  isCriticalCapabilityRole,
  getRoleCapabilityProfile,
} = require('../modules/model-runtime/role-capability-profile');
const {
  selectModelForRole,
  resetLocalModelPolicy,
} = require('../modules/model-runtime/local-model-policy');

describe('role capability profiles', () => {
  it('marks ARCHITECT QA CERBERUS as critical', () => {
    assert.equal(isCriticalCapabilityRole('architect'), true);
    assert.equal(isCriticalCapabilityRole('QA'), true);
    assert.equal(isCriticalCapabilityRole('CERBERUS'), true);
    assert.equal(isCriticalCapabilityRole('DEV'), false);
  });

  it('defines required probes without brand/size fields', () => {
    const p = getRoleCapabilityProfile('ARCHITECT');
    assert.ok(p.required_probes.includes('planning_json'));
    assert.ok(p.min_num_predict >= 4096);
    assert.equal('parameter_count' in p, false);
  });
});

describe('capability probe fixtures', () => {
  it('pass fixtures satisfy every critical role profile', () => {
    for (const role of ['ARCHITECT', 'QA', 'CERBERUS']) {
      const result = evaluateRoleCapability(role, {
        use_pass_fixtures: true,
        num_predict: 8192,
      });
      assert.equal(result.ok, true, `${role}: ${JSON.stringify(result.failed_probes)}`);
      assert.equal(result.reason_code, null);
    }
  });

  it('fail fixtures mark profile insufficient', () => {
    const result = evaluateRoleCapability('ARCHITECT', {
      probe_outputs: {
        planning_json: PROBE_FIXTURES_FAIL.planning_json,
        architect_files_read: PROBE_FIXTURES_FAIL.architect_files_read,
      },
      num_predict: 8192,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason_code, MODEL_CAPABILITY_INSUFFICIENT);
    assert.ok(result.failed_probes.some((f) => f.probe_id === 'planning_json'));
  });

  it('output_budget probe rejects low num_predict', () => {
    const r = evaluateCapabilityProbe('output_budget', '', {
      num_predict: 512,
      min_num_predict: 4096,
    });
    assert.equal(r.ok, false);
    assert.equal(r.gate_id, 'output_budget');
  });

  it('pass fixture planning_json validates', () => {
    const r = evaluateCapabilityProbe('planning_json', PROBE_FIXTURES_PASS.planning_json);
    assert.equal(r.ok, true);
  });
});

describe('selectModelForRole capability filtering', () => {
  it('skips failing model and picks capable inventory hit', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-sel-'));
    try {
      const ai = path.join(tmp, '.ai-minions');
      fs.mkdirSync(ai, { recursive: true });
      fs.writeFileSync(
        path.join(ai, 'model_policy.json'),
        JSON.stringify({
          model_policy_version: 1,
          default_tier: 'standard',
          tiers: {
            cheap: ['tiny:1b'],
            standard: ['tiny:1b'],
            strong: ['tiny:1b', 'capable:35b'],
            frontier: [],
          },
          role_defaults: {
            ORCHESTRATOR: 'cheap',
            OWNER: 'standard',
            ARCHITECT: 'strong',
            DEV: 'standard',
            QA: 'strong',
            CERBERUS: 'strong',
          },
          rules: [],
        }),
      );
      resetLocalModelPolicy();
      const picked = selectModelForRole('ARCHITECT', {
        cwd: tmp,
        inventory: ['tiny:1b', 'capable:35b'],
        capabilityByModel: {
          'tiny:1b': { ARCHITECT: { ok: false, failed_probes: [{ probe_id: 'planning_json' }] } },
          'capable:35b': { ARCHITECT: { ok: true, passed_probes: ['planning_json'] } },
        },
      });
      assert.equal(picked.model, 'capable:35b');
      assert.equal(picked.route_source, 'role_defaults');
    } finally {
      resetLocalModelPolicy();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('blocks under local_only when all inventory candidates fail capability', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-block-'));
    try {
      const ai = path.join(tmp, '.ai-minions');
      fs.mkdirSync(ai, { recursive: true });
      fs.writeFileSync(
        path.join(ai, 'model_policy.json'),
        JSON.stringify({
          model_policy_version: 1,
          default_tier: 'standard',
          tiers: {
            cheap: ['tiny:1b'],
            standard: ['tiny:1b'],
            strong: ['tiny:1b'],
            frontier: [],
          },
          role_defaults: {
            ORCHESTRATOR: 'cheap',
            OWNER: 'standard',
            ARCHITECT: 'strong',
            DEV: 'standard',
            QA: 'strong',
            CERBERUS: 'strong',
          },
          rules: [],
        }),
      );
      resetLocalModelPolicy();
      assert.throws(
        () => selectModelForRole('CERBERUS', {
          cwd: tmp,
          inventory: ['tiny:1b'],
          capabilityByModel: {
            'tiny:1b': { CERBERUS: { ok: false } },
          },
        }),
        (err) => err && err.code === MODEL_CAPABILITY_INSUFFICIENT,
      );
    } finally {
      resetLocalModelPolicy();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('pickCapableModel prefers ok over unknown over fail', () => {
    const inv = new Set(['a', 'b', 'c']);
    const chosen = pickCapableModel(['a', 'b', 'c'], inv, 'QA', {
      capabilityByModel: {
        a: { QA: { ok: false } },
        b: { QA: { ok: true } },
        c: { QA: { ok: true } },
      },
    });
    assert.equal(chosen, 'b');
  });

  it('assertModelMeetsRoleCapability throws on failing evidence', () => {
    assert.throws(
      () => assertModelMeetsRoleCapability('tiny:1b', 'QA', {
        capabilityByModel: { 'tiny:1b': { QA: { ok: false } } },
      }),
      (err) => err && err.code === MODEL_CAPABILITY_INSUFFICIENT,
    );
  });

  it('assertModelMeetsRoleCapability no-ops without evidence', () => {
    assert.doesNotThrow(() => assertModelMeetsRoleCapability('any', 'QA', {}));
  });
});
