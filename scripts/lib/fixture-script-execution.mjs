/**
 * Load-time execution check for HTML fixture artifacts.
 *
 * The structural checks in canonical-real-task-fixtures-data.mjs only look at the source text, so an app
 * that throws while loading (and therefore never renders its board) still passes them. This module runs
 * the inline <script> blocks against a tolerant DOM stub and fails on any uncaught exception.
 *
 * The artifact is model-generated, so it never runs in the calling process: it is executed in a child
 * Node process started with the permission model (`--permission`, no fs write/child_process/worker/net
 * grants) and a hard timeout. This is a smoke check for "does not crash on load", not a browser test.
 *
 * Limits: Node 22's permission model does not restrict network access, so the child gets an empty
 * environment (no tokens) and no readable filesystem; it is not a substitute for a real browser sandbox.
 */
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

/** Runs inside the child process. Reads `{ scripts, timeoutMs }` from stdin, prints one JSON line. */
const CHILD_RUNNER = String.raw`
const vm = require("node:vm");
const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  const { scripts, timeoutMs } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
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
  if (result.ok) {
    const handlers = [
      ...(listeners.document.DOMContentLoaded || []),
      ...(listeners.window.DOMContentLoaded || []),
      ...(listeners.window.load || []),
    ];
    for (const h of handlers) {
      try { h({}); } catch (e) { fail("init", e); break; }
    }
  }
  process.stdout.write(JSON.stringify(result) + "\n");
  process.exit(0);
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
  const child = spawnSync(
    process.execPath,
    ["--permission", "-e", CHILD_RUNNER],
    {
      input: JSON.stringify({ scripts, timeoutMs: options.timeoutMs ?? EXEC_TIMEOUT_MS }),
      encoding: "utf8",
      timeout: CHILD_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      env: { PATH: process.env.PATH ?? "" },
    },
  );
  if (child.error) {
    return { ok: false, phase: "spawn", error: `script execution unavailable: ${child.error.message}`.slice(0, MAX_ERROR_CHARS) };
  }
  const lastLine = String(child.stdout ?? "").trim().split("\n").pop() ?? "";
  try {
    const parsed = JSON.parse(lastLine);
    if (parsed.ok) return { ok: true };
    return { ok: false, phase: parsed.phase, error: String(parsed.error).slice(0, MAX_ERROR_CHARS) };
  } catch {
    const detail = String(child.stderr ?? "").trim().split("\n").filter(Boolean).pop() ?? `exit ${child.status}`;
    return { ok: false, phase: "child", error: `script execution failed: ${detail}`.slice(0, MAX_ERROR_CHARS) };
  }
}
