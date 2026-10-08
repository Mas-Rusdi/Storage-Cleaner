#!/usr/bin/env python3
"""
Storage Audit & In-Place Cleaner (Python Edition)
-------------------------------------------------------------
Utilitas UI berbasis Python murni (tanpa dependensi pip)
Menggunakan modul native: http.server, os, hashlib, json, urllib.parse, pathlib
"""

import os
import sys
import json
import hashlib
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.parse

DEFAULT_PORT = int(os.environ.get("PORT", 3000))
DEFAULT_TARGET_FOLDER = "Downloads_Lab"
GIANT_FILE_THRESHOLD_BYTES = int(os.environ.get("GIANT_THRESHOLD_BYTES", 1024 * 1024 * 1024)) # 1 GB


def format_bytes(byte_count, decimals=2):
    if byte_count == 0:
        return "0 B"
    sizes = ["B", "KB", "MB", "GB", "TB", "PB"]
    k = 1024.0
    import math
    i = math.floor(math.log(byte_count) / math.log(k))
    idx = min(int(i), len(sizes) - 1)
    val = round(byte_count / (k ** idx), decimals)
    return f"{val} {sizes[idx]}"


def calculate_file_hash(file_path):
    sha256 = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            sha256.update(chunk)
    return sha256.hexdigest()


def audit_storage(target_path_input):
    target_path = Path(target_path_input)
    if not target_path.is_absolute():
        target_path = Path.cwd() / target_path

    resolved_target = target_path.resolve()
    if not resolved_target.exists():
        raise FileNotFoundError(f'Folder target tidak ditemukan: "{resolved_target}".')
    if not resolved_target.is_dir():
        raise NotADirectoryError(f'Path yang diberikan bukan sebuah folder direktori: "{resolved_target}".')

    raw_files = []
    for root, dirs, files in os.walk(resolved_target):
        for f in files:
            full_path = Path(root) / f
            try:
                stat = full_path.stat()
                raw_files.append({
                    "name": f,
                    "fullPath": str(full_path),
                    "sizeBytes": stat.st_size,
                    "mtimeMs": stat.st_mtime * 1000,
                    "isTemp": f.lower().endswith(".tmp")
                })
            except Exception as err:
                print(f"Peringatan: Gagal membaca file {full_path}: {err}", file=sys.stderr)

    total_bytes = 0
    giant_files = []
    temp_files = []
    hash_map = {}

    for file_info in raw_files:
        total_bytes += file_info["sizeBytes"]
        try:
            h = calculate_file_hash(file_info["fullPath"])
            file_info["sha256"] = h
            hash_map.setdefault(h, []).append(file_info)
        except Exception as err:
            file_info["sha256"] = None

        if file_info["sizeBytes"] >= GIANT_FILE_THRESHOLD_BYTES:
            giant_files.append({
                "name": file_info["name"],
                "fullPath": file_info["fullPath"],
                "sizeBytes": file_info["sizeBytes"],
                "formattedSize": format_bytes(file_info["sizeBytes"]),
                "sha256": file_info.get("sha256")
            })

        if file_info["isTemp"]:
            temp_files.append({
                "name": file_info["name"],
                "fullPath": file_info["fullPath"],
                "sizeBytes": file_info["sizeBytes"],
                "formattedSize": format_bytes(file_info["sizeBytes"])
            })

    giant_files.sort(key=lambda x: x["sizeBytes"], reverse=True)

    duplicate_groups = []
    potential_duplicate_savings = 0
    duplicate_candidate_paths = set()

    for h, group in hash_map.items():
        if len(group) > 1:
            group.sort(key=lambda x: (x["mtimeMs"], x["fullPath"]))
            original = group[0]
            copies = group[1:]
            group_savings = sum(f["sizeBytes"] for f in copies)
            potential_duplicate_savings += group_savings

            for c in copies:
                duplicate_candidate_paths.add(c["fullPath"])

            duplicate_groups.append({
                "sha256": h,
                "fileSize": original["sizeBytes"],
                "formattedFileSize": format_bytes(original["sizeBytes"]),
                "totalCopies": len(group),
                "potentialSavingsBytes": group_savings,
                "formattedPotentialSavings": format_bytes(group_savings),
                "files": [
                    {
                        "name": f["name"],
                        "fullPath": f["fullPath"],
                        "sizeBytes": f["sizeBytes"],
                        "formattedSize": format_bytes(f["sizeBytes"]),
                        "isOriginal": (idx == 0),
                        "isRemovableCopy": (idx > 0)
                    }
                    for idx, f in enumerate(group)
                ]
            })

    duplicate_groups.sort(key=lambda g: g["potentialSavingsBytes"], reverse=True)

    temp_savings = sum(tf["sizeBytes"] for tf in temp_files if tf["fullPath"] not in duplicate_candidate_paths)
    total_savings = potential_duplicate_savings + temp_savings

    return {
        "targetPath": str(resolved_target),
        "displayPath": target_path_input,
        "metrics": {
            "totalFiles": len(raw_files),
            "totalBytes": total_bytes,
            "formattedTotalBytes": format_bytes(total_bytes),
            "giantFilesCount": len(giant_files),
            "giantFilesBytes": sum(g["sizeBytes"] for g in giant_files),
            "formattedGiantFilesBytes": format_bytes(sum(g["sizeBytes"] for g in giant_files)),
            "duplicateGroupsCount": len(duplicate_groups),
            "duplicateCopiesCount": len(duplicate_candidate_paths),
            "tempFilesCount": len(temp_files),
            "potentialSavingsBytes": total_savings,
            "formattedPotentialSavings": format_bytes(total_savings)
        },
        "giantFiles": giant_files,
        "duplicateGroups": duplicate_groups,
        "tempFiles": temp_files
    }


def clean_storage_in_place(target_path_input):
    audit_data = audit_storage(target_path_input)
    resolved_target = Path(audit_data["targetPath"])

    deleted_files = []
    failed_files = []
    freed_bytes = 0

    to_delete = {}

    for g in audit_data["duplicateGroups"]:
        for f in g["files"]:
            if f["isRemovableCopy"]:
                to_delete[f["fullPath"]] = {
                    "name": f["name"],
                    "path": f["fullPath"],
                    "sizeBytes": f["sizeBytes"],
                    "reason": "Salinan duplikat (SHA-256 identik)"
                }

    for tf in audit_data["tempFiles"]:
        to_delete[tf["fullPath"]] = {
            "name": tf["name"],
            "path": tf["fullPath"],
            "sizeBytes": tf["sizeBytes"],
            "reason": "Berkas sementara (.tmp)"
        }

    for path_str, meta in to_delete.items():
        p = Path(path_str)
        try:
            # Validasi keamanan: in-place hanya di dalam target
            p.resolve().relative_to(resolved_target)
            p.unlink()
            freed_bytes += meta["sizeBytes"]
            deleted_files.append({
                "name": meta["name"],
                "path": path_str,
                "sizeBytes": meta["sizeBytes"],
                "formattedSize": format_bytes(meta["sizeBytes"]),
                "reason": meta["reason"]
            })
        except Exception as e:
            failed_files.append({
                "name": meta["name"],
                "path": path_str,
                "error": str(e)
            })

    updated_audit = audit_storage(target_path_input)

    return {
        "success": True,
        "targetPath": str(resolved_target),
        "freedBytes": freed_bytes,
        "formattedFreedBytes": format_bytes(freed_bytes),
        "totalDeletedCount": len(deleted_files),
        "totalFailedCount": len(failed_files),
        "deletedFiles": deleted_files,
        "failedFiles": failed_files,
        "updatedAudit": updated_audit
    }


class AuditRequestHandler(BaseHTTPRequestHandler):
    def send_json(self, status_code, data):
        payload = json.dumps(data).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/":
            # Baca file storage_audit.js untuk mengambil template HTML UI yang sama
            js_file = Path(__file__).parent / "storage_audit.js"
            html_ui = ""
            if js_file.exists():
                content = js_file.read_text(encoding="utf-8")
                start_marker = "return `<!DOCTYPE html>"
                end_marker = "</html>`;"
                start_idx = content.find(start_marker)
                end_idx = content.find(end_marker)
                if start_idx != -1 and end_idx != -1:
                    html_ui = content[start_idx + len("return `") : end_idx + len("</html>")]

            if not html_ui:
                html_ui = "<h1>Storage Audit UI</h1>"

            payload = html_ui.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return

        elif parsed.path == "/api/info":
            self.send_json(200, {
                "cwd": str(Path.cwd()),
                "defaultTarget": DEFAULT_TARGET_FOLDER,
                "platform": sys.platform
            })
            return

        self.send_json(404, {"error": "Endpoint tidak ditemukan"})

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        content_length = int(self.headers.get("Content-Length", 0))
        body_raw = self.rfile.read(content_length).decode("utf-8") if content_length > 0 else "{}"
        try:
            body = json.loads(body_raw)
        except Exception:
            body = {}

        target_path = body.get("targetPath", DEFAULT_TARGET_FOLDER)

        if parsed.path == "/api/scan":
            try:
                res = audit_storage(target_path)
                self.send_json(200, res)
            except Exception as err:
                self.send_json(400, {"error": str(err)})
            return

        elif parsed.path == "/api/clean":
            try:
                res = clean_storage_in_place(target_path)
                self.send_json(200, res)
            except Exception as err:
                self.send_json(400, {"error": str(err)})
            return

        self.send_json(404, {"error": "Endpoint tidak ditemukan"})


def run_server(port=DEFAULT_PORT):
    server = HTTPServer(("0.0.0.0", port), AuditRequestHandler)
    print("=" * 64)
    print("🚀 STORAGE AUDIT & CLEANER PRO (PYTHON EDITION)")
    print("=" * 64)
    print(f"📡 URL Web UI      : http://localhost:{port}")
    print(f"📁 Default Target  : {Path(DEFAULT_TARGET_FOLDER).resolve()}")
    print("⚡ Mode Pembersihan: In-Place (Langsung di tempat)")
    print("🛡️  Keamanan        : 1 file asli per grup duplikat dijaga aman")
    print("=" * 64 + "\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer dihentikan.")


if __name__ == "__main__":
    run_server()
