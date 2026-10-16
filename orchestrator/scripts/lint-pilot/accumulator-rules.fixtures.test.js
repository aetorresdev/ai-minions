"use strict";

// Fixtures for the advisory accumulator lint pilot. Upstream fixtures that are
// JavaScript-expressible are kept; TypeScript-only cases are omitted.

const { describe, it } = require("node:test");
const { RuleTester } = require("eslint");
const { plugin } = require("./accumulator-rules");

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2023, sourceType: "script" } });

const copy = { messageId: "accumulatorCopy" };
const reduceSpread = { messageId: "reduceSpread" };
const loopSpread = { messageId: "loopSpread" };

tester.run("reduce-accumulator-copy", plugin.rules["reduce-accumulator-copy"], {
  valid: [
    // Fresh local mutation of the owned accumulator.
    "items.reduce((acc, item) => { acc.push(item); return acc; }, []);",
    "items.reduce((acc, item) => Object.assign(acc, item), {});",
    "items.reduce((acc, item) => Object.assign(acc, acc, item), {});",
    // Copying an individual item, not the accumulator.
    "items.reduce((acc, item) => { acc[item.id] = { ...item }; return acc; }, {});",
    "items.reduce((acc, item) => { acc.push(Object.assign({}, item)); return acc; }, []);",
    "items.reduce((acc, item) => { acc.push(item.slice()); return acc; }, []);",
    // Non-array or unknown accumulators (strings, custom collections).
    "items.reduce((acc, item) => acc.concat(item), '');",
    "items.reduce((acc, item) => acc.concat(item), customCollection);",
    // Not a reducer callback, or the copy happens in a nested helper.
    "function copy(acc) { return Object.assign({}, acc); }",
    "items.map((acc, item) => Object.assign({}, acc));",
    "items.reduce((acc, item) => { function copy(acc) { return Object.assign({}, acc); } return acc; }, {});",
    "items.reduce((acc, item) => { const snapshot = () => Object.assign({}, acc); return acc; }, {});",
    // Shadowed accumulator and shadowed globals.
    "items.reduce((acc, item) => { { const acc = {}; Object.assign({}, acc); } return acc; }, {});",
    "const Object = custom; items.reduce((acc, item) => Object.assign({}, acc), {});",
    "function run(Object) { return items.reduce((acc, item) => Object.assign({}, acc), {}); }",
    "const Array = custom; items.reduce((acc, item) => Array.from(acc), []);",
    // Reassigned alias: ownership cannot be established, so no report.
    "items.reduce((acc, item) => { let alias = acc; alias = item; return Object.assign({}, alias); }, {});",
    // Spreads belong to the complementary rule.
    "items.reduce((acc, item) => [...acc, item], []);",
    "items.reduce((acc, item) => ({ ...acc, [item.id]: item }), {});",
    // Unsupported helper indirection is a documented blind spot.
    "const clone = (x) => Object.assign({}, x); items.reduce((acc, item) => clone(acc), {});",
  ],
  invalid: [
    { code: "items.reduce((acc, item) => Object.assign({}, acc, { [item.id]: item }), {});", errors: [copy] },
    { code: "items.reduceRight((acc, item) => Object.assign({}, acc, item), {});", errors: [copy] },
    { code: "items.reduce((acc, item, index, array) => Object.assign({}, acc, item), {});", errors: [copy] },
    { code: "items.reduce(acc => Object.assign({}, acc), {});", errors: [copy] },
    { code: "items.reduce(function (acc, item) { return Object.assign({}, item, acc); }, {});", errors: [copy] },
    { code: "items['reduce']((acc, item) => Object['assign']({}, acc, item), {});", errors: [copy] },
    { code: "items.reduce((acc = {}, item) => Object.assign({}, acc, item), {});", errors: [copy] },
    { code: "items.reduce((acc, item) => { const alias = acc; return Object.assign({}, alias, item); }, {});", errors: [copy] },
    { code: "items.reduce((acc, item) => { const next = Object.assign({}, acc); next[item.id] = item; return next; }, {});", errors: [copy] },
    { code: "items.reduce((acc, item) => acc.concat([item]), []);", errors: [copy] },
    { code: "items.reduceRight((acc, item, index) => acc['concat']([item]), []);", errors: [copy] },
    { code: "items.reduce((acc, item) => { const next = acc.slice(); next.push(item); return next; }, []);", errors: [copy] },
    { code: "items.reduce((acc, item) => { const alias = acc; return alias.concat(item); }, []);", errors: [copy] },
    { code: "const initial = []; items.reduce((acc, item) => acc.concat(item), initial);", errors: [copy] },
    { code: "items.reduce((acc, item) => { const next = Array.from(acc); next.push(item); return next; }, []);", errors: [copy] },
    { code: "items.reduce((acc, item) => acc.toSpliced(acc.length, 0, item), []);", errors: [copy] },
    { code: "items.reduce((acc, item) => acc.toSorted(), []);", errors: [copy] },
    { code: "items.reduce((acc, item) => acc.toReversed(), []);", errors: [copy] },
    { code: "items.reduce((acc, item) => acc.with(0, item), []);", errors: [copy] },
  ],
});

tester.run("accumulating-spread", plugin.rules["accumulating-spread"], {
  valid: [
    "let x = { ...a }",
    "let x = [ ...a ]",
    "[1,2,3].map(n => ({ ...obj, n }))",
    "[...a, ...b].reduce((acc, x) => { acc['foo'] = x; return acc }, {})",
    "arr.reduce((acc, x) => { acc['foo'] = x; return acc }, { ...a, ...b })",
    "arr.reduce((acc, x) => ({ ...x }), {})",
    "arr.reduce((acc, x) => ({ ...obj }), {})",
    // Copying an individual item into an owned accumulator.
    "arr.reduce((acc, x) => { acc[x] = { ...x }; return acc }, {})",
    "foo.reduce((acc, bar) => { acc.push(...bar); return acc; }, [])",
    // Upstream quirk kept: callbacks with other than two parameters, or extra reduce args.
    "foo.reduce((acc, value, index, array, extra) => [...acc, value], [])",
    "foo.reduce((acc) => [...acc], [])",
    "foo.reduce((acc, bar) => [...acc, bar], [], 123)",
    // Spread inside a nested function is not the accumulator step.
    "list.reduce((acc, each) => each.sub.flatMap((s) => [...acc, s]), [])",
    // Loops with fresh local mutation.
    "let foo = []; for (let i = 0; i < 10; i++) { foo.push(i); }",
    "let foo = {}; for (const i of [1,2,3]) { foo[i] = i; }",
    // Binding declared inside the loop body is fresh each iteration.
    "for (const x of xs) { let foo = []; foo = [...foo, x]; }",
    // const bindings cannot be reassigned.
    "const foo = []; for (const x of xs) { use([...foo, x]); }",
  ],
  invalid: [
    { code: "arr.reduce((acc, x) => ({ ...acc, [x]: x }), {})", errors: [reduceSpread] },
    { code: "arr.reduce((differentName, x) => ({ ...differentName, [x]: x }), {})", errors: [reduceSpread] },
    { code: "Object.keys(obj).reduce((acc, key) => ({ ...acc, [key]: obj[key] }), foo)", errors: [reduceSpread] },
    { code: "get_array().reduce((acc, x) => ({ ...acc, [x]: x }), {})", errors: [reduceSpread] },
    { code: "arr.reduce(function (acc, x) { return { ...acc, [x]: x } }, {})", errors: [reduceSpread] },
    { code: "arr.reduce((acc, x) => { let temp = { ...acc, x }; return temp }, {})", errors: [reduceSpread] },
    { code: "foo.reduce((acc, bar) => [...acc, bar], [])", errors: [reduceSpread] },
    { code: "foo.reduceRight((acc, bar) => [...acc, ...bar], [])", errors: [reduceSpread] },
    { code: "foo.reduce((acc = [], bar) => [...acc, bar], [])", errors: [reduceSpread] },
    { code: "let foo = []; for (let i = 0; i < 10; i++) { foo = [...foo, i]; }", errors: [loopSpread] },
    { code: "let foo = []; for (const i in [1,2,3]) { foo = [...foo, i]; }", errors: [loopSpread] },
    { code: "let foo = []; while (foo.length < 10) { foo = [...foo, foo.length]; }", errors: [loopSpread] },
    { code: "let foo = {}; for (let i of [1,2,3]) { foo = { ...foo, [i]: i }; }", errors: [loopSpread] },
    { code: "let foo = {}; do { foo = { ...foo, k: 1 }; } while (cond());", errors: [loopSpread] },
  ],
});
