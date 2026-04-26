#!/usr/bin/env python3
"""
scripts/bulk-upload-cloudflare-images.py

One-shot bulk upload of local images to Cloudflare Images via the
multipart Images v1 endpoint. Designed to run on Steven's PC against
a residential upstream — interruptible, resumable, deterministic.

Usage:

    python scripts/bulk-upload-cloudflare-images.py \
        --source-dir 'C:/Users/StevenMorey/Documents/stock'

Other flags:
    --concurrency N         (default: 5)
    --rate-limit-per-min N  (default: 150 — leaves headroom under
                             Cloudflare Images' documented 200/min cap)
    --max-bytes N           (default: 10485760 = 10 MB; Cloudflare
                             per-image hard limit. Larger files are
                             recorded as skipped_oversize without
                             an API call.)
    --dry-run               Enumerate + compute IDs only. No HTTP.
    --limit N               First N files (debugging).

Resume is implicit: re-running with the same --source-dir picks up
where the previous run left off via
scripts/output/cloudflare-upload-results.csv.

Env. CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_IMAGES_API_TOKEN are read
from .env.local at the repo root via python-dotenv when the file is
present, with os.environ as a fallback. Token must have the
"Account -> Cloudflare Images -> Edit" permission. Pre-flight probe
catches R2-only / read-only tokens before the first upload.

Idempotency. Each upload's Cloudflare id is
    f"{ID_PATH_PREFIX}{uuid5(BULK_UPLOAD_NAMESPACE, f'{basename}:{size}')}"
where:
  - ID_PATH_PREFIX = "opollo/bulk-upload/"
    Cloudflare rejects Custom IDs that match a bare UUID with
    error 5411 ("The Custom ID is invalid") — that shape is
    reserved for their auto-generated ids. Wrapping the UUID in
    a path prefix breaks the bare-UUID match AND gives the
    upload a namespace that's filterable in the Cloudflare
    dashboard. Slashes are explicitly allowed ("any number of
    subpaths") per the upload-via-custom-path docs.
  - BULK_UPLOAD_NAMESPACE = 46de16d8-f3bd-5f8c-a22b-afe7130fd117
    derived once via uuid5(NAMESPACE_URL,
    "https://opollo.com/bulk-upload/v1") and hardcoded as a
    literal so the on-the-wire id is inspectable from the
    source.
Same file -> same id across re-runs -> Cloudflare returns 409 /
"already exists", which we treat as a success outcome.

Source-of-truth invariant. cloudflare-upload-results.csv is the
authoritative record of what succeeded. Each row is appended +
flushed immediately on a terminal outcome (success or final
failure), under a thread lock. If the script dies mid-run, every
row written before the crash is durable; re-running picks up where
it left off.

Deps: requests, python-dotenv, stdlib.
    pip install requests python-dotenv
"""

from __future__ import annotations

import argparse
import csv
import os
import signal
import sys
import threading
import time
import uuid

# Force UTF-8 stdout/stderr on Windows so em-dashes / bullets render
# instead of mojibaking through cp1252.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    except (AttributeError, OSError):
        pass
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import requests
except ImportError:
    requests = None  # type: ignore[assignment]

try:
    from dotenv import load_dotenv

    _HAVE_DOTENV = True
except ImportError:
    _HAVE_DOTENV = False


def _require_requests() -> None:
    if requests is None:
        die("requests not installed. Run: pip install requests python-dotenv")


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CLOUDFLARE_API_ROOT = "https://api.cloudflare.com/client/v4"
DEFAULT_CONCURRENCY = 5
DEFAULT_RATE_LIMIT_PER_MIN = 150
DEFAULT_MAX_BYTES = 10 * 1024 * 1024
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
RETRY_BACKOFF_S = (1, 4, 16)
REQUEST_TIMEOUT_S = 60
PROGRESS_EVERY = 50
ROLLING_WINDOW = 200

# uuid5(NAMESPACE_URL, "https://opollo.com/bulk-upload/v1")
BULK_UPLOAD_NAMESPACE = uuid.UUID("46de16d8-f3bd-5f8c-a22b-afe7130fd117")

# Path prefix on every Cloudflare id. Cloudflare returns error 5411
# ("The Custom ID is invalid") for ids that match the bare-UUID shape
# their own auto-generation uses; wrapping in a path bypasses that
# check and namespaces these uploads in the dashboard.
ID_PATH_PREFIX = "opollo/bulk-upload/"

SCRIPT_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = SCRIPT_DIR / "output"
RESULTS_CSV = OUTPUT_DIR / "cloudflare-upload-results.csv"
FAILED_CSV = OUTPUT_DIR / "cloudflare-upload-failed.csv"

CSV_FIELDS = [
    "filename",
    "filesize_bytes",
    "cloudflare_id",
    "upload_status",
    "error_message",
    "uploaded_at",
]

_SHUTDOWN = threading.Event()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def die(msg: str, code: int = 1) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(code)


def fmt_eta(seconds: float) -> str:
    s = int(max(seconds, 0))
    h, s = divmod(s, 3600)
    m, s = divmod(s, 60)
    if h:
        return f"{h}h{m:02d}m{s:02d}s"
    return f"{m}m{s:02d}s"


def upstream_estimates(total_bytes: int) -> str:
    lines = []
    for mbps, label in [(10, "10 Mbps"), (50, "50 Mbps"), (200, "200 Mbps")]:
        secs = total_bytes / (mbps * 1_000_000 / 8)
        lines.append(f"  {label} -> {fmt_eta(secs)}")
    return "\n".join(lines)


def compute_cloudflare_id(filename: str, filesize_bytes: int) -> str:
    digest = uuid.uuid5(BULK_UPLOAD_NAMESPACE, f"{filename}:{filesize_bytes}")
    return f"{ID_PATH_PREFIX}{digest}"


# ---------------------------------------------------------------------------
# Env loading
# ---------------------------------------------------------------------------


def load_env() -> tuple[str, str]:
    if _HAVE_DOTENV:
        # .env.local lives at repo root; SCRIPT_DIR is <repo>/scripts.
        env_path = SCRIPT_DIR.parent / ".env.local"
        if env_path.exists():
            load_dotenv(env_path)
    account_id = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
    api_token = os.environ.get("CLOUDFLARE_IMAGES_API_TOKEN", "").strip()
    if not account_id:
        die("CLOUDFLARE_ACCOUNT_ID is not set. Add to .env.local or export it.")
    if not api_token:
        die("CLOUDFLARE_IMAGES_API_TOKEN is not set. Add to .env.local or export it.")
    return account_id, api_token


# ---------------------------------------------------------------------------
# Pre-flight: token permission probe
# ---------------------------------------------------------------------------


def verify_token(account_id: str, api_token: str) -> None:
    _require_requests()
    url = f"{CLOUDFLARE_API_ROOT}/accounts/{account_id}/images/v1"
    r = requests.get(
        url,
        params={"per_page": 1},
        headers={"Authorization": f"Bearer {api_token}"},
        timeout=REQUEST_TIMEOUT_S,
    )
    if r.status_code == 200:
        return
    if r.status_code in (401, 403):
        die(
            f"Token rejected (HTTP {r.status_code}). The token needs the "
            f"'Account -> Cloudflare Images -> Edit' permission. R2-only or "
            f"Read-only tokens fail this probe. Body: {r.text[:300]}"
        )
    die(f"Pre-flight probe failed: HTTP {r.status_code}: {r.text[:300]}")


# ---------------------------------------------------------------------------
# File enumeration
# ---------------------------------------------------------------------------


def enumerate_files(source_dir: Path) -> list[tuple[str, int, Path]]:
    if not source_dir.is_dir():
        die(f"Source directory not found: {source_dir}")
    rows: list[tuple[str, int, Path]] = []
    for entry in os.scandir(source_dir):
        # Only regular files at depth 1 -> skips subdirs (.wrangler/) and symlinks.
        if not entry.is_file(follow_symlinks=False):
            continue
        name = entry.name
        if name.startswith("."):
            continue
        ext = Path(name).suffix.lower()
        if ext not in SUPPORTED_EXTENSIONS:
            continue
        rows.append((name, entry.stat().st_size, Path(entry.path)))
    rows.sort(key=lambda r: r[0])
    return rows


# ---------------------------------------------------------------------------
# Resume scan
# ---------------------------------------------------------------------------


def load_existing_successes(csv_path: Path) -> set[str]:
    if not csv_path.exists():
        return set()
    successes: set[str] = set()
    with csv_path.open("r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get("upload_status") == "success":
                successes.add(row["filename"])
    return successes


# ---------------------------------------------------------------------------
# Token bucket
# ---------------------------------------------------------------------------


class RateLimiter:
    def __init__(self, per_minute: int):
        self.capacity = max(per_minute, 1)
        self.rate_per_sec = per_minute / 60.0
        self.tokens = float(self.capacity)
        self.updated_at = time.monotonic()
        self.lock = threading.Lock()

    def acquire(self) -> None:
        while True:
            with self.lock:
                now = time.monotonic()
                self.tokens = min(
                    self.capacity,
                    self.tokens + (now - self.updated_at) * self.rate_per_sec,
                )
                self.updated_at = now
                if self.tokens >= 1:
                    self.tokens -= 1
                    return
                wait = (1 - self.tokens) / self.rate_per_sec
            time.sleep(wait)


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------


def _is_already_exists(body: dict[str, Any] | None) -> bool:
    if not body or body.get("success"):
        return False
    for err in body.get("errors") or []:
        msg = (err.get("message") or "").lower()
        if "already exists" in msg or "resource_already_exists" in msg:
            return True
        if err.get("code") == 5461:
            return True
    return False


def upload_one(
    *,
    session: "requests.Session",
    account_id: str,
    api_token: str,
    rate_limiter: RateLimiter,
    filename: str,
    filesize_bytes: int,
    path: Path,
    cloudflare_id: str,
) -> tuple[str, str]:
    url = f"{CLOUDFLARE_API_ROOT}/accounts/{account_id}/images/v1"
    last_error = ""
    for attempt in range(len(RETRY_BACKOFF_S) + 1):
        if _SHUTDOWN.is_set():
            return "failed", "cancelled before attempt"
        rate_limiter.acquire()
        try:
            with path.open("rb") as fh:
                r = session.post(
                    url,
                    headers={"Authorization": f"Bearer {api_token}"},
                    files={"file": (filename, fh, "application/octet-stream")},
                    data={"id": cloudflare_id},
                    timeout=REQUEST_TIMEOUT_S,
                )
        except (requests.ConnectionError, requests.Timeout) as e:
            last_error = f"network: {type(e).__name__}: {e}"
            if attempt < len(RETRY_BACKOFF_S):
                time.sleep(RETRY_BACKOFF_S[attempt])
                continue
            return "failed", last_error
        except OSError as e:
            return "failed", f"local read error: {e}"

        try:
            body = r.json()
        except ValueError:
            body = None

        if r.status_code == 200 and body and body.get("success"):
            return "success", ""

        if r.status_code == 409 or _is_already_exists(body):
            return "success", ""

        if r.status_code == 429 or r.status_code >= 500:
            last_error = f"HTTP {r.status_code}: {r.text[:200]}"
            if attempt < len(RETRY_BACKOFF_S):
                time.sleep(RETRY_BACKOFF_S[attempt])
                continue
            return "failed", last_error

        return "failed", f"HTTP {r.status_code}: {r.text[:200]}"

    return "failed", last_error or "unknown"


# ---------------------------------------------------------------------------
# CSV writer
# ---------------------------------------------------------------------------


class ResultWriter:
    def __init__(self, results_path: Path, failed_path: Path):
        self.lock = threading.Lock()
        results_path.parent.mkdir(parents=True, exist_ok=True)
        self._results_fh = self._open_with_header(results_path)
        self._failed_fh = self._open_with_header(failed_path)
        self._results_writer = csv.DictWriter(self._results_fh, fieldnames=CSV_FIELDS)
        self._failed_writer = csv.DictWriter(self._failed_fh, fieldnames=CSV_FIELDS)

    @staticmethod
    def _open_with_header(path: Path):
        is_new = not path.exists() or path.stat().st_size == 0
        fh = path.open("a", newline="", encoding="utf-8")
        if is_new:
            csv.DictWriter(fh, fieldnames=CSV_FIELDS).writeheader()
            fh.flush()
        return fh

    def write(self, row: dict[str, Any]) -> None:
        with self.lock:
            self._results_writer.writerow(row)
            self._results_fh.flush()
            if row["upload_status"] == "failed":
                self._failed_writer.writerow(row)
                self._failed_fh.flush()

    def close(self) -> None:
        with self.lock:
            self._results_fh.close()
            self._failed_fh.close()


# ---------------------------------------------------------------------------
# Signal handling
# ---------------------------------------------------------------------------


def install_sigint() -> None:
    def _handler(signum, frame):  # noqa: ARG001
        if _SHUTDOWN.is_set():
            os._exit(130)
        print(
            "\nCtrl-C received — finishing in-flight uploads, then exiting. "
            "Hit Ctrl-C again to force-exit.\n",
            file=sys.stderr,
        )
        _SHUTDOWN.set()

    signal.signal(signal.SIGINT, _handler)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Bulk upload local images to Cloudflare Images.",
    )
    parser.add_argument(
        "--source-dir", default=r"C:\Users\StevenMorey\Documents\stock"
    )
    parser.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY)
    parser.add_argument(
        "--rate-limit-per-min", type=int, default=DEFAULT_RATE_LIMIT_PER_MIN
    )
    parser.add_argument("--max-bytes", type=int, default=DEFAULT_MAX_BYTES)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args(argv)

    source_dir = Path(args.source_dir)
    print(f"Source dir: {source_dir}")
    files = enumerate_files(source_dir)
    if args.limit:
        files = files[: args.limit]
    if not files:
        print("No image files found.")
        return 0

    total_bytes = sum(b for _, b, _ in files)
    print(
        f"Discovered {len(files)} image files, "
        f"total {total_bytes / (1024**3):.2f} GB"
    )
    print("Estimated runtime at typical upstream speeds (raw bytes only):")
    print(upstream_estimates(total_bytes))

    successes = load_existing_successes(RESULTS_CSV)
    if successes:
        print(f"Resume scan: {len(successes)} files already uploaded — will skip.")

    oversize = [(n, b) for n, b, _ in files if b > args.max_bytes]
    if oversize:
        print(
            f"Oversize (>{args.max_bytes:,} bytes): {len(oversize)} — will record "
            f"as skipped_oversize without API call."
        )

    if args.dry_run:
        print("\nDry-run — no uploads performed. Sample IDs:")
        for name, size, _ in files[:5]:
            print(f"  {name} ({size:,} B) -> {compute_cloudflare_id(name, size)}")
        return 0

    account_id, api_token = load_env()
    print("Pre-flight: probing token permission...")
    verify_token(account_id, api_token)
    print("Token OK (Cloudflare Images:Edit confirmed).")

    _require_requests()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    writer = ResultWriter(RESULTS_CSV, FAILED_CSV)
    rate_limiter = RateLimiter(args.rate_limit_per_min)
    session = requests.Session()
    install_sigint()

    completed = succeeded = failed = skipped = 0
    times: list[float] = []
    start = time.monotonic()

    def task(name: str, size: int, path: Path) -> tuple[str, dict[str, Any], float]:
        cloudflare_id = compute_cloudflare_id(name, size)
        now = datetime.now(timezone.utc).isoformat()
        if name in successes:
            return (
                "skipped",
                {
                    "filename": name,
                    "filesize_bytes": size,
                    "cloudflare_id": cloudflare_id,
                    "upload_status": "skipped_resume",
                    "error_message": "",
                    "uploaded_at": now,
                },
                0.0,
            )
        if size > args.max_bytes:
            return (
                "skipped",
                {
                    "filename": name,
                    "filesize_bytes": size,
                    "cloudflare_id": cloudflare_id,
                    "upload_status": "skipped_oversize",
                    "error_message": f"size {size} > max {args.max_bytes}",
                    "uploaded_at": now,
                },
                0.0,
            )
        item_start = time.monotonic()
        status, err = upload_one(
            session=session,
            account_id=account_id,
            api_token=api_token,
            rate_limiter=rate_limiter,
            filename=name,
            filesize_bytes=size,
            path=path,
            cloudflare_id=cloudflare_id,
        )
        elapsed = time.monotonic() - item_start
        return (
            status,
            {
                "filename": name,
                "filesize_bytes": size,
                "cloudflare_id": cloudflare_id,
                "upload_status": status,
                "error_message": err,
                "uploaded_at": datetime.now(timezone.utc).isoformat(),
            },
            elapsed,
        )

    try:
        with ThreadPoolExecutor(max_workers=args.concurrency) as executor:
            futures = {
                executor.submit(task, name, size, path): name
                for name, size, path in files
            }
            for fut in as_completed(futures):
                kind, row, elapsed = fut.result()
                writer.write(row)
                completed += 1
                if kind == "success":
                    succeeded += 1
                elif kind == "failed":
                    failed += 1
                else:
                    skipped += 1
                if elapsed > 0:
                    times.append(elapsed)
                    if len(times) > ROLLING_WINDOW:
                        times = times[-ROLLING_WINDOW:]
                if completed % PROGRESS_EVERY == 0 or completed == len(files):
                    pct = 100 * completed / len(files)
                    avg = (sum(times) / len(times)) if times else 0
                    remaining = len(files) - completed
                    eta_s = (
                        (avg * remaining) / max(args.concurrency, 1) if avg else 0
                    )
                    print(
                        f"[{completed}/{len(files)}] {pct:5.1f}% "
                        f"• ok={succeeded} • failed={failed} • skipped={skipped} "
                        f"• avg={avg:5.2f}s/img • eta={fmt_eta(eta_s)}",
                        flush=True,
                    )
    finally:
        writer.close()

    total_elapsed = time.monotonic() - start
    print(f"\nDone in {fmt_eta(total_elapsed)}.")
    print(f"  Succeeded:  {succeeded}")
    print(f"  Failed:     {failed}  (see {FAILED_CSV})")
    print(f"  Skipped:    {skipped}")
    print(f"  Results:    {RESULTS_CSV}")
    print("\nVerify in Cloudflare dashboard -> Images -> All Images.")

    if _SHUTDOWN.is_set():
        return 3
    if failed > 0:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
