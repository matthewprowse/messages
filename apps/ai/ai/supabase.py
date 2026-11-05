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
        self.storage = url.rstrip("/") + "/storage/v1"
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
        if res.status >= 300:  # PostgREST answers an ambiguous embed with 300 and an error body, not rows
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

    def download(self, bucket: str, path: str, *, timeout: float = 60) -> bytes:
        """A stored file's bytes, such as a WhatsApp voice note from the private attachments bucket."""
        if ".." in path.split("/"):
            raise SupabaseError(400, None)
        url = f"{self.storage}/object/{bucket}/{urllib.parse.quote(path)}"
        headers = {k: v for k, v in self.headers.items() if k != "Content-Type"}
        res = POOL.request("GET", url, None, headers, timeout=timeout)
        if res.status >= 400:
            raise SupabaseError(res.status, None)
        return res.body

    def upload(self, bucket: str, path: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        """Stores a file in a private bucket, replacing one at the same path (a brief spoken again)."""
        url = f"{self.storage}/object/{bucket}/{urllib.parse.quote(path)}"
        headers = {**self.headers, "Content-Type": content_type, "x-upsert": "true"}
        res = POOL.request("POST", url, data, headers, timeout=60)
        if res.status >= 400:
            raise SupabaseError(res.status, None)

    def list_files(self, bucket: str, prefix: str) -> list[str]:
        """Names of the files directly inside a folder of a bucket (prefix without a trailing slash)."""
        url = f"{self.storage}/object/list/{bucket}"
        body = json.dumps({"prefix": prefix, "limit": 1000, "offset": 0}).encode()
        res = POOL.request("POST", url, body, self.headers, timeout=30)
        if res.status >= 400:
            raise SupabaseError(res.status, None)
        rows = json.loads(res.body) if res.body else []
        return [str(r["name"]) for r in rows if isinstance(r, dict) and r.get("name")]

    def remove_files(self, bucket: str, paths: list[str]) -> None:
        """Deletes files from a bucket. Paths that do not exist are not an error."""
        if not paths:
            return
        url = f"{self.storage}/object/{bucket}"
        res = POOL.request("DELETE", url, json.dumps({"prefixes": paths}).encode(), self.headers, timeout=30)
        if res.status >= 400:
            raise SupabaseError(res.status, None)


def missing_relation(err: Exception) -> bool:
    """A table, column or function this code expects but the database does not have yet: a migration
    that has not been applied."""
    return isinstance(err, SupabaseError) and (err.code in ("PGRST202", "PGRST204", "PGRST205", "42P01", "42703") or err.status == 404)


def in_list(values: list[str]) -> str:
    """PostgREST in.(...) filter. Values here are UUIDs or addresses, quoted to be safe."""
    return "in.(" + ",".join('"' + v.replace('"', "") + '"' for v in values) + ")"
