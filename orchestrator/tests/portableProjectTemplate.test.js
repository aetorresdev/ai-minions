"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  scrubProjectFileContent,
  buildExportBundle,
  dryRunImport,
  containsUnredactedSecretShape,
} = require("../portable-project-template");

function fakeSkToken() {
  return "sk-" + "m".repeat(21);
}

function withTempProject(files, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ppt-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(dir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, "utf8");
    }
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const MINIONS = `# contract
\`\`\`json
{
  "minions_contract_version": "0.1",
  "orchestrator": { "trace_scenario_id": "team-smoke" }
}
\`\`\`
`;

const POLICY = `
permission_policy_version: 1
extends:
  - dev-local
project_capabilities:
  - n8n_workflow_authoring
runtime:
  allow_public_docs_lookup: true
credentials:
  reveal: deny
  export: deny
`;

test("scrubProjectFileContent redacts secret-shaped yaml values", () => {
  const yaml = `
permission_policy_version: 1
extends:
  - dev-local
runtime:
  api_token: ${fakeSkToken()}
credentials:
  reveal: deny
  export: deny
`;
  const { content, redactions } = scrubProjectFileContent(".ai-minions/permissions.yaml", yaml);
  assert.ok(redactions >= 1);
  assert.ok(!content.includes(fakeSkToken()));
  assert.equal(containsUnredactedSecretShape(content), false);
});

test("buildExportBundle includes harness refs and scrubbed project files", () => {
  withTempProject(
    {
      "minions.md": MINIONS,
      ".ai-minions/permissions.yaml": POLICY,
      ".ai-minions/doc-pointers.json": JSON.stringify(
        {
          doc_pointers_version: "0.1",
          entries: [{ label: "Usage", relative_path: "docs/how-to/usage-smoke-guide.md" }],
        },
        null,
        2,
      ),
    },
    (dir) => {
      const bundle = buildExportBundle(dir);
      assert.equal(bundle.portable_project_template_version, "0.1");
      assert.ok(bundle.harness_refs.capability_matrix.role_ids.length > 0);
      assert.ok(bundle.harness_refs.routing.models_json_profile_names.length > 0);
      assert.equal(bundle.project_files.length, 3);
      assert.equal(bundle.doc_pointers.length, 1);
      for (const f of bundle.project_files) {
        assert.equal(containsUnredactedSecretShape(f.content), false);
      }
    },
  );
});

test("buildExportBundle scrubs inline secret in yaml notes field", () => {
  const token = fakeSkToken();
  withTempProject(
    {
      "minions.md": MINIONS,
      ".ai-minions/permissions.yaml": `
permission_policy_version: 1
extends:
  - dev-local
notes: ${token}
credentials:
  reveal: deny
  export: deny
`,
    },
    (dir) => {
      const bundle = buildExportBundle(dir);
      const policy = bundle.project_files.find((f) => f.relative_path.endsWith("permissions.yaml"));
      assert.ok(policy);
      assert.ok(!policy.content.includes(token));
      assert.equal(containsUnredactedSecretShape(policy.content), false);
    },
  );
});

test("dryRunImport reports create when targets missing", () => {
  withTempProject({ "minions.md": MINIONS }, (dir) => {
    const bundle = buildExportBundle(dir);
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "ppt-empty-"));
    try {
      const result = dryRunImport(empty, bundle);
      assert.equal(result.ok, true);
      assert.ok(result.actions.some((a) => a.action === "create"));
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});

test("dryRunImport reports conflict when content differs", () => {
  withTempProject({ "minions.md": MINIONS }, (dir) => {
    const bundle = buildExportBundle(dir);
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "ppt-conflict-"));
    try {
      fs.writeFileSync(path.join(target, "minions.md"), "# different\n", "utf8");
      const result = dryRunImport(target, bundle);
      assert.equal(result.ok, false);
      assert.equal(result.conflicts.length, 1);
      assert.equal(result.conflicts[0].relative_path, "minions.md");
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
    }
  });
});

test("CLI export and import dry-run exit 0 on clean fixture", () => {
  withTempProject(
    {
      "minions.md": MINIONS,
      ".ai-minions/permissions.yaml": POLICY,
    },
    (dir) => {
      const cli = path.join(__dirname, "..", "project-template-cli.js");
      const outFile = path.join(dir, "bundle.json");
      const exp = spawnSync(process.execPath, [cli, "export", "--cwd", dir, "--out", outFile], {
        encoding: "utf8",
      });
      assert.equal(exp.status, 0, exp.stderr || exp.stdout);
      const empty = fs.mkdtempSync(path.join(os.tmpdir(), "ppt-cli-"));
      try {
        const imp = spawnSync(
          process.execPath,
          [cli, "import", "--dry-run", "--cwd", empty, "--file", outFile],
          { encoding: "utf8" },
        );
        assert.equal(imp.status, 0, imp.stderr || imp.stdout);
        assert.match(imp.stdout, /create|Result: OK/);
      } finally {
        fs.rmSync(empty, { recursive: true, force: true });
      }
    },
  );
});
