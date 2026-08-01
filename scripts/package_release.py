#!/usr/bin/env python3
"""Build deterministic, least-content BrowserClaw release archives."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import stat
import sys
import zipfile
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
EXTENSION = ROOT / "extension" / "chrome-web-research"
OUTPUT = ROOT / "release-artifacts"
FIXED_TIMESTAMP = (1980, 1, 1, 0, 0, 0)
EXTENSION_FILES = (
    "manifest.json",
    "service-worker.js",
    "content-extract.js",
    "README.md",
)
FORBIDDEN_PARTS = {
    ".git",
    ".github",
    "node_modules",
    "tests",
    "test",
    "fixtures",
    "coverage",
    "__pycache__",
}
FORBIDDEN_SUFFIXES = {".pem", ".key", ".p12", ".pfx"}


def fail(message: str) -> None:
    raise SystemExit(f"Release packaging failed: {message}")


def load_json(path: Path) -> dict[str, object]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"cannot read {path.relative_to(ROOT)}: {exc}")
    if not isinstance(value, dict):
        fail(f"{path.relative_to(ROOT)} must contain a JSON object")
    return value


def relative_files(directory: Path) -> list[Path]:
    return sorted(
        (path.relative_to(directory) for path in directory.rglob("*") if path.is_file()),
        key=lambda path: path.as_posix(),
    )


def validate_archive_path(path: Path) -> None:
    lowered = tuple(part.lower() for part in path.parts)
    if any(part in FORBIDDEN_PARTS for part in lowered):
        fail(f"forbidden archive path: {path.as_posix()}")
    if any(part.startswith(".env") for part in lowered):
        fail(f"environment file must not be packaged: {path.as_posix()}")
    if path.suffix.lower() in FORBIDDEN_SUFFIXES:
        fail(f"private-key-like file must not be packaged: {path.as_posix()}")


def zip_info(name: str, executable: bool = False) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name, FIXED_TIMESTAMP)
    info.create_system = 3
    mode = 0o755 if executable else 0o644
    info.external_attr = (stat.S_IFREG | mode) << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    return info


def write_zip(
    output: Path,
    source: Path,
    files: Iterable[Path],
    prefix: str = "",
) -> None:
    with zipfile.ZipFile(
        output,
        mode="w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
        strict_timestamps=True,
    ) as archive:
        for relative in sorted(files, key=lambda path: path.as_posix()):
            validate_archive_path(relative)
            absolute = source / relative
            if absolute.is_symlink():
                fail(f"symbolic links are not permitted in artifacts: {relative}")
            name = f"{prefix}{relative.as_posix()}"
            archive.writestr(zip_info(name), absolute.read_bytes())


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    if not (DIST / "index.html").is_file():
        fail("dist/index.html is missing; run the strict release build first")
    if not (DIST / "release-metadata.json").is_file():
        fail("dist/release-metadata.json is missing")

    config = load_json(ROOT / "release" / "release-config.json")
    metadata = load_json(DIST / "release-metadata.json")
    version = str(config.get("version", ""))
    commit_sha = str(metadata.get("commitSha", ""))
    channel = str(metadata.get("releaseChannel", ""))
    build_utc = str(metadata.get("buildUtc", ""))

    if version != metadata.get("version"):
        fail("release metadata version does not match release-config.json")
    if len(commit_sha) != 40 or any(character not in "0123456789abcdefABCDEF" for character in commit_sha):
        fail("release metadata does not contain a full commit SHA")
    if channel not in {"rc", "stable"}:
        fail("release metadata channel must be rc or stable")
    if not build_utc.endswith("Z"):
        fail("release metadata buildUtc must be UTC")

    extension_paths = [Path(name) for name in EXTENSION_FILES]
    for relative in extension_paths:
        if not (EXTENSION / relative).is_file():
            fail(f"required extension file is missing: {relative}")

    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    OUTPUT.mkdir(parents=True)

    tag = os.environ.get("GITHUB_REF_NAME") or str(config.get("rcTag", "v0.1.0-rc.1"))
    safe_tag = tag.removeprefix("v")
    app_name = f"browserclaw-app-{safe_tag}.zip"
    extension_name = f"browserclaw-extension-{safe_tag}.zip"
    app_archive = OUTPUT / app_name
    extension_archive = OUTPUT / extension_name

    write_zip(app_archive, DIST, relative_files(DIST))
    write_zip(extension_archive, EXTENSION, extension_paths, "browserclaw-extension/")

    artifacts = []
    for path, kind in ((app_archive, "application"), (extension_archive, "chrome-extension")):
        artifacts.append(
            {
                "kind": kind,
                "name": path.name,
                "sha256": sha256(path),
                "sizeInBytes": path.stat().st_size,
            }
        )

    release_manifest = {
        "schemaVersion": 1,
        "product": config.get("product"),
        "version": version,
        "tag": tag,
        "commitSha": commit_sha,
        "buildUtc": build_utc,
        "releaseChannel": channel,
        "productionUrl": config.get("productionUrl"),
        "extensionId": config.get("extensionId"),
        "supportedBrowsers": config.get("supportedBrowsers"),
        "artifacts": artifacts,
    }
    manifest_path = OUTPUT / "browserclaw-release-manifest.json"
    manifest_path.write_text(
        json.dumps(release_manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    checksum_lines = [f"{entry['sha256']}  {entry['name']}" for entry in artifacts]
    checksum_lines.append(f"{sha256(manifest_path)}  {manifest_path.name}")
    (OUTPUT / "SHA256SUMS").write_text("\n".join(checksum_lines) + "\n", encoding="utf-8")

    print(f"Created deterministic release artifacts in {OUTPUT.relative_to(ROOT)}")
    for entry in artifacts:
        print(f"{entry['sha256']}  {entry['name']}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
