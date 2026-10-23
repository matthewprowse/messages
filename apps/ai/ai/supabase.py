"""A small PostgREST client over keep-alive connections (ai/http.py). It uses the service role, which
bypasses row-level security, so every query in this worker scopes by user, account or thread itself."""

from __future__ import annotations

import json
import urllib.parse
from typing import Any

from .http import POOL


class SupabaseError(Exception):
    def __init__(self, status: int, code: str | None):
        super().__init__(f"supabase request failed ({status}, {code})")
        self.status = status
        self.code = code


class Supabase:
    def __init__(self, url: str, key: str):
        self.base = url.rstrip("/") + "/rest/v1"
        self.headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    def _request(
        self, method: str, path: str, params: dict[str, str] | None = None, body: Any = None, prefer: str | None = None, *, head: bool = False
    ) -> Any:
        url = f"{self.base}/{path}"
        if params:
            url += "?" + urllib.parse.urlencode(params, safe="(),.:*!")
        headers = dict(self.headers)
        if prefer:
            headers["Prefer"] = prefer
        data = json.dumps(body).encode() if body is not None else None
        res = POOL.request(method, url, data, headers, timeout=30)
        if res.status >= 400:
            code = None
            try:
                code = json.loads(res.body or b"{}").get("code")
            except (ValueError, AttributeError):
                pass
            raise SupabaseError(res.status, code)
        if head:
            return res.headers.get("content-range")
        return json.loads(res.body) if res.body else None

    def select(self, table: str, params: dict[str, str]) -> list[dict[str, Any]]:
        return self._request("GET", table, params) or []

    def first(self, table: str, params: dict[str, str]) -> dict[str, Any] | None:
        rows = self.select(table, {**params, "limit": "1"})
        return rows[0] if rows else None

    def insert(self, table: str, rows: dict[str, Any] | list[dict[str, Any]]) -> list[dict[str, Any]]:
        return self._request("POST", table, body=rows, prefer="return=representation") or []

    def upsert(self, table: str, rows: dict[str, Any] | list[dict[str, Any]], on_conflict: str) -> None:
        """A list is written in one request; every row must have the same keys."""
        self._request("POST", table, {"on_conflict": on_conflict}, rows, prefer="resolution=merge-duplicates,return=minimal")

    def insert_new(self, table: str, row: dict[str, Any], on_conflict: str) -> list[dict[str, Any]]:
        """Inserts row unless one with the same on_conflict columns exists. Returns it only when inserted."""
        return self._request("POST", table, {"on_conflict": on_conflict}, row, prefer="resolution=ignore-duplicates,return=representation") or []

    def delete(self, table: str, filters: dict[str, str]) -> None:
        self._request("DELETE", table, filters, prefer="return=minimal")

    def update(self, table: str, filters: dict[str, str], patch: dict[str, Any], *, minimal: bool = False) -> list[dict[str, Any]]:
        """minimal skips sending the changed rows back, for wide rows such as messages with an embedding."""
        prefer = "return=minimal" if minimal else "return=representation"
        return self._request("PATCH", table, filters, patch, prefer=prefer) or []

    def count(self, table: str, params: dict[str, str]) -> int:
        """Exact row count without fetching rows, from the Content-Range header ("*/24" or "0-0/24")."""
        header = self._request("HEAD", table, {"select": "id", **params}, prefer="count=exact", head=True) or ""
        total = header.rsplit("/", 1)[-1]
        return int(total) if total.isdigit() else 0

    def rpc(self, function: str, args: dict[str, Any]) -> Any:
        return self._request("POST", f"rpc/{function}", body=args)


def missing_relation(err: Exception) -> bool:
    """A table, column or function this code expects but the database does not have yet: a migration
    that has not been applied."""
    return isinstance(err, SupabaseError) and (err.code in ("PGRST202", "PGRST204", "PGRST205", "42P01", "42703") or err.status == 404)


def in_list(values: list[str]) -> str:
    """PostgREST in.(...) filter. Values here are UUIDs or addresses, quoted to be safe."""
    return "in.(" + ",".join('"' + v.replace('"', "") + '"' for v in values) + ")"
