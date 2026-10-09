/**
 * Load-time execution check for HTML fixture artifacts.
 *
 * The structural checks in canonical-real-task-fixtures-data.mjs only look at the source text, so an app
 * that throws while loading (and therefore never renders its board) still passes them. This module runs
 * the inline <script> blocks against a tolerant DOM stub and fails on any uncaught exception.
 *
 * The artifact is model-generated, so it never runs in the calling process: it is executed in a child
 * Node process. `--permission` is not a filesystem barrier: Node documents that it does not cover every
 * API, and `node:sqlite` can create and read files with no fs grant. Before any artifact code runs, the
 * child seals `getBuiltinModule`, `binding` and `dlopen`, so an escape that reaches `process` still
 * cannot open those APIs. The result line carries a proof token that exists only in the child's local
 * scope and is written with a `writeSync` bound before the artifact runs; a forged `{ok:true}` or a
 * non-zero exit cannot pass. This is a crash-on-load smoke check, not a browser test.
 *
 * Limits: network access is not restricted. Timers scheduled by the artifact are not run (the stub
 * `setTimeout` does not fire). Init handlers are: `DOMContentLoaded` and `load` listeners, including
 * ones that return a promise, and a `window.onload` property assignment.
 */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const EXEC_TIMEOUT_MS = 4000;
const CHILD_TIMEOUT_MS = 15000;
const MAX_ERROR_CHARS = 300;

/**
 * Inline (non-`src`) script bodies in document order.
 * @param {string} htmlText
 * @returns {string[]}
 */
export function extractInlineScripts(htmlText) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(String(htmlText))) !== null) {
    if (/\bsrc\s*=/i.test(m[1])) continue;
    if (/\btype\s*=\s*["']?(?!text\/javascript|module|application\/javascript)[^"'\s>]+/i.test(m[1])) continue;
    out.push(m[2]);
  }
  return out;
}

/** Runs inside the child process. Reads `{ scripts, timeoutMs, proof }` from stdin, prints one JSON line. */
const CHILD_RUNNER = String.raw`
const fs = require("node:fs");
const vm = require("node:vm");
const writeFd = fs.writeSync.bind(fs);
function deny(what) {
  const err = new Error("Access to this API has been restricted (" + what + ")");
  err.code = "ERR_ACCESS_DENIED";
  throw err;
}
process.getBuiltinModule = (id) => deny("getBuiltinModule " + id);
process.binding = (id) => deny("binding " + id);
process.dlopen = () => deny("dlopen");
process.mainModule = undefined;
const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  const { scripts, timeoutMs, proof } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const listeners = { document: {}, window: {} };
  const byId = new Map();
  const emptyIter = () => ({ next: () => ({ done: true, value: undefined }) });
  const make = () => {
    const target = function () {};
    const store = Object.create(null);
    const proxy = new Proxy(target, {
      get(_t, p) {
        if (p === Symbol.toPrimitive) return () => "";
        if (p === Symbol.iterator) return emptyIter;
        if (p === "then") return undefined;
        if (p === "length") return store.length ?? 0;
        if (p === "children" || p === "childNodes") return [];
        if (p === "value" || p === "textContent" || p === "innerHTML" || p === "className" || p === "id") return store[p] ?? "";
        if (p in store) return store[p];
        store[p] = make();
        return store[p];
      },
      set(_t, p, v) { store[p] = v; return true; },
      apply() { return make(); },
      construct() { return make(); },
    });
    return proxy;
  };
  const doc = make();
  doc.getElementById = (id) => { if (!byId.has(id)) byId.set(id, make()); return byId.get(id); };
  doc.createElement = () => make();
  doc.querySelector = () => make();
  doc.querySelectorAll = () => [];
  doc.getElementsByClassName = () => [];
  doc.getElementsByTagName = () => [];
  doc.addEventListener = (t, f) => { (listeners.document[t] ||= []).push(f); };
  const win = make();
  win.addEventListener = (t, f) => { (listeners.window[t] ||= []).push(f); };
  const storage = { getItem: () => null, setItem() {}, removeItem() {}, clear() {} };
  const sandbox = {
    document: doc, window: win, self: win, globalThis: undefined,
    localStorage: storage, sessionStorage: storage,
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    setTimeout: () => 0, setInterval: () => 0, clearTimeout() {}, clearInterval() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    alert() {}, confirm: () => true, prompt: () => null,
    Math, Set, Map, Array, Object, JSON, Number, String, Boolean, Date, RegExp, Error, Symbol, Promise,
    parseInt, parseFloat, isNaN, isFinite,
  };
  win.document = doc;
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  const result = { ok: true };
  const fail = (phase, e) => {
    const msg = e && e.message ? e.message : String(e);
    result.ok = false;
    result.phase = phase;
    result.error = msg;
  };
  try {
    for (const code of scripts) new vm.Script(code, { filename: "inline.js" }).runInContext(context, { timeout: timeoutMs });
  } catch (e) { fail("load", e); }
  const pending = [];
  const callHandler = (h) => {
    if (typeof h !== "function" || !result.ok) return;
    try {
      const returned = h({});
      if (returned && typeof returned.then === "function") {
        pending.push(Promise.resolve(returned).then(() => {}, (e) => fail("init", e)));
      }
    } catch (e) { fail("init", e); }
  };
  if (result.ok) {
    const handlers = [
      ...(listeners.document.DOMContentLoaded || []),
      ...(listeners.window.DOMContentLoaded || []),
      ...(listeners.window.load || []),
    ];
    for (const h of handlers) callHandler(h);
    callHandler(win.onload);
  }
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    writeFd(1, JSON.stringify({ ok: result.ok, phase: result.phase, error: result.error, proof }) + "\n");
    process.exit(result.ok ? 0 : 1);
  };
  if (pending.length === 0) finish();
  else {
    const timer = setTimeout(() => {
      if (result.ok) fail("init", new Error("init handler timed out"));
      finish();
    }, timeoutMs);
    Promise.all(pending).then(() => { clearTimeout(timer); finish(); }, () => { clearTimeout(timer); finish(); });
  }
});
`;

/**
 * @param {string} htmlText
 * @param {{ timeoutMs?: number }} [options]
 * @returns {{ ok: boolean, error?: string, phase?: string }}
 */
export function executeInlineScripts(htmlText, options = {}) {
  const scripts = extractInlineScripts(htmlText);
  if (scripts.length === 0) {
    return { ok: false, phase: "extract", error: "no inline script to execute" };
  }
  const proof = randomBytes(16).toString("hex");
  const child = spawnSync(
    process.execPath,
    ["--permission", "-e", CHILD_RUNNER],
    {
      input: JSON.stringify({ scripts, timeoutMs: options.timeoutMs ?? EXEC_TIMEOUT_MS, proof }),
      encoding: "utf8",
      timeout: CHILD_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      env: { PATH: process.env.PATH ?? "" },
    },
  );
  if (child.error) {
    return { ok: false, phase: "spawn", error: `script execution unavailable: ${child.error.message}`.slice(0, MAX_ERROR_CHARS) };
  }
  if (child.signal) {
    return { ok: false, phase: "child", error: `script execution killed (${child.signal})` };
  }
  const lastLine = String(child.stdout ?? "").trim().split("\n").pop() ?? "";
  let parsed;
  try {
    parsed = JSON.parse(lastLine);
  } catch {
    parsed = null;
  }
  if (!parsed || parsed.proof !== proof) {
    return {
      ok: false,
      phase: "child",
      error: `untrusted script result (exit ${child.status ?? "?"})`.slice(0, MAX_ERROR_CHARS),
    };
  }
  if (parsed.ok === true) {
    if (child.status !== 0) {
      return { ok: false, phase: "child", error: `script child exited ${child.status}` };
    }
    return { ok: true };
  }
  return { ok: false, phase: parsed.phase, error: String(parsed.error ?? "script error").slice(0, MAX_ERROR_CHARS) };
}
