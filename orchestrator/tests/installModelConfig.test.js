'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = require('js-yaml');

const {
  buildInstallModelConfig,
  writeInstallModelConfig,
  classifyModelTier,
  buildProviderInferenceProfiles,
  MODEL_POLICY_YAML,
  MODEL_POLICY_JSON,
  INSTALL_PROFILE_JSON,
} = require('../install-model-config');
const { validateModelPolicy: validateRuntimeYamlPolicy } = require('../local-model-selection');
const {
  validateModelPolicy,
  validateProviderInferenceProfiles,
} = require('../modules/model-runtime/model-policy-config');

const SAMPLE_DISCOVERY = {
  backends: [
    {
      backend_id: 'ollama',
      support_status: 'supported',
      available: true,
      host: 'localhost',
      port: 11434,
      reason: null,
      discovery_method: 'http_tags',
    },
  ],
  models: [
    {
      name: 'qwen2.5-coder:7b',
      backend_id: 'ollama',
      family: 'qwen2',
      size_bytes: 4_683_087_332,
      context_length: null,
    },
    {
      name: 'llama3.1:70b',
      backend_id: 'ollama',
      family: 'llama',
      size_bytes: 40_000_000_000,
      context_length: null,
    },
  ],
};

describe('install-model-config — tier classification', () => {
  it('classifyModelTier maps size and name hints', () => {
    assert.equal(classifyModelTier({ name: 'tiny:1b', size_bytes: 1_000_000_000 }), 'cheap');
    assert.equal(classifyModelTier({ name: 'qwen2.5-coder:7b', size_bytes: 5_000_000_000 }), 'standard');
    assert.equal(classifyModelTier({ name: 'llama3.1:70b', size_bytes: 40_000_000_000 }), 'strong');
  });
});

describe('install-model-config — build', () => {
  it('buildInstallModelConfig produces validated YAML and JSON', () => {
    const built = buildInstallModelConfig(SAMPLE_DISCOVERY, 'remote_ok');
    assert.equal(built.defaultModel, 'qwen2.5-coder:7b');
    assert.equal(built.degradedSingleModel, false);
    assert.equal(built.yamlPolicy.local_backend.backend_id, 'ollama');
    assert.equal(built.yamlPolicy.local_backend.support_status, 'supported');
    assert.ok(built.jsonPolicy.provider_inference_profiles.anthropic);
    assert.ok(built.jsonPolicy.provider_inference_profiles.ollama);
    validateRuntimeYamlPolicy(built.yamlPolicy);
    validateModelPolicy(built.jsonPolicy);
  });

  it('single model sets degradedSingleModel', () => {
    const built = buildInstallModelConfig(
      {
        backends: SAMPLE_DISCOVERY.backends,
        models: [SAMPLE_DISCOVERY.models[0]],
      },
      'local_only',
    );
    assert.equal(built.degradedSingleModel, true);
  });

  it('buildProviderInferenceProfiles includes anthropic for remote_ok', () => {
    const profiles = buildProviderInferenceProfiles('remote_ok');
    assert.ok(profiles.anthropic);
    assert.equal(profiles.anthropic.by_role.ARCHITECT.effort, 'high');
    validateProviderInferenceProfiles(profiles);
  });
});

describe('install-model-config — write', () => {
  it('writeInstallModelConfig writes three files under .ai-minions', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'install-model-config-'));
    const result = writeInstallModelConfig(tmp, SAMPLE_DISCOVERY, 'remote_ok', {
      now: () => '2026-05-18T00:00:00.000Z',
    });

    assert.equal(result.inference_profiles_written, true);
    assert.equal(result.inference_profile_mode, 'declarative');
    assert.deepEqual(result.files_written, [MODEL_POLICY_YAML, MODEL_POLICY_JSON, INSTALL_PROFILE_JSON]);

    const yamlPath = path.join(tmp, '.ai-minions', MODEL_POLICY_YAML);
    const jsonPath = path.join(tmp, '.ai-minions', MODEL_POLICY_JSON);
    const profilePath = path.join(tmp, '.ai-minions', INSTALL_PROFILE_JSON);

    assert.ok(fs.existsSync(yamlPath));
    assert.ok(fs.existsSync(jsonPath));
    assert.ok(fs.existsSync(profilePath));

    const parsedYaml = yaml.load(fs.readFileSync(yamlPath, 'utf8'));
    const parsedJson = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const installProfile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));

    assert.equal(parsedYaml.default_model, 'qwen2.5-coder:7b');
    assert.equal(parsedYaml.local_backend.backend_id, 'ollama');
    assert.ok(parsedJson.provider_inference_profiles);
    assert.equal(installProfile.inference_profile_mode, 'declarative');
  });
});

describe('install-model-config — profile validation', () => {
  it('validateProviderInferenceProfiles rejects invalid effort', () => {
    assert.throws(
      () =>
        validateProviderInferenceProfiles({
          anthropic: {
            default: {
              effort: 'turbo',
              thinking_mode: 'disabled',
              thinking_display: 'omit',
              max_tokens: 100,
            },
          },
        }),
      /effort must be low\|medium\|high/,
    );
  });
});
