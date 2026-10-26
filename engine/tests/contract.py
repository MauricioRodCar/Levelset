"""Validate engine responses against docs/api/openapi.yaml (THE contract).

validate(instance, "Ticket") checks the JSON Schema and, on top, that no object
carries a property the contract does not declare (exact shape, camelCase).
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator

SPEC_PATH = Path(__file__).resolve().parents[2] / "docs" / "api" / "openapi.yaml"


@lru_cache(maxsize=1)
def spec() -> dict[str, Any]:
    with open(SPEC_PATH, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def _resolve(schema: dict[str, Any]) -> dict[str, Any]:
    while "$ref" in schema:
        name = schema["$ref"].split("/")[-1]
        schema = spec()["components"]["schemas"][name]
    return schema


def _props(schema: dict[str, Any]) -> dict[str, Any] | None:
    schema = _resolve(schema)
    if "allOf" in schema:
        out: dict[str, Any] = {}
        for part in schema["allOf"]:
            out.update(_props(part) or {})
        return out
    return schema.get("properties")


def _no_extra(instance: Any, schema: dict[str, Any], path: str) -> None:
    schema = _resolve(schema)
    if isinstance(instance, list) and "items" in schema:
        for i, item in enumerate(instance):
            _no_extra(item, schema["items"], "%s[%d]" % (path, i))
        return
    if not isinstance(instance, dict):
        return
    props = _props(schema)
    if props is None or schema.get("additionalProperties") is True:
        return
    extra = set(instance) - set(props)
    assert not extra, "%s has properties the contract does not declare: %s" % (path or "<root>", sorted(extra))
    for k, v in instance.items():
        sub = props[k]
        if _resolve(sub).get("additionalProperties") is True:
            continue
        _no_extra(v, sub, "%s.%s" % (path, k))


def validate(instance: Any, schema_name: str | None = None, schema: dict[str, Any] | None = None) -> None:
    if schema is None:
        schema = {"$ref": "#/components/schemas/%s" % schema_name}
    root = dict(schema, components=spec()["components"])
    errors = sorted(Draft202012Validator(root).iter_errors(instance), key=lambda e: list(e.path))
    assert not errors, "; ".join("%s: %s" % ("/".join(map(str, e.path)), e.message) for e in errors[:5])
    _no_extra(instance, schema, "")


def validate_list(instance: Any, schema_name: str) -> None:
    validate(instance, schema={"type": "array", "items": {"$ref": "#/components/schemas/%s" % schema_name}})


def response_schema(path: str, method: str, status: str) -> dict[str, Any]:
    op = spec()["paths"][path][method]
    content = op["responses"][status]["content"]
    return next(iter(content.values()))["schema"]
