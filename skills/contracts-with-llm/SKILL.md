---
name: contracts-with-llm
description: "When the user provides a contract, scope, or requirements to implement: converse about the solution, explore other scenarios, offer 2–3 alternatives per contract point (explicitly stating what is NOT in the contract), then summarize the conversation and contract changes and implement. Use when user gives a 'contrato', scope document, requirements list, or asks to work from a defined contract before implementing."
---

# Contracts with LLM

When the user gives you a **contract** (alcance, scope, requisitos, documento de acuerdos), don’t go straight to implementation. Use this collaborative flow: converse, explore, offer alternatives with clear boundaries, summarize, then implement.

## What “contract” means here

- A written scope or requirements document (contrato, alcance, spec, requirements).
- A list of agreed points or deliverables.
- Any “this is what we’re building” definition the user explicitly shares.

## Workflow

```
1. Read and acknowledge the contract
         ↓
2. Converse about the solution (clarify, ask, reflect)
         ↓
3. Explore other scenarios (what if X, edge cases, variants)
         ↓
4. For relevant contract points: offer 2–3 alternatives
   → Always state clearly what is NOT in the contract (fuera de alcance)
         ↓
5. Summarize: conversation + contract changes (acordados / modificados)
         ↓
6. Implement only after summary is confirmed (or user says “implementa”)
```

## Steps in detail

### 1. Acknowledge the contract

- Restate in your own words: scope, main deliverables, and any hard constraints.
- Ask one or two short clarification questions if something is ambiguous.
- Don’t assume; align on what “done” means for this contract.

### 2. Converse about the solution

- Discuss approach, trade-offs, and options at a high level.
- Use natural back-and-forth: “Otra forma de verlo sería…”, “Si priorizamos X, entonces…”.
- Don’t jump to code or tasks until the user has had a chance to steer.

### 3. Explore other scenarios

- “¿Qué pasa si…?” (escenarios alternativos, edge cases).
- Walk through one or two variants that might affect the contract (performance, seguridad, otro stack, etc.).
- Keep it concise; the goal is to surface options, not to redesign everything.

### 4. Offer 2–3 alternatives per contract point (when useful)

- For each contract point where it makes sense, suggest 2–3 concrete alternatives (diseño, tecnología, orden de implementación, etc.).
- **Mandatory**: For every alternative, state explicitly what is **not** in the current contract (e.g. “Esto no está en el contrato: …”, “Fuera de alcance actual: …”).
- Let the user choose or combine; don’t decide by default.

### 5. Summarize before implementing

Produce a short summary that includes:

- **Resumen de la conversación**: main decisions, open questions, and any assumptions.
- **Cambios al contrato**: what was added, removed, or refined compared to the original contract.
- **Siguiente paso**: what you will implement (or the next concrete action).

Only after the user confirms this summary (or says to go ahead) should you move to implementation.

### 6. Implement

- Implement according to the **updated** contract and the agreed summary.
- If you discover something that would change the contract again, say it clearly and suggest a small update to the summary/contract before continuing.

## Out of scope / not in the contract

- Whenever you suggest an alternative or an improvement, label clearly:
  - “**En el contrato:** …”
  - “**No está en el contrato / fuera de alcance:** …”
- This keeps scope creep visible and lets the user decide whether to expand the contract.

## Default behavior (when to use this skill)

Use this flow when:

- The user says they have a “contrato”, “alcance”, “scope”, or “requisitos” and want to implement.
- The user pastes or references a requirements/spec document and says “implementa” or “trabajamos con esto”.
- The user asks to “conversar la solución” or “explorar alternativas” before coding.
- The user wants a summary of the conversation and contract changes before you implement.

You can still do quick, direct implementation when the user explicitly says “sin contrato” or “implementa ya sin explorar”.
