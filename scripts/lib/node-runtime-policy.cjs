'use strict';

/**
 * Single Node.js runtime policy for install, bootstrap/doctor, and CLI startup.
 * No network. No third-party version parser.
 */

/** Minimum supported major (Node 22 LTS). */
const MIN_NODE_MAJOR = 22;

/** Stable reason code when detected major is below minimum or unparseable. */
const NODE_VERSION_UNSUPPORTED = 'NODE_VERSION_UNSUPPORTED';

/**
 * @param {string | null | undefined} nodeVersion
 * @returns {number | null}
 */
function parseNodeMajor(nodeVersion) {
  if (nodeVersion == null) return null;
  const raw = String(nodeVersion).trim().replace(/^v/i, '');
  if (!raw) return null;
  const majorToken = raw.split(/[.\-+]/)[0];
  const major = Number.parseInt(majorToken, 10);
  return Number.isFinite(major) ? major : null;
}

/**
 * @param {string | null | undefined} nodeVersion
 * @param {{ minMajor?: number }} [options]
 * @returns {{
 *   ok: boolean,
 *   major: number | null,
 *   detected: string,
 *   required_minimum: number,
 *   reason_code: string | null,
 *   message: string,
 *   remediation: string | null,
 * }}
 */
function assessNodeRuntime(nodeVersion, options = {}) {
  const minMajor = options.minMajor ?? MIN_NODE_MAJOR;
  const detected = nodeVersion == null ? '' : String(nodeVersion).trim();
  const major = parseNodeMajor(detected);
  if (major == null || major < minMajor) {
    const shown = detected || '(unknown)';
    return {
      ok: false,
      major,
      detected: shown,
      required_minimum: minMajor,
      reason_code: NODE_VERSION_UNSUPPORTED,
      message: `Node.js >= ${minMajor} required (got ${shown})`,
      remediation: `Install Node.js ${minMajor}+ (LTS), then re-run`,
    };
  }
  return {
    ok: true,
    major,
    detected,
    required_minimum: minMajor,
    reason_code: null,
    message: `Node.js ${detected}`,
    remediation: null,
  };
}

/**
 * Fail-closed CLI/process gate. Returns assessment; caller exits on !ok.
 * @param {string | null | undefined} [nodeVersion]
 * @param {{ minMajor?: number }} [options]
 */
function assertSupportedNodeRuntime(nodeVersion = process.versions.node, options = {}) {
  return assessNodeRuntime(nodeVersion, options);
}

module.exports = {
  MIN_NODE_MAJOR,
  NODE_VERSION_UNSUPPORTED,
  parseNodeMajor,
  assessNodeRuntime,
  assertSupportedNodeRuntime,
};
