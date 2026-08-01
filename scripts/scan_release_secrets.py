#!/usr/bin/env python3
"""Fail closed on high-confidence credentials in source history or artifacts.

The scanner never prints a complete matched credential. Findings contain only the
credential kind, source location, a short redacted preview, and a SHA-256
fingerprint suitable for adjudication or a narrowly scoped future allowlist.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import re
import subprocess
import sys
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

MAX_TEXT_BYTES = 20 * 1024 * 1024
MAX_ZIP_DEPTH = 4


@dataclass(frozen=True)
class SecretPattern:
    name: str
    expression: re.Pattern[bytes]
    group: int = 0


@dataclass(frozen=True)
class Finding:
    kind: str
    source: str
    line: int
    preview: str
    fingerprint: str


PATTERNS: tuple[SecretPattern, ...] = (
    SecretPattern(
        "OpenAI-style API key",
        re.compile(rb"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b"),
    ),
    SecretPattern(
        "Anthropic-style API key",
        re.compile(rb"\bsk-ant-(?:api\d{2}-)?[A-Za-z0-9_-]{32,}\b"),
    ),
    SecretPattern(
        "GitHub token",
        re.compile(rb"\bgh[pousr]_[A-Za-z0-9]{36,255}\b"),
    ),
    SecretPattern(
        "GitHub fine-grained token",
        re.compile(rb"\bgithub_pat_[A-Za-z0-9_]{60,255}\b"),
    ),
    SecretPattern(
        "AWS access key ID",
        re.compile(rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    ),
    SecretPattern(
        "Slack token",
        re.compile(rb"\bxox[baprs]-[A-Za-z0-9-]{20,255}\b"),
    ),
    SecretPattern(
        "JSON Web Token",
        re.compile(
            rb"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\."
            rb"[A-Za-z0-9_-]{8,}\b"
        ),
    ),
    SecretPattern(
        "Authorization bearer credential",
        re.compile(
            rb"(?i)\bauthorization\s*:\s*bearer\s+"
            rb"([A-Za-z0-9._~+/-]{24,}=*)"
        ),
        group=1,
    ),
    SecretPattern(
        "PEM private key",
        re.compile(
            rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"
        ),
    ),
)


def redact(value: bytes) -> tuple[str, str]:
    fingerprint = hashlib.sha256(value).hexdigest()[:16]
    text = value.decode("ascii", errors="replace")
    if len(text) <= 12:
        preview = "<redacted>"
    else:
        preview = f"{text[:4]}…{text[-4:]}"
    return preview, fingerprint


def line_number(data: bytes, offset: int, line_offset: int = 0) -> int:
    return line_offset + data.count(b"\n", 0, offset) + 1


def scan_bytes(
    data: bytes,
    source: str,
    *,
    line_offset: int = 0,
) -> list[Finding]:
    if len(data) > MAX_TEXT_BYTES or b"\x00" in data:
        return []

    findings: list[Finding] = []
    for pattern in PATTERNS:
        for match in pattern.expression.finditer(data):
            value = match.group(pattern.group)
            preview, fingerprint = redact(value)
            findings.append(
                Finding(
                    kind=pattern.name,
                    source=source,
                    line=line_number(
                        data,
                        match.start(pattern.group),
                        line_offset,
                    ),
                    preview=preview,
                    fingerprint=fingerprint,
                )
            )
    return findings


def scan_zip_bytes(data: bytes, source: str, depth: int = 0) -> list[Finding]:
    if depth > MAX_ZIP_DEPTH:
        raise ValueError(f"nested ZIP depth exceeds {MAX_ZIP_DEPTH}: {source}")

    findings: list[Finding] = []
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for member in archive.infolist():
            member_source = f"{source}!{member.filename}"
            if member.flag_bits & 0x1:
                raise ValueError(
                    f"encrypted ZIP member cannot be scanned: {member_source}"
                )
            if member.is_dir():
                continue
            if member.file_size > MAX_TEXT_BYTES:
                continue
            payload = archive.read(member)
            if member.filename.lower().endswith(".zip"):
                findings.extend(scan_zip_bytes(payload, member_source, depth + 1))
            else:
                findings.extend(scan_bytes(payload, member_source))
    return findings


def scan_path(path: Path) -> list[Finding]:
    if path.is_symlink():
        raise ValueError(f"refusing to scan symbolic link: {path}")
    if path.is_dir():
        findings: list[Finding] = []
        for child in sorted(path.rglob("*")):
            if child.is_file():
                findings.extend(scan_path(child))
        return findings

    data = path.read_bytes()
    if path.suffix.lower() == ".zip":
        return scan_zip_bytes(data, str(path))
    return scan_bytes(data, str(path))


def tracked_files() -> Iterable[Path]:
    completed = subprocess.run(
        ["git", "ls-files", "-z"],
        check=True,
        stdout=subprocess.PIPE,
    )
    for raw_path in completed.stdout.split(b"\x00"):
        if raw_path:
            yield Path(raw_path.decode("utf-8", errors="strict"))


def scan_working_tree() -> list[Finding]:
    findings: list[Finding] = []
    for path in tracked_files():
        if path.is_file():
            findings.extend(scan_path(path))
    return findings


def scan_git_history() -> list[Finding]:
    process = subprocess.Popen(
        [
            "git",
            "log",
            "--all",
            "--root",
            "--full-history",
            "--no-color",
            "--format=commit:%H",
            "--patch",
        ],
        stdout=subprocess.PIPE,
    )
    if process.stdout is None:
        process.kill()
        raise OSError("git history scanner did not receive stdout")

    findings: list[Finding] = []
    for output_line, data in enumerate(process.stdout, start=1):
        findings.extend(
            scan_bytes(
                data,
                "git-history-patch-stream",
                line_offset=output_line - 1,
            )
        )
    return_code = process.wait()
    if return_code != 0:
        raise subprocess.CalledProcessError(return_code, process.args)
    return findings


def run_self_test() -> None:
    clean = b"Authorization: Bearer <runtime-user-value>\n"
    if scan_bytes(clean, "self-test-clean"):
        raise AssertionError("clean self-test content produced a finding")

    synthetic_key = b"sk-" + (b"A" * 40)
    findings = scan_bytes(b"key=" + synthetic_key, "self-test-secret")
    if len(findings) != 1 or findings[0].kind != "OpenAI-style API key":
        raise AssertionError("synthetic API key was not detected exactly once")
    if synthetic_key.decode("ascii") in repr(findings):
        raise AssertionError("finding representation exposed the complete credential")

    with tempfile.TemporaryDirectory() as temporary_directory:
        archive_path = Path(temporary_directory) / "nested.zip"
        inner = io.BytesIO()
        with zipfile.ZipFile(inner, "w") as archive:
            archive.writestr("secret.txt", b"token=" + synthetic_key)
        with zipfile.ZipFile(archive_path, "w") as archive:
            archive.writestr("inner.zip", inner.getvalue())
        nested_findings = scan_path(archive_path)
        if len(nested_findings) != 1:
            raise AssertionError("nested ZIP credential was not detected")

    print("Secret scanner self-test passed.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--working-tree", action="store_true")
    parser.add_argument("--git-history", action="store_true")
    parser.add_argument("--path", action="append", default=[])
    parser.add_argument("--self-test", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.self_test:
        run_self_test()

    requested_scan = args.working_tree or args.git_history or bool(args.path)
    if not requested_scan:
        if args.self_test:
            return 0
        raise SystemExit("select --working-tree, --git-history, or --path")

    findings: list[Finding] = []
    if args.working_tree:
        findings.extend(scan_working_tree())
    if args.git_history:
        findings.extend(scan_git_history())
    for raw_path in args.path:
        findings.extend(scan_path(Path(raw_path)))

    unique_findings = sorted(
        set(findings),
        key=lambda finding: (
            finding.source,
            finding.line,
            finding.kind,
            finding.fingerprint,
        ),
    )
    if unique_findings:
        print(
            f"Secret scan failed with {len(unique_findings)} high-confidence finding(s):",
            file=sys.stderr,
        )
        for finding in unique_findings:
            print(
                f"- {finding.kind} at {finding.source}:{finding.line} "
                f"value={finding.preview} sha256={finding.fingerprint}",
                file=sys.stderr,
            )
        return 1

    print("Secret scan passed with no high-confidence credentials detected.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (
        OSError,
        subprocess.CalledProcessError,
        zipfile.BadZipFile,
        ValueError,
    ) as error:
        print(f"Secret scan could not complete: {error}", file=sys.stderr)
        raise SystemExit(2) from error
