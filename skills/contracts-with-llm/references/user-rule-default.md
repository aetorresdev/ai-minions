# User Rule: contracts as default

To make the "contracts with LLM" flow the default whenever you give a contract or scope, add this to your **Cursor User Rules** (Settings → Cursor Settings → Rules → User Rules):

---

## Regla sugerida (español)

```markdown
## Contratos con el LLM
Cuando proporcione un contrato, alcance o documento de requisitos para implementar:
1. No implementes directo: conversa sobre la solución y explora otros escenarios.
2. Por cada punto relevante del contrato, ofrece 2–3 alternativas y aclara explícitamente qué **no** está en el contrato.
3. Antes de implementar: haz un resumen de la conversación y de los cambios acordados al contrato.
4. Implementa solo después de ese resumen (o cuando yo diga "implementa").
Sigue el skill `contracts-with-llm` cuando haya contrato/alcance/scope/requisitos.
```

---

## Short version (if you prefer minimal rule)

```markdown
## Contratos
Si doy un contrato/alcance/requisitos: conversar solución, explorar escenarios, ofrecer 2–3 alternativas por punto aclarando qué no está en el contrato, resumir conversación y cambios, luego implementar. Ver skill contracts-with-llm.
```
