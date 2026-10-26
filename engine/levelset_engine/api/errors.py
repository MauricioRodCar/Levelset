"""RFC 9457 problem responses with a stable machine `code` the UI translates."""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

PROBLEM = "application/problem+json"

STATUS_CODES = {400: "bad_request", 401: "unauthorized", 403: "forbidden", 404: "not_found",
                405: "method_not_allowed", 409: "conflict", 422: "validation_error", 500: "internal_error",
                502: "skill_failed", 503: "unavailable"}


class ApiError(Exception):
    def __init__(self, status: int, code: str, title: str, detail: str | None = None) -> None:
        super().__init__(title)
        self.status, self.code, self.title, self.detail = status, code, title, detail


def problem(status: int, code: str, title: str, detail: str | None = None,
            headers: dict[str, str] | None = None) -> JSONResponse:
    body: dict[str, Any] = {"title": title, "code": code}
    if detail:
        body["detail"] = detail
    return JSONResponse(body, status_code=status, media_type=PROBLEM, headers=headers)


def install(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        headers = {"WWW-Authenticate": "Bearer"} if exc.status == 401 else None
        return problem(exc.status, exc.code, exc.title, exc.detail, headers)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        parts = []
        for e in exc.errors():
            loc = ".".join(str(x) for x in e.get("loc", ()) if x != "body")
            parts.append("%s: %s" % (loc, e.get("msg")) if loc else str(e.get("msg")))
        return problem(422, "validation_error", "Invalid request", "; ".join(parts))

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = STATUS_CODES.get(exc.status_code, "error")
        return problem(exc.status_code, code, str(exc.detail) if exc.detail else code)

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        return problem(500, "internal_error", "Internal error", str(exc))
