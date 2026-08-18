#!/usr/bin/env python3
"""Populate Cargo's crates.io cache on filesystems that reject Unix epoch mtimes."""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import http.client
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile
import time
import tomllib
import urllib.error
import urllib.parse
import urllib.request


CRATES_IO_SOURCES = {
    "registry+https://github.com/rust-lang/crates.io-index",
    "registry+https://index.crates.io/",
    "sparse+https://index.crates.io/",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lockfile", type=Path, required=True)
    parser.add_argument("--cargo-home", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=6)
    return parser.parse_args()


def load_packages(lockfile: Path) -> list[dict[str, str]]:
    with lockfile.open("rb") as handle:
        lock = tomllib.load(handle)

    packages: list[dict[str, str]] = []
    for package in lock.get("package", []):
        source = package.get("source")
        checksum = package.get("checksum")
        if source not in CRATES_IO_SOURCES or not checksum:
            continue
        packages.append(
            {
                "name": package["name"],
                "version": package["version"],
                "checksum": checksum.lower(),
            }
        )

    unique = {(item["name"], item["version"]): item for item in packages}
    return [unique[key] for key in sorted(unique)]


def registry_name(cargo_home: Path) -> str:
    index_root = cargo_home / "registry" / "index"
    candidates = sorted(index_root.glob("index.crates.io-*"))
    if len(candidates) != 1:
        raise RuntimeError(
            f"expected one crates.io index under {index_root}, found {len(candidates)}"
        )
    return candidates[0].name


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def crate_url(name: str, version: str) -> str:
    quoted_name = urllib.parse.quote(name, safe="")
    quoted_file = urllib.parse.quote(f"{name}-{version}.crate", safe="")
    return f"https://static.crates.io/crates/{quoted_name}/{quoted_file}"


def download_with_curl(
    filename: str, url: str, expected: str, part: Path, destination: Path
) -> tuple[str, bool]:
    curl = shutil.which("curl.exe")
    if not curl:
        raise RuntimeError("curl.exe is not available")

    last_error = "curl did not run"
    for attempt in range(1, 5):
        part.unlink(missing_ok=True)
        command = [
            curl,
            "--fail",
            "--location",
            "--silent",
            "--show-error",
            "--connect-timeout",
            "30",
            "--max-time",
            "1800",
            "--speed-limit",
            "256",
            "--speed-time",
            "60",
            "--output",
            str(part),
            url,
        ]
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        if part.is_file() and sha256(part) == expected:
            os.replace(part, destination)
            return filename, True
        last_error = result.stderr.strip() or f"curl exit code {result.returncode}"
        part.unlink(missing_ok=True)
        if attempt < 4:
            time.sleep(attempt * 2)
    raise RuntimeError(f"failed to download {filename}: {last_error}")


def download_package(package: dict[str, str], cache_root: Path) -> tuple[str, bool]:
    name = package["name"]
    version = package["version"]
    expected = package["checksum"]
    filename = f"{name}-{version}.crate"
    destination = cache_root / filename

    if destination.is_file() and destination.stat().st_size > 0:
        if sha256(destination) == expected:
            return filename, False
        destination.unlink()

    url = crate_url(name, version)
    part = destination.with_suffix(destination.suffix + ".part")
    if os.name == "nt" and shutil.which("curl.exe"):
        return download_with_curl(filename, url, expected, part, destination)

    last_error: Exception | None = None
    for attempt in range(1, 9):
        try:
            existing_size = part.stat().st_size if part.is_file() else 0
            headers = {"User-Agent": "cargo/1.97.1"}
            if existing_size:
                headers["Range"] = f"bytes={existing_size}-"
            request = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(request, timeout=120) as response:
                status = response.getcode()
                resumed = existing_size > 0 and status == 206
                if resumed:
                    content_range = response.headers.get("Content-Range", "")
                    if not content_range.startswith(f"bytes {existing_size}-"):
                        raise RuntimeError(
                            f"unexpected Content-Range for {filename}: {content_range!r}"
                        )
                mode = "ab" if resumed else "wb"
                with part.open(mode) as out:
                    shutil.copyfileobj(response, out, length=1024 * 1024)
            actual = sha256(part)
            if actual != expected:
                raise RuntimeError(
                    f"checksum mismatch for {filename}: expected {expected}, got {actual}"
                )
            os.replace(part, destination)
            return filename, True
        except urllib.error.HTTPError as error:
            last_error = error
            if error.code == 416 and part.is_file() and sha256(part) == expected:
                os.replace(part, destination)
                return filename, True
            if error.code == 416:
                part.unlink(missing_ok=True)
            if attempt < 8:
                time.sleep(attempt * 2)
        except RuntimeError as error:
            last_error = error
            part.unlink(missing_ok=True)
            if attempt < 8:
                time.sleep(attempt * 2)
        except (OSError, urllib.error.URLError, http.client.HTTPException) as error:
            last_error = error
            if attempt < 8:
                time.sleep(attempt * 2)
    raise RuntimeError(f"failed to download {filename}: {last_error}")


def safe_relative_path(member_name: str, expected_root: str) -> PurePosixPath:
    path = PurePosixPath(member_name)
    if path.is_absolute() or not path.parts or path.parts[0] != expected_root:
        raise RuntimeError(f"unexpected archive path: {member_name!r}")
    relative = PurePosixPath(*path.parts[1:])
    if any(part in {"", ".", ".."} for part in relative.parts):
        raise RuntimeError(f"unsafe archive path: {member_name!r}")
    return relative


def extract_package(package: dict[str, str], cache_root: Path, src_root: Path) -> bool:
    name = package["name"]
    version = package["version"]
    package_root = f"{name}-{version}"
    archive = cache_root / f"{package_root}.crate"
    destination = src_root / package_root
    marker = destination / ".cargo-ok"

    if marker.is_file() and marker.read_text(encoding="ascii") == '{"v":1}':
        return False

    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True)

    try:
        with tarfile.open(archive, mode="r:gz") as bundle:
            for member in bundle:
                relative = safe_relative_path(member.name, package_root)
                if not relative.parts:
                    continue
                if relative.name == ".cargo-ok":
                    raise RuntimeError(f"archive contains reserved .cargo-ok: {archive}")
                target = destination.joinpath(*relative.parts)
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                if not member.isfile():
                    raise RuntimeError(
                        f"unsupported archive entry type for {member.name!r} in {archive.name}"
                    )
                target.parent.mkdir(parents=True, exist_ok=True)
                source = bundle.extractfile(member)
                if source is None:
                    raise RuntimeError(f"could not read {member.name!r} from {archive.name}")
                with source, target.open("wb") as out:
                    shutil.copyfileobj(source, out, length=1024 * 1024)

        if not (destination / "Cargo.toml").is_file():
            raise RuntimeError(f"Cargo.toml missing after extracting {archive.name}")
        marker.write_text('{"v":1}', encoding="ascii", newline="")
        return True
    except Exception:
        shutil.rmtree(destination, ignore_errors=True)
        raise


def main() -> int:
    args = parse_args()
    if args.workers < 1 or args.workers > 16:
        raise SystemExit("--workers must be between 1 and 16")

    lockfile = args.lockfile.resolve()
    cargo_home = args.cargo_home.resolve()
    packages = load_packages(lockfile)
    registry = registry_name(cargo_home)
    cache_root = cargo_home / "registry" / "cache" / registry
    src_root = cargo_home / "registry" / "src" / registry
    cache_root.mkdir(parents=True, exist_ok=True)
    src_root.mkdir(parents=True, exist_ok=True)

    print(f"Locked crates.io packages: {len(packages)}", flush=True)
    downloaded = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = [executor.submit(download_package, package, cache_root) for package in packages]
        for index, future in enumerate(concurrent.futures.as_completed(futures), start=1):
            filename, was_downloaded = future.result()
            downloaded += int(was_downloaded)
            if index % 25 == 0 or index == len(futures):
                print(
                    f"Downloads verified: {index}/{len(futures)} (new {downloaded}); last {filename}",
                    flush=True,
                )

    extracted = 0
    for index, package in enumerate(packages, start=1):
        extracted += int(extract_package(package, cache_root, src_root))
        if index % 25 == 0 or index == len(packages):
            print(
                f"Sources ready: {index}/{len(packages)} (new {extracted})",
                flush=True,
            )

    print(
        f"Cargo cache ready: downloaded {downloaded}, extracted {extracted}, registry {registry}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
