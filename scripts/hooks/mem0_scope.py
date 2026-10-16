"""
Mem0 / OpenMemory advisory-retrieval scope for host hooks.

Identity and project scope come only from explicit, documented environment
configuration (see docs/orchestrator/memory-store-decision.md, "Mem0 hook
identity and scope"). There is no built-in user id and no global fallback.

OpenMemory REST facts this module relies on (self-hosted OpenMemory API):
- ``user_id`` is a caller-supplied string. The API has no authentication, so a
  user id is a namespace selector, not an authorization boundary.
- ``POST /api/v1/memories/filter`` scopes rows server-side by ``user_id`` and
  returns ``app_name`` per row. ``app_name`` is the MCP client name used at
  write time (``/mcp/<client_name>/sse/<user_id>``); it is the project scope.
- Some Mem0 builds expose ``POST /api/v1/memories/search/``; the self-hosted
  OpenMemory API does not. Both paths go through the same client-side scope
  validation before anything is injected.

Consequences:
- Shared backends cannot be isolated by this hook, so ``shared`` mode and
  non-loopback URLs are blocked for retrieval (fail closed).
- Rows without a matching project scope (legacy/unscoped/foreign) are dropped.
- Rows without a backend-reported string owner equal to the identity are
  dropped. The self-hosted ``/filter`` response has no per-row owner, so that
  path ends ``blocked:owner_unverifiable`` instead of injecting anything.
- Retrieved text is untrusted data; rows that read like directives to change
  policy, gates, roles or permissions are withheld.
"""
from __future__ import annotations

import ipaddress
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field

USER_ID_ENV = "AI_MINIONS_MEM0_USER_ID"
PROJECT_ENV = "AI_MINIONS_MEM0_PROJECT"
URL_ENV = "AI_MINIONS_MEM0_URL"
MODE_ENV = "AI_MINIONS_MEM0_MODE"
TIMEOUT_ENV = "AI_MINIONS_MEM0_TIMEOUT_S"

DEFAULT_URL = "http://localhost:8765"
DEFAULT_MODE = "local"
DEFAULT_TIMEOUT_S = 4.0
MAX_RESULTS = 5
MAX_PROMPT_CHARS = 500
MAX_RECORD_CHARS = 400
FILTER_PAGE_SIZE = 100

# Stable, non-secret slug: no spaces, no path separators, no e-mail '@'.
SCOPE_TOKEN_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")

OUTCOME_OK = "ok"
OUTCOME_EMPTY = "empty"
OUTCOME_BLOCKED = "blocked"
OUTCOME_UNAVAILABLE = "unavailable"
OUTCOME_DISABLED = "disabled"

# Retrieved memory must never act as an instruction channel. These patterns
# cover attempts to change policy, gates, roles, activation or permissions.
DIRECTIVE_PATTERNS = [
    re.compile(p, re.IGNORECASE | re.MULTILINE)
    for p in (
        r"\bignore\b.{0,40}\b(rules?|instructions?|polic(y|ies)|gates?|contracts?)\b",
        (
            r"\b(skip|bypass|disable|override|waive|turn\s+off)\b.{0,40}"
            r"\b(gates?|cerberus|qa|review|validation|polic(y|ies)|hooks?|checks?|permissions?)\b"
        ),
        r"\b(grant|elevate|escalate|allow)\b.{0,40}\b(permissions?|privileges?|access|sudo|root)\b",
        (
            r"\b(you\s+are\s+now|act\s+as|switch\s+to|advance\s+to)\b.{0,30}"
            r"\b(orchestrator|owner|architect|dev|qa|cerberus|admin|system)\b"
        ),
        r"^\s*(system|assistant)\s*:",
        r"\bMODE\s*:\s*[A-Z]+",
        r"\bAI_MINIONS_[A-Z_]+\s*=",
        r"\b(authoritative|source\s+of\s+truth)\b",
        r"\b(approve|auto-?approve)\b.{0,30}\b(merge|pr|release|deploy)\b",
        r"\bdangerously\b|--no-verify|bypassPermissions",
    )
]

_CONTROL_RE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
_WS_RE = re.compile(r"\s+")


@dataclass(frozen=True)
class ScopeConfig:
    user_id: str
    project: str
    base_url: str
    timeout_s: float


@dataclass
class RetrievalResult:
    outcome: str
    reason: str
    records: list[str] = field(default_factory=list)
    counts: dict[str, int] = field(default_factory=dict)

    def diagnostic(self) -> str:
        """Privacy-safe one-liner: codes and counts only, never ids or content."""
        parts = [f"outcome={self.outcome}", f"reason={self.reason}"]
        for key in sorted(self.counts):
            parts.append(f"{key}={self.counts[key]}")
        return "mem0-search: " + " ".join(parts)


class ScopeError(Exception):
    def __init__(self, outcome: str, reason: str):
        super().__init__(reason)
        self.outcome = outcome
        self.reason = reason


def _is_loopback_host(host: str | None) -> bool:
    if not host:
        return False
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def resolve_scope(env: dict) -> ScopeConfig:
    """Resolve explicit identity + project scope or raise ScopeError (fail closed)."""
    raw_user = str(env.get(USER_ID_ENV, "") or "").strip()
    raw_project = str(env.get(PROJECT_ENV, "") or "").strip()
    raw_mode = str(env.get(MODE_ENV, "") or "").strip().lower() or DEFAULT_MODE
    raw_url = str(env.get(URL_ENV, "") or "").strip() or DEFAULT_URL

    if not raw_user and not raw_project and not env.get(URL_ENV) and not env.get(MODE_ENV):
        raise ScopeError(OUTCOME_DISABLED, "not_configured")
    if raw_mode == "shared":
        raise ScopeError(OUTCOME_BLOCKED, "shared_backend_unsupported")
    if raw_mode != "local":
        raise ScopeError(OUTCOME_BLOCKED, "invalid_mode")
    if not raw_user:
        raise ScopeError(OUTCOME_BLOCKED, "missing_user_id")
    if not SCOPE_TOKEN_RE.match(raw_user):
        raise ScopeError(OUTCOME_BLOCKED, "invalid_user_id")
    if not raw_project:
        raise ScopeError(OUTCOME_BLOCKED, "missing_project_scope")
    if not SCOPE_TOKEN_RE.match(raw_project):
        raise ScopeError(OUTCOME_BLOCKED, "invalid_project_scope")

    try:
        parsed = urllib.parse.urlparse(raw_url)
        host = parsed.hostname
        _ = parsed.port  # raises ValueError on a malformed port
    except ValueError:
        raise ScopeError(OUTCOME_BLOCKED, "invalid_url") from None
    if parsed.scheme not in ("http", "https") or not host:
        raise ScopeError(OUTCOME_BLOCKED, "invalid_url")
    if "@" in parsed.netloc or parsed.username or parsed.password:
        raise ScopeError(OUTCOME_BLOCKED, "invalid_url")
    if parsed.path not in ("", "/") or parsed.query or parsed.fragment or parsed.params:
        raise ScopeError(OUTCOME_BLOCKED, "invalid_url")
    if not _is_loopback_host(host):
        # A non-loopback backend is a shared backend from this hook's view.
        raise ScopeError(OUTCOME_BLOCKED, "shared_backend_unsupported")

    timeout = DEFAULT_TIMEOUT_S
    raw_timeout = str(env.get(TIMEOUT_ENV, "") or "").strip()
    if raw_timeout:
        try:
            timeout = float(raw_timeout)
        except ValueError:
            raise ScopeError(OUTCOME_BLOCKED, "invalid_timeout") from None
        if not 0 < timeout <= 30:
            raise ScopeError(OUTCOME_BLOCKED, "invalid_timeout")

    return ScopeConfig(
        user_id=raw_user,
        project=raw_project,
        base_url=raw_url.rstrip("/"),
        timeout_s=timeout,
    )


class _BackendError(Exception):
    def __init__(self, reason: str, status: int | None = None):
        super().__init__(reason)
        self.reason = reason
        self.status = status


def _post_json(cfg: ScopeConfig, path: str, body: dict) -> dict:
    req = urllib.request.Request(
        f"{cfg.base_url}{path}",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=cfg.timeout_s) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as exc:
        raise _BackendError("http_error", exc.code) from None
    except TimeoutError:
        raise _BackendError("timeout") from None
    except urllib.error.URLError as exc:
        if isinstance(exc.reason, TimeoutError):
            raise _BackendError("timeout") from None
        raise _BackendError("unreachable") from None
    except OSError:
        raise _BackendError("unreachable") from None
    try:
        data = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise _BackendError("bad_response") from None
    if not isinstance(data, dict):
        raise _BackendError("bad_response")
    return data


def _record_project(rec: dict) -> str | None:
    """Project scope a row was written under (OpenMemory app / MCP client name)."""
    app = rec.get("app_name")
    if isinstance(app, str) and app.strip():
        return app.strip()
    meta = rec.get("metadata_") or rec.get("metadata") or {}
    if isinstance(meta, dict):
        for key in ("mcp_client", "app_name", "project"):
            val = meta.get(key)
            if isinstance(val, str) and val.strip():
                return val.strip()
    return None


def _record_user(rec: dict) -> str | None:
    """Owner the backend reported for this row, or None when unverifiable.

    Missing, empty, whitespace-only and non-string values (e.g. numbers) are
    unverifiable. The hook never fills in its own identity for a row.
    """
    val = rec.get("user_id")
    if isinstance(val, str) and val.strip():
        return val.strip()
    return None


def _record_text(rec: dict) -> str:
    for key in ("content", "memory", "text"):
        val = rec.get(key)
        if isinstance(val, str) and val.strip():
            return val
    return ""


def is_directive(text: str) -> bool:
    return any(p.search(text) for p in DIRECTIVE_PATTERNS)


def neutralize(text: str) -> str:
    """Single line, no control chars, bounded length — cannot forge headers."""
    flat = _WS_RE.sub(" ", _CONTROL_RE.sub(" ", text)).strip()
    if len(flat) > MAX_RECORD_CHARS:
        flat = flat[: MAX_RECORD_CHARS - 3].rstrip() + "..."
    return flat


def scope_records(cfg: ScopeConfig, rows: list) -> tuple[list[dict], dict[str, int]]:
    """Keep only rows proven to belong to cfg.user_id and cfg.project."""
    kept: list[dict] = []
    counts = {
        "dropped_foreign": 0,
        "dropped_unscoped": 0,
        "dropped_unverified": 0,
        "withheld_directive": 0,
    }
    for rec in rows:
        if not isinstance(rec, dict):
            counts["dropped_unverified"] += 1
            continue
        user = _record_user(rec)
        if user is None:
            # Ownership must be asserted by the backend on every row.
            counts["dropped_unverified"] += 1
            continue
        if user != cfg.user_id:
            counts["dropped_foreign"] += 1
            continue
        project = _record_project(rec)
        if project is None:
            counts["dropped_unscoped"] += 1
            continue
        if project != cfg.project:
            counts["dropped_foreign"] += 1
            continue
        text = _record_text(rec)
        if not text.strip():
            continue
        if is_directive(text):
            counts["withheld_directive"] += 1
            continue
        kept.append(rec)
    return kept, counts


def _merge_counts(into: dict[str, int], more: dict[str, int]) -> None:
    for key, val in more.items():
        into[key] = into.get(key, 0) + val


def _keyword_rank(query: str, rows: list[dict]) -> list[dict]:
    words = {w for w in query.lower().split() if len(w) > 2}
    scored = []
    for idx, rec in enumerate(rows):
        content = _record_text(rec).lower()
        score = sum(1 for w in words if w in content)
        if score > 0:
            scored.append((-score, idx, rec))
    scored.sort()
    return [rec for _, _, rec in scored[:MAX_RESULTS]]


def _render(rows: list[dict]) -> list[str]:
    lines = []
    for rec in rows:
        text = neutralize(_record_text(rec))
        if not text:
            continue
        mem_id = rec.get("id") or rec.get("memory_id")
        mem_id = str(mem_id) if mem_id else ""
        prefix = f"[mem0:{mem_id}] " if mem_id and SCOPE_TOKEN_RE.match(mem_id) else ""
        lines.append(f"- {prefix}{text}")
    return lines


def retrieve(cfg: ScopeConfig, query: str) -> RetrievalResult:
    """Search, then filter fallback; both paths apply the same scope validation."""
    query = query[:MAX_PROMPT_CHARS]
    counts: dict[str, int] = {}

    search_failure: str | None = None
    try:
        data = _post_json(
            cfg,
            "/api/v1/memories/search/",
            {
                "user_id": cfg.user_id,
                "text": query,
                "limit": MAX_RESULTS,
                "filters": {"app_name": cfg.project},
            },
        )
        rows = data.get("results")
        if not isinstance(rows, list):
            raise _BackendError("bad_response")
        kept, c = scope_records(cfg, rows)
        _merge_counts(counts, c)
        if kept:
            lines = _render(kept[:MAX_RESULTS])
            return RetrievalResult(OUTCOME_OK, "search", lines, counts)
    except _BackendError as exc:
        # 404/405: endpoint not provided by this OpenMemory build; any other
        # failure is still recoverable through the scoped filter path.
        search_failure = exc.reason

    try:
        data = _post_json(
            cfg,
            "/api/v1/memories/filter",
            {"user_id": cfg.user_id, "page": 1, "size": FILTER_PAGE_SIZE},
        )
    except _BackendError as exc:
        if exc.status == 404:
            # OpenMemory answers 404 "User not found" for an identity with no rows.
            return RetrievalResult(OUTCOME_UNAVAILABLE, "identity_not_found", [], counts)
        reason = exc.reason
        if search_failure == "timeout" and reason != "timeout":
            reason = f"{reason}_after_search_timeout"
        return RetrievalResult(OUTCOME_UNAVAILABLE, reason, [], counts)

    rows = data.get("items")
    if not isinstance(rows, list):
        return RetrievalResult(OUTCOME_UNAVAILABLE, "bad_response", [], counts)
    kept, c = scope_records(cfg, rows)
    _merge_counts(counts, c)
    if not kept and c["dropped_unverified"]:
        # The self-hosted OpenMemory /filter response carries no per-row owner,
        # so rows cannot be attributed to this identity: block, do not inject.
        return RetrievalResult(OUTCOME_BLOCKED, "owner_unverifiable", [], counts)
    ranked = _keyword_rank(query, kept)
    lines = _render(ranked)
    if lines:
        return RetrievalResult(OUTCOME_OK, "filter", lines, counts)
    return RetrievalResult(OUTCOME_EMPTY, "no_scoped_match", [], counts)


def run(env: dict, query: str) -> RetrievalResult:
    try:
        cfg = resolve_scope(env)
    except ScopeError as exc:
        return RetrievalResult(exc.outcome, exc.reason)
    return retrieve(cfg, query)


def _cli_validated_url(argv: list[str]) -> int:
    """``python3 -I mem0_scope.py validated-url``: print base URL or exit 1."""
    import os

    if argv[1:] != ["validated-url"]:
        return 2
    try:
        cfg = resolve_scope(dict(os.environ))
    except ScopeError:
        return 1
    print(cfg.base_url)
    return 0


if __name__ == "__main__":
    import sys

    sys.exit(_cli_validated_url(sys.argv))
