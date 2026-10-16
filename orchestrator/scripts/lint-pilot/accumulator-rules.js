// Advisory lint pilot: two accumulator-copy checks ported to the existing ESLint
// rule API so they can be evaluated without adding a linter or dependency.
// Not wired into `lint` or `lint:static`; see docs/orchestrator/lint-pilot-accumulator.md.
//
// Provenance (both MIT; notices reproduced at the end of this file):
// - "reduce-accumulator-copy" ports anti-slop `no-reduce-accumulator-copy`
//   and `src/shared/array-method.ts` at dmmulroy/anti-slop@c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b.
//   TypeScript-only paths (type annotations, TS wrapper nodes) are dropped:
//   the pilot scope has no TS sources.
// - "accumulating-spread" ports oxc `oxc/no-accumulating-spread`
//   (crates/oxc_linter/src/rules/oxc/no_accumulating_spread.rs) at
//   oxc-project/oxc@29caafd7bcc2630274c204892f6fa9a085a1317f, including its quirks:
//   reduce callbacks must declare exactly two parameters, and loop detection only
//   inspects the first non-initializer write to a `let` binding.

"use strict";

const PROVENANCE = Object.freeze({
  "reduce-accumulator-copy": {
    upstream: "dmmulroy/anti-slop",
    rule: "no-reduce-accumulator-copy",
    revision: "c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b",
    license: "MIT",
  },
  "accumulating-spread": {
    upstream: "oxc-project/oxc",
    rule: "oxc/no-accumulating-spread",
    revision: "29caafd7bcc2630274c204892f6fa9a085a1317f",
    license: "MIT",
  },
});

function unwrap(node) {
  while (node && node.type === "ChainExpression") node = node.expression;
  return node;
}

function resolveBinding(sourceCode, node) {
  node = unwrap(node);
  if (!node || node.type !== "Identifier") return null;
  let scope = sourceCode.getScope(node);
  while (scope) {
    const variable = scope.set.get(node.name);
    if (variable) return variable;
    scope = scope.upper;
  }
  return null;
}

function methodTarget(node) {
  node = unwrap(node);
  if (!node || node.type !== "MemberExpression") return null;
  const property = node.property;
  if (!node.computed && property.type === "Identifier") return { name: property.name, object: node.object };
  if (node.computed && property.type === "Literal" && typeof property.value === "string") {
    return { name: property.value, object: node.object };
  }
  return null;
}

function hasReassignment(variable) {
  return variable.references.some((reference) => reference.isWrite() && !reference.init);
}

function constInit(variable) {
  for (const def of variable.defs) {
    if (
      def.type === "Variable" && def.node.type === "VariableDeclarator" &&
      def.node.id.type === "Identifier" && def.node.init !== null &&
      def.parent && def.parent.kind === "const"
    ) {
      return def.node.init;
    }
  }
  return null;
}

const ARRAY_PRODUCING = ["map", "filter", "flatMap", "slice", "concat", "toSorted", "toReversed", "toSpliced"];

function isKnownArray(sourceCode, node, visited = new Set()) {
  node = unwrap(node);
  if (node.type === "ArrayExpression") return true;
  if (node.type === "CallExpression") {
    const method = methodTarget(node.callee);
    return method !== null && ARRAY_PRODUCING.includes(method.name) && isKnownArray(sourceCode, method.object, visited);
  }
  if (node.type !== "Identifier") return false;
  const variable = resolveBinding(sourceCode, node);
  if (variable === null || visited.has(variable)) return false;
  visited.add(variable);
  if (hasReassignment(variable)) return false;
  const init = constInit(variable);
  return init !== null && isKnownArray(sourceCode, init, visited);
}

function enclosingReducer(node) {
  let parent = node.parent;
  while (parent) {
    if (parent.type === "FunctionDeclaration") return null;
    if (parent.type === "ArrowFunctionExpression" || parent.type === "FunctionExpression") {
      const callback = parent;
      const owner = callback.parent;
      if (!owner || owner.type !== "CallExpression") return null;
      const method = methodTarget(owner.callee);
      const first = owner.arguments[0];
      if (
        method === null || (method.name !== "reduce" && method.name !== "reduceRight") ||
        owner.arguments.length > 2 || first === undefined || unwrap(first) !== callback
      ) return null;
      const param = callback.params[0];
      const accumulator = param && param.type === "AssignmentPattern" ? param.left : param;
      if (!accumulator || accumulator.type !== "Identifier") return null;
      return { callback, accumulator, initialValue: owner.arguments[1] };
    }
    parent = parent.parent;
  }
  return null;
}

function referencesAccumulator(sourceCode, node, accumulator, visited = new Set()) {
  const variable = resolveBinding(sourceCode, node);
  if (variable === null || visited.has(variable)) return false;
  if (variable === accumulator) return true;
  visited.add(variable);
  if (hasReassignment(variable)) return false;
  const init = constInit(variable);
  return init !== null && referencesAccumulator(sourceCode, init, accumulator, visited);
}

function isGlobalOwner(sourceCode, node, name) {
  node = unwrap(node);
  if (node.type !== "Identifier" || node.name !== name) return false;
  const variable = resolveBinding(sourceCode, node);
  return variable === null || variable.defs.length === 0;
}

const reduceAccumulatorCopy = {
  meta: {
    type: "problem",
    docs: { description: "Disallow copying growing reducer accumulators with Object.assign, Array.from, or array copy methods." },
    schema: [],
    messages: {
      accumulatorCopy: "Reducer accumulator is copied on every iteration; growing copies can cause quadratic work.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    return {
      CallExpression(node) {
        const method = methodTarget(node.callee);
        if (method === null) return;
        const reducer = enclosingReducer(node);
        if (reducer === null) return;
        const accumulator = sourceCode.getDeclaredVariables(reducer.callback)
          .find((variable) => variable.identifiers.includes(reducer.accumulator));
        if (!accumulator) return;
        const isAccumulator = (expression) => referencesAccumulator(sourceCode, expression, accumulator);
        let copies = false;
        if (method.name === "assign" && isGlobalOwner(sourceCode, method.object, "Object")) {
          const target = node.arguments[0];
          copies = target !== undefined && unwrap(target).type === "ObjectExpression" &&
            node.arguments.slice(1).some(isAccumulator);
        } else if (method.name === "from" && isGlobalOwner(sourceCode, method.object, "Array")) {
          const source = node.arguments[0];
          copies = source !== undefined && isAccumulator(source);
        } else if (["concat", "slice", "toSpliced", "toSorted", "toReversed", "with"].includes(method.name)) {
          const initial = reducer.initialValue;
          copies = initial !== undefined && isKnownArray(sourceCode, initial) && isAccumulator(method.object);
        }
        if (copies) context.report({ node, messageId: "accumulatorCopy" });
      },
    };
  },
};

function isFunction(node) {
  return node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression" || node.type === "FunctionDeclaration";
}

function isLoop(node) {
  return ["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"].includes(node.type);
}

function contains(outer, inner) {
  return outer.range[0] <= inner.range[0] && inner.range[1] <= outer.range[1];
}

function checkReduceUsage(context, variable, spread) {
  const def = variable.defs[0];
  if (!def || def.type !== "Parameter") return false;
  const fn = def.node;
  const first = fn.params[0];
  const firstId = first && first.type === "AssignmentPattern" ? first.left : first;
  if (!firstId || firstId.type !== "Identifier" || !variable.identifiers.includes(firstId)) return false;
  if (fn.params.length !== 2) return false;
  for (let node = spread.parent; node && node !== fn; node = node.parent) {
    if (isFunction(node)) return false;
  }
  for (let node = fn.parent; node; node = node.parent) {
    if (node.type !== "CallExpression") continue;
    const method = methodTarget(node.callee);
    if (method && (method.name === "reduce" || method.name === "reduceRight") &&
      node.arguments.length >= 1 && node.arguments.length <= 2) {
      context.report({ node: spread, messageId: "reduceSpread" });
      return true;
    }
  }
  return false;
}

function checkLoopUsage(context, variable, spread) {
  const def = variable.defs[0];
  if (!def || def.type !== "Variable" || def.parent.kind !== "let") return;
  const write = variable.references.find((reference) => reference.isWrite() && !reference.init);
  if (!write) return;
  const assignment = write.identifier.parent;
  if (assignment.type !== "AssignmentExpression" || assignment.left !== write.identifier) return;
  const right = assignment.right;
  if ((right.type !== "ArrayExpression" && right.type !== "ObjectExpression") || !contains(right, spread)) return;
  for (let node = spread.parent; node; node = node.parent) {
    if (isLoop(node) && !contains(node, def.parent) && contains(node, spread)) {
      context.report({ node: spread, messageId: "loopSpread" });
      return;
    }
  }
}

const accumulatingSpread = {
  meta: {
    type: "problem",
    docs: { description: "Disallow spreading reduce accumulators or loop-reassigned bindings into a new array/object." },
    schema: [],
    messages: {
      reduceSpread: "Spreading the reduce accumulator copies it on every iteration; this can cause quadratic work.",
      loopSpread: "Spreading a loop-reassigned binding copies it on every iteration; this can cause quadratic work.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    return {
      SpreadElement(spread) {
        if (spread.argument.type !== "Identifier") return;
        const variable = resolveBinding(sourceCode, spread.argument);
        if (variable === null || variable.defs.length === 0) return;
        if (checkReduceUsage(context, variable, spread)) return;
        checkLoopUsage(context, variable, spread);
      },
    };
  },
};

const plugin = {
  meta: { name: "lint-pilot" },
  rules: {
    "reduce-accumulator-copy": reduceAccumulatorCopy,
    "accumulating-spread": accumulatingSpread,
  },
};

module.exports = { plugin, PROVENANCE };

/*
 * anti-slop — MIT License
 * Copyright (c) 2026 Dillon Mulroy
 *
 * oxc — MIT License
 * Copyright (c) 2024-present VoidZero Inc. & Contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
