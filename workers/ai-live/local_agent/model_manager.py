"""Commercial-license admission for models in signed managed components.

There is no independent downloader or customer model path. Delivery, resume,
repair, atomic activation, rollback and uninstall remain BootstrapManager's job.
The catalog and every artifact must be covered by its signed release manifest.
"""
from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from .components import _hash_file, _relative, _safe
from .security import SecurityError

CATALOG_PATH = "models/local-ai/catalog.json"
CATALOG_FORMAT = "viralflow-local-ai-models-v1"
PERMISSIVE_LICENSES = frozenset({"Apache-2.0", "MIT", "BSD-2-Clause", "BSD-3-Clause", "ISC", "CC0-1.0", "CC-BY-4.0"})
KINDS = frozenset({"BRAIN", "TTS", "VOCODER", "RUNTIME"})
PROFILES = frozenset({"qwen3-4b-q4_k_m", "qwen3-8b-q4_k_m", "cpu-dev", "gpu-lite", "gpu-standard", "gpu-high", "voxcpm2"})


@dataclass(frozen=True)
class ModelArtifact:
    relative_path: str
    sha256: str
    size_bytes: int


@dataclass(frozen=True)
class ModelRecord:
    model_id: str
    kind: str
    version: str
    source: str
    code_license: str
    weights_license: str
    commercial_allowed: bool
    redistribution_allowed: bool
    attribution: tuple[str, ...]
    relative_path: str
    artifacts: tuple[ModelArtifact, ...]
    requires_gpu: bool
    minimum_ram_gb: float
    minimum_vram_gb: float
    profile: str


def validate_model_record(value: dict) -> ModelRecord:
    required = set(ModelRecord.__dataclass_fields__)
    if not isinstance(value, dict) or set(value) != required:
        raise SecurityError("LOCAL_MODEL_CATALOG_INVALID")
    if (value["commercial_allowed"] is not True or value["redistribution_allowed"] is not True
            or value["code_license"] not in PERMISSIVE_LICENSES or value["weights_license"] not in PERMISSIVE_LICENSES):
        raise SecurityError("LOCAL_MODEL_NOT_SHIPPABLE")
    if (not isinstance(value["model_id"], str) or not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,79}", value["model_id"])
            or value["kind"] not in KINDS or value["profile"] not in PROFILES
            or not isinstance(value["version"], str) or not re.fullmatch(r"[A-Za-z0-9._-]{1,80}", value["version"])
            or not isinstance(value["source"], str) or len(value["source"]) > 2048):
        raise SecurityError("LOCAL_MODEL_CATALOG_INVALID")
    parsed = urlsplit(value["source"])
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise SecurityError("LOCAL_MODEL_SOURCE_INVALID")
    if (type(value["requires_gpu"]) is not bool or any(type(value[key]) not in (float, int)
            or not math.isfinite(value[key]) or not 0 <= value[key] <= 1024
            for key in ("minimum_ram_gb", "minimum_vram_gb"))):
        raise SecurityError("LOCAL_MODEL_CATALOG_INVALID")
    attribution = value["attribution"]
    if (not isinstance(attribution, (list, tuple)) or not 1 <= len(attribution) <= 20
            or any(not isinstance(item, str) or not item.strip() or len(item) > 4096 for item in attribution)):
        raise SecurityError("LOCAL_MODEL_ATTRIBUTION_REQUIRED")
    directory = _relative(value["relative_path"])
    if directory.split("/")[0] not in {"models", "runtime"}:
        raise SecurityError("LOCAL_MODEL_PATH_INVALID")
    artifacts = value["artifacts"]
    if not isinstance(artifacts, (list, tuple)) or not 1 <= len(artifacts) <= 1000:
        raise SecurityError("LOCAL_MODEL_ARTIFACTS_REQUIRED")
    checked, names = [], set()
    for item in artifacts:
        if not isinstance(item, dict) or set(item) != {"relative_path", "sha256", "size_bytes"}:
            raise SecurityError("LOCAL_MODEL_ARTIFACT_INVALID")
        relative = _relative(item["relative_path"])
        if (not relative.startswith(directory + "/") or relative.casefold() in names
                or not isinstance(item["sha256"], str) or not re.fullmatch("[a-f0-9]{64}", item["sha256"])
                or type(item["size_bytes"]) is not int or not 0 < item["size_bytes"] <= 64 * 1024 ** 3):
            raise SecurityError("LOCAL_MODEL_ARTIFACT_INVALID")
        names.add(relative.casefold())
        checked.append(ModelArtifact(relative, item["sha256"], item["size_bytes"]))
    if not any(Path(artifact.relative_path).name.upper().startswith(("LICENSE", "NOTICE")) for artifact in checked):
        raise SecurityError("LOCAL_MODEL_LICENSE_ARTIFACT_REQUIRED")
    fields = {key: value[key] for key in required - {"attribution", "artifacts"}}
    return ModelRecord(**fields, attribution=tuple(attribution), artifacts=tuple(checked))


def validate_catalog(value: object, signed_files: dict | None = None) -> tuple[ModelRecord, ...]:
    if (not isinstance(value, dict) or set(value) != {"format", "models"}
            or value["format"] != CATALOG_FORMAT or not isinstance(value["models"], list)
            or not 1 <= len(value["models"]) <= 32):
        raise SecurityError("LOCAL_MODEL_CATALOG_INVALID")
    records = tuple(validate_model_record(record) for record in value["models"])
    if len({record.model_id for record in records}) != len(records):
        raise SecurityError("LOCAL_MODEL_DUPLICATE")
    if signed_files is not None:
        for record in records:
            for artifact in record.artifacts:
                expected = {"sha256": artifact.sha256, "sizeBytes": artifact.size_bytes}
                if signed_files.get(artifact.relative_path) != expected:
                    raise SecurityError("LOCAL_MODEL_UNSIGNED_ARTIFACT")
    return records


def verify_installed_catalog(root: Path, signed_files: dict) -> tuple[ModelRecord, ...]:
    if CATALOG_PATH not in signed_files:
        return ()  # Legacy presenter-only releases cannot satisfy local AI readiness.
    catalog = _safe(root / CATALOG_PATH, root)
    expected = signed_files[CATALOG_PATH]
    if (not catalog.is_file() or catalog.stat().st_size > 512 * 1024
            or catalog.stat().st_size != expected["sizeBytes"] or _hash_file(catalog) != expected["sha256"]):
        raise SecurityError("LOCAL_MODEL_CATALOG_INTEGRITY_FAILED")
    return validate_catalog(json.loads(catalog.read_bytes()), signed_files)


@dataclass(frozen=True)
class VerifiedLocalModel:
    record: ModelRecord
    managed_root: Path
    files: tuple[Path, ...]

    def directory(self) -> Path:
        return _safe(self.managed_root / self.record.relative_path, self.managed_root)

    def path(self, relative_path: str) -> Path:
        relative_path = _relative(relative_path)
        # Both full catalog-relative and model-directory-relative names are supported.
        full = relative_path if relative_path.startswith(self.record.relative_path + "/") else self.record.relative_path + "/" + relative_path
        if full not in {artifact.relative_path for artifact in self.record.artifacts}:
            raise SecurityError("LOCAL_MODEL_FILE_NOT_ALLOWED")
        return _safe(self.managed_root / full, self.managed_root)

    def verify_files(self) -> None:
        for artifact in self.record.artifacts:
            path = self.path(artifact.relative_path)
            if not path.is_file() or path.stat().st_size != artifact.size_bytes or _hash_file(path) != artifact.sha256:
                raise SecurityError("LOCAL_MODEL_INTEGRITY_FAILED")


class LocalModelManager:
    def __init__(self, components):
        self.components = components

    def resolve(self, model_id: str, kind: str) -> VerifiedLocalModel:
        root = self.components.runtime_root()
        if root is None:
            raise SecurityError("LOCAL_MODEL_RELEASE_NOT_READY")
        checked_root, files, _ = self.components._catalog()
        if root != checked_root:
            raise SecurityError("LOCAL_MODEL_RELEASE_CHANGED")
        records = verify_installed_catalog(root, files)
        record = next((item for item in records if item.model_id == model_id and item.kind == kind), None)
        if record is None:
            raise SecurityError("LOCAL_" + kind + "_MODEL_PENDING")
        result = VerifiedLocalModel(record, root, tuple(_safe(root / item.relative_path, root) for item in record.artifacts))
        result.verify_files()
        if self.components.runtime_root() != root:
            raise SecurityError("LOCAL_MODEL_RELEASE_CHANGED")
        return result

    def status(self) -> dict:
        root = self.components.runtime_root()
        if root is None:
            return {"ready": False, "status": "LOCAL_MODEL_RELEASE_NOT_READY"}
        _, files, _ = self.components._catalog()
        records = verify_installed_catalog(root, files)
        return {"ready": bool(records), "models": tuple(record.model_id for record in records)}
