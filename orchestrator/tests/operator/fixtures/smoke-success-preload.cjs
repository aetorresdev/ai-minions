'use strict';

const path = require('path');

const guidedPath = path.resolve(
  __dirname,
  '../../../modules/operator/operator-guided-first-run.js',
);
const guided = require(guidedPath);

guided.runSmoke = async () => ({
  ok: true,
  exitCode: 0,
  preflightText: 'preflight ok',
  routingText: 'routing ok',
  text: 'smoke done',
  reason_code: 'SMOKE_OK',
});
