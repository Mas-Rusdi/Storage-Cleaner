/**
 * Storage Audit & In-Place Cleaner Pro
 * -------------------------------------------------------------
 * Utilitas UI berbasis Node.js native (tanpa dependensi npm)
 * Menggunakan modul native: http, fs, path, crypto, os, child_process
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { exec } = require('child_process');

// Konfigurasi Standar
const DEFAULT_PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const DEFAULT_TARGET_FOLDER = 'Downloads_Lab';
const GIANT_FILE_THRESHOLD_BYTES = process.env.GIANT_THRESHOLD_BYTES
  ? parseInt(process.env.GIANT_THRESHOLD_BYTES, 10)
  : (1024 * 1024 * 1024); // 1 GB (1,073,741,824 bytes)

/**
 * Utilitas Format Ukuran Byte ke String yang Mudah Dibaca
 */
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const idx = Math.min(i, sizes.length - 1);
  return parseFloat((bytes / Math.pow(k, idx)).toFixed(dm)) + ' ' + sizes[idx];
}

/**
 * Menghitung Hash SHA-256 suatu berkas menggunakan Stream
 * Aman untuk file besar (>1 GB) tanpa membebani memori RAM
 */
function calculateFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
}

/**
 * Pemindaian Rekursif Folder
 */
async function scanDirectoryRecursively(dirPath, fileList = []) {
  let entries;
  try {
    entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    console.error(`Gagal membaca direktori: ${dirPath}`, err.message);
    return fileList;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    try {
      if (entry.isDirectory()) {
        if (!entry.isSymbolicLink()) {
          await scanDirectoryRecursively(fullPath, fileList);
        }
      } else if (entry.isFile()) {
        const stats = await fs.promises.stat(fullPath);
        fileList.push({
          name: entry.name,
          fullPath: path.resolve(fullPath),
          sizeBytes: stats.size,
          mtimeMs: stats.mtimeMs,
          birthtimeMs: stats.birthtimeMs || stats.mtimeMs,
          isTemp: entry.name.toLowerCase().endsWith('.tmp')
        });
      }
    } catch (err) {
      console.warn(`Peringatan: Gagal mengakses file ${fullPath}: ${err.message}`);
    }
  }

  return fileList;
}

/**
 * Mendapatkan Daftar Direktori untuk Penjelajah Folder (Directory Browser)
 */
async function getDirectoryListing(dirInput) {
  const homeDir = os.homedir();
  const cwd = process.cwd();

  let targetDir = dirInput ? path.resolve(dirInput) : cwd;

  try {
    const stat = await fs.promises.stat(targetDir);
    if (!stat.isDirectory()) {
      targetDir = path.dirname(targetDir);
    }
  } catch {
    targetDir = cwd;
  }

  let entries = [];
  try {
    const rawEntries = await fs.promises.readdir(targetDir, { withFileTypes: true });
    for (const ent of rawEntries) {
      if (ent.isDirectory() && !ent.name.startsWith('.')) {
        entries.push({
          name: ent.name,
          fullPath: path.join(targetDir, ent.name)
        });
      }
    }
  } catch (err) {
    console.warn(`Gagal membaca direktori: ${targetDir}`, err.message);
  }

  // Urutkan alfabetis
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  const parsed = path.parse(targetDir);
  const parentPath = targetDir === parsed.root ? null : path.dirname(targetDir);

  // Shortcut standar sistem yang mudah diakses pengguna tanpa mengetik
  const shortcuts = [
    { name: 'Downloads_Lab (Lab Default)', path: path.resolve(cwd, DEFAULT_TARGET_FOLDER), icon: '🧪' },
    { name: 'Folder Kerja Proyek', path: cwd, icon: '💼' },
    { name: 'Downloads Pengguna', path: path.join(homeDir, 'Downloads'), icon: '📥' },
    { name: 'Dokumen', path: path.join(homeDir, 'Documents'), icon: '📂' },
    { name: 'Desktop', path: path.join(homeDir, 'Desktop'), icon: '🖥️' },
    { name: 'Home User (~)', path: homeDir, icon: '🏠' }
  ];

  // Daftar drive jika di Windows
  const drives = [];
  if (os.platform() === 'win32') {
    const driveLetters = ['C', 'D', 'E', 'F', 'G'];
    for (const letter of driveLetters) {
      const driveRoot = `${letter}:\\`;
      if (fs.existsSync(driveRoot)) {
        drives.push(driveRoot);
      }
    }
  }

  return {
    currentPath: targetDir,
    parentPath,
    root: parsed.root,
    drives,
    shortcuts,
    directories: entries
  };
}

/**
 * Membuka Dialog Folder Bawaan Sistem Operasi (Windows FolderBrowserDialog)
 */
function openNativeFolderDialog() {
  return new Promise((resolve) => {
    if (os.platform() !== 'win32') {
      return resolve({ supported: false, selectedPath: null });
    }

    const psCommand = `powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Pilih Folder Target Penyimpanan untuk Diaudit'; if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }"`;

    exec(psCommand, { windowsHide: false }, (error, stdout) => {
      if (error) {
        return resolve({ supported: false, error: error.message, selectedPath: null });
      }
      const selectedPath = stdout.trim();
      resolve({ supported: true, selectedPath: selectedPath || null });
    });
  });
}

/**
 * Audit Utama Penyimpanan
 */
async function auditStorage(targetInputPath) {
  const resolvedTarget = path.isAbsolute(targetInputPath)
    ? path.normalize(targetInputPath)
    : path.resolve(process.cwd(), targetInputPath);

  // Verifikasi apakah direktori ada
  let stat;
  try {
    stat = await fs.promises.stat(resolvedTarget);
  } catch (err) {
    throw new Error(`Folder target tidak ditemukan: "${resolvedTarget}". Pastikan path valid.`);
  }

  if (!stat.isDirectory()) {
    throw new Error(`Path yang diberikan bukan sebuah folder direktori: "${resolvedTarget}"`);
  }

  // 1. Pindai seluruh file secara rekursif
  const rawFiles = await scanDirectoryRecursively(resolvedTarget);

  // 2. Kumpulkan hash SHA-256 untuk tiap file
  const filesWithHash = [];
  for (const file of rawFiles) {
    try {
      const sha256 = await calculateFileHash(file.fullPath);
      filesWithHash.push({
        ...file,
        sha256
      });
    } catch (err) {
      console.warn(`Gagal menghitung hash untuk ${file.fullPath}: ${err.message}`);
      filesWithHash.push({
        ...file,
        sha256: null,
        hashError: err.message
      });
    }
  }

  // 3. Klasifikasi Metrik & Analisis
  let totalBytes = 0;
  const giantFiles = [];
  const hashMap = new Map();
  const tempFiles = [];

  for (const file of filesWithHash) {
    totalBytes += file.sizeBytes;

    // File Raksasa (> 1 GB)
    if (file.sizeBytes >= GIANT_FILE_THRESHOLD_BYTES) {
      giantFiles.push({
        name: file.name,
        fullPath: file.fullPath,
        sizeBytes: file.sizeBytes,
        formattedSize: formatBytes(file.sizeBytes),
        sha256: file.sha256
      });
    }

    // File Sampah (.tmp)
    if (file.isTemp) {
      tempFiles.push({
        name: file.name,
        fullPath: file.fullPath,
        sizeBytes: file.sizeBytes,
        formattedSize: formatBytes(file.sizeBytes)
      });
    }

    // Kelompokkan berdasarkan SHA-256 untuk deteksi duplikat
    if (file.sha256) {
      if (!hashMap.has(file.sha256)) {
        hashMap.set(file.sha256, []);
      }
      hashMap.get(file.sha256).push(file);
    }
  }

  // Urutkan file raksasa dari yang terbesar
  giantFiles.sort((a, b) => b.sizeBytes - a.sizeBytes);

  // 4. Susun Grup Duplikat
  const duplicateGroups = [];
  let potentialDuplicateSavingsBytes = 0;
  const duplicateCandidatePaths = new Set();

  for (const [hash, groupFiles] of hashMap.entries()) {
    if (groupFiles.length > 1) {
      groupFiles.sort((a, b) => {
        if (a.birthtimeMs !== b.birthtimeMs) {
          return a.birthtimeMs - b.birthtimeMs;
        }
        return a.fullPath.localeCompare(b.fullPath);
      });

      const originalFile = groupFiles[0];
      const duplicates = groupFiles.slice(1);
      const groupFileSize = originalFile.sizeBytes;
      const groupSavings = duplicates.reduce((acc, f) => acc + f.sizeBytes, 0);

      potentialDuplicateSavingsBytes += groupSavings;
      duplicates.forEach((d) => duplicateCandidatePaths.add(d.fullPath));

      duplicateGroups.push({
        sha256: hash,
        fileSize: groupFileSize,
        formattedFileSize: formatBytes(groupFileSize),
        totalCopies: groupFiles.length,
        potentialSavingsBytes: groupSavings,
        formattedPotentialSavings: formatBytes(groupSavings),
        files: groupFiles.map((f, index) => ({
          name: f.name,
          fullPath: f.fullPath,
          sizeBytes: f.sizeBytes,
          formattedSize: formatBytes(f.sizeBytes),
          mtime: new Date(f.mtimeMs).toLocaleString(),
          isOriginal: index === 0,
          isRemovableCopy: index > 0
        }))
      });
    }
  }

  duplicateGroups.sort((a, b) => b.potentialSavingsBytes - a.potentialSavingsBytes);

  // 5. Potensi Hemat Bersih
  let tempSavingsBytes = 0;
  for (const tf of tempFiles) {
    if (!duplicateCandidatePaths.has(tf.fullPath)) {
      tempSavingsBytes += tf.sizeBytes;
    }
  }
  const totalPotentialSavingsBytes = potentialDuplicateSavingsBytes + tempSavingsBytes;

  return {
    targetPath: resolvedTarget,
    displayPath: targetInputPath,
    scannedAt: new Date().toISOString(),
    metrics: {
      totalFiles: filesWithHash.length,
      totalBytes: totalBytes,
      formattedTotalBytes: formatBytes(totalBytes),
      giantFilesCount: giantFiles.length,
      giantFilesBytes: giantFiles.reduce((acc, f) => acc + f.sizeBytes, 0),
      formattedGiantFilesBytes: formatBytes(giantFiles.reduce((acc, f) => acc + f.sizeBytes, 0)),
      duplicateGroupsCount: duplicateGroups.length,
      duplicateCopiesCount: duplicateCandidatePaths.size,
      tempFilesCount: tempFiles.length,
      potentialSavingsBytes: totalPotentialSavingsBytes,
      formattedPotentialSavings: formatBytes(totalPotentialSavingsBytes)
    },
    giantFiles,
    duplicateGroups,
    tempFiles
  };
}

/**
 * Pembersihan In-Place (Duplikat Salinan & File .tmp)
 */
async function cleanStorageInPlace(targetInputPath) {
  const auditResult = await auditStorage(targetInputPath);
  const resolvedTarget = auditResult.targetPath;

  const deletedFiles = [];
  const failedFiles = [];
  let freedBytes = 0;

  const filesToDeleteMap = new Map();

  for (const group of auditResult.duplicateGroups) {
    for (const f of group.files) {
      if (f.isRemovableCopy) {
        filesToDeleteMap.set(f.fullPath, {
          name: f.name,
          fullPath: f.fullPath,
          sizeBytes: f.sizeBytes,
          reason: 'Salinan duplikat (SHA-256 identik)'
        });
      }
    }
  }

  for (const tf of auditResult.tempFiles) {
    filesToDeleteMap.set(tf.fullPath, {
      name: tf.name,
      fullPath: tf.fullPath,
      sizeBytes: tf.sizeBytes,
      reason: 'Berkas sementara (.tmp)'
    });
  }

  for (const [targetFileToDelete, meta] of filesToDeleteMap.entries()) {
    const relative = path.relative(resolvedTarget, targetFileToDelete);
    const isInsideTarget = !relative.startsWith('..') && !path.isAbsolute(relative);

    if (!isInsideTarget) {
      failedFiles.push({
        path: targetFileToDelete,
        name: meta.name,
        error: 'Akses ditolak: File berada di luar target folder yang dipindai.'
      });
      continue;
    }

    try {
      await fs.promises.unlink(targetFileToDelete);
      freedBytes += meta.sizeBytes;
      deletedFiles.push({
        path: targetFileToDelete,
        name: meta.name,
        sizeBytes: meta.sizeBytes,
        formattedSize: formatBytes(meta.sizeBytes),
        reason: meta.reason
      });
    } catch (err) {
      failedFiles.push({
        path: targetFileToDelete,
        name: meta.name,
        error: err.message
      });
    }
  }

  const updatedAudit = await auditStorage(targetInputPath);

  return {
    success: true,
    targetPath: resolvedTarget,
    cleanedAt: new Date().toISOString(),
    freedBytes,
    formattedFreedBytes: formatBytes(freedBytes),
    totalDeletedCount: deletedFiles.length,
    totalFailedCount: failedFiles.length,
    deletedFiles,
    failedFiles,
    updatedAudit
  };
}

/**
 * Penyaji UI Web Responsif & Interaktif
 */
function getHtmlUI() {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Storage Audit & Cleaner Pro</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-base: #0b0f19;
      --bg-surface: #111827;
      --bg-card: rgba(17, 24, 39, 0.75);
      --bg-card-hover: rgba(24, 34, 53, 0.85);
      --border-subtle: rgba(255, 255, 255, 0.08);
      --border-highlight: rgba(99, 102, 241, 0.3);
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --text-dim: #64748b;
      --accent-indigo: #6366f1;
      --accent-indigo-glow: rgba(99, 102, 241, 0.25);
      --accent-cyan: #06b6d4;
      --accent-emerald: #10b981;
      --accent-emerald-glow: rgba(16, 185, 129, 0.2);
      --accent-rose: #f43f5e;
      --accent-rose-glow: rgba(244, 63, 94, 0.25);
      --accent-amber: #f59e0b;
      --radius-sm: 8px;
      --radius-md: 12px;
      --radius-lg: 18px;
      --radius-xl: 24px;
      --shadow-card: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background-color: var(--bg-base);
      background-image: 
        radial-gradient(at 0% 0%, rgba(99, 102, 241, 0.12) 0px, transparent 50%),
        radial-gradient(at 100% 0%, rgba(6, 182, 212, 0.1) 0px, transparent 50%),
        radial-gradient(at 50% 100%, rgba(16, 185, 129, 0.06) 0px, transparent 50%);
      background-attachment: fixed;
      color: var(--text-main);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      line-height: 1.5;
    }

    .container {
      width: 100%;
      max-width: 1200px;
      margin: 0 auto;
      padding: 28px 20px 80px;
    }

    /* HEADER */
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 28px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border-subtle);
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .brand-icon {
      width: 46px;
      height: 46px;
      border-radius: var(--radius-md);
      background: linear-gradient(135deg, var(--accent-indigo), var(--accent-cyan));
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 0 20px var(--accent-indigo-glow);
    }

    .brand-icon svg {
      width: 26px;
      height: 26px;
      fill: #ffffff;
    }

    .brand-text h1 {
      font-size: 1.35rem;
      font-weight: 800;
      letter-spacing: -0.02em;
      background: linear-gradient(to right, #ffffff, #cbd5e1);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .brand-text p {
      font-size: 0.8rem;
      color: var(--text-muted);
    }

    .badge-runtime {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 9999px;
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.25);
      font-size: 0.75rem;
      font-weight: 600;
      color: #34d399;
    }

    .badge-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 8px #10b981;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(0.9); }
    }

    /* CONTROL PANEL & FOLDER INPUT */
    .panel-card {
      background: var(--bg-card);
      backdrop-filter: blur(16px);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-xl);
      padding: 24px;
      box-shadow: var(--shadow-card);
      margin-bottom: 28px;
      transition: border-color 0.2s;
    }

    .panel-card:hover {
      border-color: rgba(255, 255, 255, 0.14);
    }

    .input-group-label {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }

    .input-group-label span {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--text-main);
    }

    .input-group-label .hint {
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    .folder-bar {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: stretch;
    }

    .input-wrapper {
      flex: 1;
      min-width: 260px;
      position: relative;
    }

    .input-icon {
      position: absolute;
      left: 14px;
      top: 50%;
      transform: translateY(-50%);
      width: 20px;
      height: 20px;
      color: var(--text-dim);
      pointer-events: none;
    }

    .input-path {
      width: 100%;
      padding: 13px 16px 13px 44px;
      background: rgba(15, 23, 42, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: var(--radius-md);
      color: #ffffff;
      font-size: 0.95rem;
      font-family: 'JetBrains Mono', monospace;
      outline: none;
      transition: all 0.2s ease;
    }

    .input-path:focus {
      border-color: var(--accent-indigo);
      box-shadow: 0 0 0 3px var(--accent-indigo-glow);
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 13px 20px;
      border-radius: var(--radius-md);
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      user-select: none;
      white-space: nowrap;
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none !important;
    }

    .btn-primary {
      background: linear-gradient(135deg, #4f46e5, #6366f1);
      color: #ffffff;
      box-shadow: 0 4px 14px var(--accent-indigo-glow);
    }

    .btn-primary:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(99, 102, 241, 0.4);
    }

    .btn-browse {
      background: linear-gradient(135deg, #0284c7, #06b6d4);
      color: #ffffff;
      box-shadow: 0 4px 14px rgba(6, 182, 212, 0.25);
    }

    .btn-browse:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(6, 182, 212, 0.4);
    }

    .btn-clean {
      background: linear-gradient(135deg, #e11d48, #f43f5e);
      color: #ffffff;
      box-shadow: 0 4px 14px var(--accent-rose-glow);
    }

    .btn-clean:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(244, 63, 94, 0.45);
    }

    .btn-ghost {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border-subtle);
      color: var(--text-muted);
    }

    .btn-ghost:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.1);
      color: var(--text-main);
    }

    .quick-tags {
      margin-top: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .quick-tag-label {
      font-size: 0.75rem;
      color: var(--text-dim);
    }

    .quick-tag {
      font-size: 0.75rem;
      padding: 4px 10px;
      border-radius: var(--radius-sm);
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border-subtle);
      color: var(--text-muted);
      cursor: pointer;
      font-family: 'JetBrains Mono', monospace;
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }

    .quick-tag:hover {
      background: rgba(99, 102, 241, 0.15);
      color: #a5b4fc;
      border-color: rgba(99, 102, 241, 0.4);
    }

    /* 4 METRIC CARDS */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 18px;
      margin-bottom: 28px;
    }

    .metric-card {
      background: var(--bg-card);
      backdrop-filter: blur(14px);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      padding: 20px;
      position: relative;
      overflow: hidden;
      box-shadow: var(--shadow-card);
      transition: all 0.25s ease;
    }

    .metric-card:hover {
      transform: translateY(-2px);
      border-color: rgba(255, 255, 255, 0.18);
    }

    .metric-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: var(--card-accent, var(--accent-indigo));
    }

    .metric-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .metric-title {
      font-size: 0.8rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
    }

    .metric-icon-wrap {
      width: 36px;
      height: 36px;
      border-radius: var(--radius-sm);
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.04);
      color: var(--card-accent, var(--text-main));
    }

    .metric-value {
      font-size: 1.85rem;
      font-weight: 800;
      letter-spacing: -0.03em;
      color: #ffffff;
      margin-bottom: 4px;
    }

    .metric-sub {
      font-size: 0.75rem;
      color: var(--text-dim);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    /* ACTION BAR */
    .action-banner {
      background: linear-gradient(135deg, rgba(30, 41, 59, 0.8), rgba(15, 23, 42, 0.9));
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      padding: 18px 24px;
      margin-bottom: 28px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }

    .action-info {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .action-icon {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: rgba(244, 63, 94, 0.15);
      border: 1px solid rgba(244, 63, 94, 0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--accent-rose);
      flex-shrink: 0;
    }

    .action-text h4 {
      font-size: 1rem;
      font-weight: 700;
      color: #ffffff;
    }

    .action-text p {
      font-size: 0.8rem;
      color: var(--text-muted);
    }

    /* TABS & SECTIONS */
    .tab-nav {
      display: flex;
      gap: 10px;
      border-bottom: 1px solid var(--border-subtle);
      margin-bottom: 22px;
      overflow-x: auto;
      padding-bottom: 6px;
    }

    .tab-btn {
      padding: 8px 16px;
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      color: var(--text-muted);
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s ease;
      white-space: nowrap;
    }

    .tab-btn:hover {
      color: var(--text-main);
    }

    .tab-btn.active {
      color: #ffffff;
      border-bottom-color: var(--accent-indigo);
    }

    .tab-badge {
      font-size: 0.7rem;
      padding: 2px 7px;
      border-radius: 9999px;
      background: rgba(255, 255, 255, 0.08);
      color: var(--text-muted);
    }

    .tab-btn.active .tab-badge {
      background: var(--accent-indigo);
      color: #ffffff;
    }

    /* ACCORDION DUPLIKAT */
    .accordion-item {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      margin-bottom: 12px;
      overflow: hidden;
      transition: border-color 0.2s;
    }

    .accordion-item:hover {
      border-color: rgba(255, 255, 255, 0.16);
    }

    .accordion-header {
      padding: 16px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      cursor: pointer;
      user-select: none;
      background: rgba(255, 255, 255, 0.015);
      transition: background 0.2s;
    }

    .accordion-header:hover {
      background: rgba(255, 255, 255, 0.04);
    }

    .accordion-title-wrap {
      display: flex;
      align-items: center;
      gap: 14px;
      flex: 1;
      min-width: 0;
    }

    .hash-badge {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.72rem;
      background: rgba(0, 0, 0, 0.4);
      padding: 3px 8px;
      border-radius: var(--radius-sm);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: #a5b4fc;
      white-space: nowrap;
    }

    .accordion-file-info {
      font-weight: 700;
      font-size: 0.92rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .accordion-meta {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-shrink: 0;
    }

    .pill-count {
      font-size: 0.75rem;
      padding: 3px 10px;
      border-radius: 9999px;
      background: rgba(244, 63, 94, 0.15);
      border: 1px solid rgba(244, 63, 94, 0.3);
      color: #fda4af;
      font-weight: 600;
    }

    .pill-savings {
      font-size: 0.75rem;
      padding: 3px 10px;
      border-radius: 9999px;
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #6ee7b7;
      font-weight: 600;
    }

    .accordion-chevron {
      width: 18px;
      height: 18px;
      transition: transform 0.25s ease;
      color: var(--text-dim);
    }

    .accordion-item.open .accordion-chevron {
      transform: rotate(180deg);
    }

    .accordion-body {
      display: none;
      padding: 0 20px 16px;
      border-top: 1px solid var(--border-subtle);
      background: rgba(11, 15, 25, 0.4);
    }

    .accordion-item.open .accordion-body {
      display: block;
    }

    .file-list {
      list-style: none;
      margin-top: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .file-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 10px 14px;
      border-radius: var(--radius-sm);
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.04);
      font-size: 0.85rem;
    }

    .file-row.original {
      border-left: 3px solid var(--accent-emerald);
      background: rgba(16, 185, 129, 0.03);
    }

    .file-row.duplicate {
      border-left: 3px solid var(--accent-rose);
      background: rgba(244, 63, 94, 0.03);
    }

    .file-left {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
      flex: 1;
    }

    .tag-status {
      font-size: 0.7rem;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 4px;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .tag-original {
      background: rgba(16, 185, 129, 0.2);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.4);
    }

    .tag-copy {
      background: rgba(244, 63, 94, 0.2);
      color: #fb7185;
      border: 1px solid rgba(244, 63, 94, 0.4);
    }

    .file-path {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.78rem;
      color: var(--text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .file-right {
      display: flex;
      align-items: center;
      gap: 14px;
      flex-shrink: 0;
      font-size: 0.78rem;
      color: var(--text-dim);
    }

    /* TABEL FILE RAKSASA & SAMPAH */
    .table-container {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      overflow-x: auto;
      box-shadow: var(--shadow-card);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 0.85rem;
    }

    th {
      background: rgba(255, 255, 255, 0.03);
      padding: 14px 18px;
      color: var(--text-muted);
      font-weight: 700;
      text-transform: uppercase;
      font-size: 0.75rem;
      letter-spacing: 0.04em;
      border-bottom: 1px solid var(--border-subtle);
    }

    td {
      padding: 14px 18px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      color: var(--text-main);
    }

    tr:last-child td {
      border-bottom: none;
    }

    tr:hover td {
      background: rgba(255, 255, 255, 0.02);
    }

    .giant-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.75rem;
      padding: 3px 9px;
      border-radius: 9999px;
      background: rgba(244, 63, 94, 0.15);
      border: 1px solid rgba(244, 63, 94, 0.35);
      color: #fda4af;
      font-weight: 700;
    }

    /* EMPTY STATE */
    .empty-state {
      padding: 50px 20px;
      text-align: center;
      color: var(--text-dim);
    }

    .empty-state svg {
      width: 48px;
      height: 48px;
      margin-bottom: 12px;
      opacity: 0.4;
    }

    .empty-state p {
      font-size: 0.95rem;
    }

    /* MODAL UMUM */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.78);
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 20px;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.25s ease;
    }

    .modal-overlay.open {
      opacity: 1;
      pointer-events: auto;
    }

    .modal-box {
      background: #131b2e;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: var(--radius-xl);
      max-width: 580px;
      width: 100%;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.85);
      transform: translateY(16px) scale(0.98);
      transition: transform 0.25s ease;
      overflow: hidden;
    }

    .modal-overlay.open .modal-box {
      transform: translateY(0) scale(1);
    }

    .modal-header {
      padding: 20px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--border-subtle);
    }

    .modal-header-left {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .modal-close-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 1.3rem;
      padding: 4px;
      line-height: 1;
    }

    .modal-close-btn:hover {
      color: #ffffff;
    }

    .modal-warning-icon {
      width: 44px;
      height: 44px;
      border-radius: var(--radius-md);
      background: rgba(244, 63, 94, 0.15);
      border: 1px solid rgba(244, 63, 94, 0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--accent-rose);
      flex-shrink: 0;
    }

    .modal-folder-icon {
      width: 44px;
      height: 44px;
      border-radius: var(--radius-md);
      background: rgba(6, 182, 212, 0.15);
      border: 1px solid rgba(6, 182, 212, 0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--accent-cyan);
      flex-shrink: 0;
    }

    .modal-header h3 {
      font-size: 1.15rem;
      font-weight: 800;
    }

    .modal-body {
      padding: 20px 24px;
    }

    .summary-box {
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: var(--radius-md);
      padding: 16px;
      margin: 16px 0;
    }

    .summary-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.85rem;
      padding: 6px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    }

    .summary-row:last-child {
      border-bottom: none;
      font-weight: 700;
      font-size: 0.95rem;
      color: #34d399;
      padding-top: 10px;
    }

    .modal-notice {
      font-size: 0.8rem;
      color: var(--text-muted);
      line-height: 1.5;
      background: rgba(99, 102, 241, 0.08);
      border-left: 3px solid var(--accent-indigo);
      padding: 10px 14px;
      border-radius: 4px;
      margin-top: 14px;
    }

    .modal-footer {
      padding: 16px 24px;
      background: rgba(0, 0, 0, 0.25);
      border-top: 1px solid var(--border-subtle);
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      align-items: center;
    }

    /* MODAL PENJELAJAH FOLDER (DIRECTORY BROWSER) */
    .browser-box {
      max-width: 720px;
    }

    .browser-nav-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      background: rgba(0, 0, 0, 0.4);
      border-radius: var(--radius-md);
      border: 1px solid rgba(255, 255, 255, 0.08);
      margin-bottom: 14px;
    }

    .btn-nav-up {
      padding: 6px 12px;
      border-radius: var(--radius-sm);
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid var(--border-subtle);
      color: var(--text-main);
      cursor: pointer;
      font-size: 0.8rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .btn-nav-up:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.16);
    }

    .btn-nav-up:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .browser-path-display {
      flex: 1;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.82rem;
      color: #93c5fd;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .browser-shortcuts {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }

    .shortcut-chip {
      padding: 5px 10px;
      border-radius: var(--radius-sm);
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border-subtle);
      font-size: 0.75rem;
      color: var(--text-muted);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s;
    }

    .shortcut-chip:hover {
      background: rgba(6, 182, 212, 0.15);
      border-color: rgba(6, 182, 212, 0.35);
      color: #67e8f9;
    }

    .browser-folder-list {
      max-height: 280px;
      overflow-y: auto;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: var(--radius-md);
      background: rgba(11, 15, 25, 0.5);
      padding: 6px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .folder-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 9px 14px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: all 0.15s ease;
      user-select: none;
    }

    .folder-item:hover {
      background: rgba(255, 255, 255, 0.06);
    }

    .folder-item.selected {
      background: rgba(99, 102, 241, 0.2);
      border: 1px solid rgba(99, 102, 241, 0.4);
    }

    .folder-item-left {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }

    .folder-item-left svg {
      width: 18px;
      height: 18px;
      color: #38bdf8;
      flex-shrink: 0;
    }

    .folder-item-name {
      font-size: 0.86rem;
      font-weight: 600;
      color: var(--text-main);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .folder-item-action {
      font-size: 0.75rem;
      color: var(--text-dim);
    }

    /* LOADING SPINNER */
    .spinner {
      width: 18px;
      height: 18px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-top-color: #ffffff;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* TOAST ALERT */
    .toast-container {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2000;
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-width: 420px;
    }

    .toast {
      padding: 14px 18px;
      border-radius: var(--radius-md);
      background: #1e293b;
      border: 1px solid rgba(255, 255, 255, 0.12);
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
      color: #ffffff;
      font-size: 0.85rem;
      display: flex;
      align-items: center;
      gap: 12px;
      animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .toast.success {
      border-left: 4px solid var(--accent-emerald);
    }

    .toast.error {
      border-left: 4px solid var(--accent-rose);
    }

    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }

    /* RESPONSIVE */
    @media (max-width: 768px) {
      .container { padding: 18px 14px; }
      .metrics-grid { grid-template-columns: 1fr; }
      .folder-bar { flex-direction: column; }
      .btn { width: 100%; }
      .accordion-header { flex-direction: column; align-items: flex-start; gap: 10px; }
      .accordion-meta { width: 100%; justify-content: space-between; }
    }
  </style>
</head>
<body>

  <!-- Hidden native browser directory input -->
  <input type="file" id="nativeDirPicker" webkitdirectory directory multiple style="display: none;" onchange="handleNativeBrowserDirSelected(event)">

  <div class="container">
    <!-- HEADER -->
    <header>
      <div class="brand">
        <div class="brand-icon">
          <svg viewBox="0 0 24 24">
            <path d="M4 4h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 8h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2zm2-6v2h2V6H6zm0 8v2h2v-2H6z"/>
          </svg>
        </div>
        <div class="brand-text">
          <h1>Storage Audit & Cleaner Pro</h1>
          <p>Auditor Penyimpanan Cerdas & Pembersih Duplikat In-Place</p>
        </div>
      </div>
      <div class="badge-runtime">
        <span class="badge-dot"></span>
        Node.js Native Engine
      </div>
    </header>

    <!-- FOLDER INPUT & ACTION BAR -->
    <section class="panel-card">
      <div class="input-group-label">
        <span>Path Folder Target Pemindaian</span>
        <span class="hint">Pilih folder dengan 1-klik atau jelajahi tanpa mengetik</span>
      </div>
      <div class="folder-bar">
        <div class="input-wrapper">
          <svg class="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          <input type="text" id="targetPathInput" class="input-path" value="Downloads_Lab" placeholder="Contoh: Downloads_Lab atau C:\\Users\\User\\Downloads" />
        </div>

        <!-- Tombol Tambah / Pilih Folder Tanpa Ketik -->
        <button id="browseFolderBtn" class="btn btn-browse" onclick="openFolderBrowserModal()" title="Buka penjelajah folder untuk memilih direktori tanpa mengetik">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            <line x1="12" y1="11" x2="12" y2="17"></line>
            <line x1="9" y1="14" x2="15" y2="14"></line>
          </svg>
          <span>Pilih Folder</span>
        </button>

        <!-- Tombol Pindai Folder -->
        <button id="scanBtn" class="btn btn-primary" onclick="startScan()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <span>Pindai Folder</span>
        </button>
      </div>

      <div class="quick-tags">
        <span class="quick-tag-label">Pintasan Cepat:</span>
        <button class="quick-tag" onclick="setFolderPath('Downloads_Lab')">🧪 Downloads_Lab (Default)</button>
        <button class="quick-tag" onclick="setFolderPath('.')">💼 Folder Kerja (.)</button>
        <button class="quick-tag" onclick="quickSelectCommon('Downloads')">📥 Downloads</button>
        <button class="quick-tag" onclick="quickSelectCommon('Documents')">📂 Documents</button>
        <button class="quick-tag" onclick="quickSelectCommon('Desktop')">🖥️ Desktop</button>
      </div>
    </section>

    <!-- METRICS CARDS -->
    <section class="metrics-grid">
      <!-- Total File -->
      <div class="metric-card" style="--card-accent: var(--accent-indigo);">
        <div class="metric-header">
          <span class="metric-title">Total Berkas</span>
          <div class="metric-icon-wrap">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
            </svg>
          </div>
        </div>
        <div class="metric-value" id="valTotalFiles">-</div>
        <div class="metric-sub">Dipindai secara rekursif</div>
      </div>

      <!-- Total Kapasitas -->
      <div class="metric-card" style="--card-accent: var(--accent-cyan);">
        <div class="metric-header">
          <span class="metric-title">Total Kapasitas</span>
          <div class="metric-icon-wrap">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
              <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
              <line x1="6" y1="6" x2="6.01" y2="6"></line>
              <line x1="6" y1="18" x2="6.01" y2="18"></line>
            </svg>
          </div>
        </div>
        <div class="metric-value" id="valTotalBytes">-</div>
        <div class="metric-sub" id="subTotalCapacity">Ruang penyimpanan terpakai</div>
      </div>

      <!-- File Raksasa (>1 GB) -->
      <div class="metric-card" style="--card-accent: var(--accent-rose);">
        <div class="metric-header">
          <span class="metric-title">File Raksasa (&gt; 1 GB)</span>
          <div class="metric-icon-wrap">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
            </svg>
          </div>
        </div>
        <div class="metric-value" id="valGiantFiles">-</div>
        <div class="metric-sub" id="subGiantFiles">Beban memori tinggi</div>
      </div>

      <!-- Potensi Hemat -->
      <div class="metric-card" style="--card-accent: var(--accent-emerald);">
        <div class="metric-header">
          <span class="metric-title">Potensi Hemat</span>
          <div class="metric-icon-wrap">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
              <polyline points="17 6 23 6 23 12"></polyline>
            </svg>
          </div>
        </div>
        <div class="metric-value" style="color: #34d399;" id="valSavings">-</div>
        <div class="metric-sub" id="subSavings">Duplikat kembar &amp; sampah .tmp</div>
      </div>
    </section>

    <!-- CLEANING ACTION BANNER -->
    <section class="action-banner" id="cleanBanner" style="display: none;">
      <div class="action-info">
        <div class="action-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </div>
        <div class="action-text">
          <h4 id="bannerTitle">Ditemukan Berkas Duplikat &amp; Sampah</h4>
          <p id="bannerDesc">Pembersihan dilakukan langsung di tempat (in-place) dengan mempertahankan 1 file asli per grup.</p>
        </div>
      </div>
      <button class="btn btn-clean" onclick="openCleanModal()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          <line x1="10" y1="11" x2="10" y2="17"></line>
          <line x1="14" y1="11" x2="14" y2="17"></line>
        </svg>
        <span>Bersihkan Duplikat &amp; Sampah</span>
      </button>
    </section>

    <!-- TAB NAVIGATION -->
    <div class="tab-nav">
      <button class="tab-btn active" onclick="switchTab('duplicates')">
        <span>Grup Duplikat Identik (SHA-256)</span>
        <span class="tab-badge" id="tabBadgeDuplicates">0</span>
      </button>
      <button class="tab-btn" onclick="switchTab('giants')">
        <span>File Raksasa (&gt; 1 GB)</span>
        <span class="tab-badge" id="tabBadgeGiants">0</span>
      </button>
      <button class="tab-btn" onclick="switchTab('temps')">
        <span>File Sampah (.tmp)</span>
        <span class="tab-badge" id="tabBadgeTemps">0</span>
      </button>
    </div>

    <!-- TAB CONTENT: DUPLICATES -->
    <div id="tabContentDuplicates">
      <div id="duplicateList">
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <p>Belum ada data pemindaian. Masukkan atau pilih path folder dan klik tombol <strong>Pindai Folder</strong>.</p>
        </div>
      </div>
    </div>

    <!-- TAB CONTENT: GIANT FILES -->
    <div id="tabContentGiants" style="display: none;">
      <div id="giantList" class="table-container"></div>
    </div>

    <!-- TAB CONTENT: TEMP FILES -->
    <div id="tabContentTemps" style="display: none;">
      <div id="tempList" class="table-container"></div>
    </div>

  </div>

  <!-- MODAL JELAJAHI & PILIH FOLDER (DIRECTORY BROWSER MODAL) -->
  <div class="modal-overlay" id="folderBrowserModal">
    <div class="modal-box browser-box">
      <div class="modal-header">
        <div class="modal-header-left">
          <div class="modal-folder-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
          </div>
          <div>
            <h3>Pilih Folder Target</h3>
            <p style="font-size: 0.8rem; color: var(--text-muted);">Pilih folder langsung tanpa perlu mengetik manual</p>
          </div>
        </div>
        <button class="modal-close-btn" onclick="closeFolderBrowserModal()">&times;</button>
      </div>

      <div class="modal-body">
        <!-- Navigasi Path & Tombol Naik Folder -->
        <div class="browser-nav-bar">
          <button id="btnNavUp" class="btn-nav-up" onclick="navigateParentFolder()">
            <span>⬆ Naik</span>
          </button>
          <div class="browser-path-display" id="browserCurrentPathText">-</div>
        </div>

        <!-- Tombol Pintasan Cepat & Opsi Dialog Sistem -->
        <div class="browser-shortcuts" id="browserShortcutsContainer">
          <!-- Diisi secara dinamis via JS -->
        </div>

        <!-- Tombol Tambahan: Buka Dialog Native Windows & Native File Picker -->
        <div style="display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap;">
          <button class="btn btn-ghost" style="padding: 7px 12px; font-size: 0.8rem;" onclick="triggerWindowsSystemDialog()">
            🖥️ Buka Dialog Windows
          </button>
          <button class="btn btn-ghost" style="padding: 7px 12px; font-size: 0.8rem;" onclick="document.getElementById('nativeDirPicker').click()">
            📂 Pilih dari File Explorer Browser
          </button>
        </div>

        <!-- Daftar Subfolder -->
        <div class="browser-folder-list" id="browserFolderList">
          <div style="padding: 20px; text-align: center; color: var(--text-dim);">Memuat daftar folder...</div>
        </div>
      </div>

      <div class="modal-footer">
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 0.75rem; color: var(--text-dim);">Folder Terpilih:</div>
          <div id="browserSelectedPreview" style="font-size: 0.82rem; font-family: 'JetBrains Mono', monospace; color: #a5b4fc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">-</div>
        </div>
        <button class="btn btn-ghost" onclick="closeFolderBrowserModal()">Batal</button>
        <button id="btnApplyFolder" class="btn btn-primary" onclick="applySelectedFolderAndScan()">
          <span>Gunakan &amp; Pindai</span>
        </button>
      </div>
    </div>
  </div>

  <!-- MODAL KONFIRMASI PEMBERSIHAN -->
  <div class="modal-overlay" id="cleanModal">
    <div class="modal-box">
      <div class="modal-header">
        <div class="modal-header-left">
          <div class="modal-warning-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
          </div>
          <div>
            <h3>Konfirmasi Pembersihan In-Place</h3>
            <p style="font-size: 0.8rem; color: var(--text-muted);">Tindakan ini akan menghapus file salinan permanen dari harddisk.</p>
          </div>
        </div>
        <button class="modal-close-btn" onclick="closeCleanModal()">&times;</button>
      </div>
      <div class="modal-body">
        <p style="font-size: 0.9rem; color: var(--text-main);">
          Sistem akan menghapus berkas salinan kembar dan berkas sementara (<code>.tmp</code>) langsung pada folder:
        </p>
        <div style="font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; padding: 8px 12px; background: rgba(0,0,0,0.4); border-radius: 6px; margin: 10px 0; word-break: break-all; color: #93c5fd;" id="modalTargetDir">
          -
        </div>

        <div class="summary-box">
          <div class="summary-row">
            <span>Salinan Duplikat yang Dihapus:</span>
            <span id="modalCopiesCount" style="color: #fda4af;">0 file</span>
          </div>
          <div class="summary-row">
            <span>File Sampah (.tmp) yang Dihapus:</span>
            <span id="modalTempsCount" style="color: #fcd34d;">0 file</span>
          </div>
          <div class="summary-row">
            <span>File Asli yang Aman Dipertahankan:</span>
            <span id="modalKeepCount" style="color: #34d399;">1 file per grup duplikat</span>
          </div>
          <div class="summary-row">
            <span>Estimasi Ruang Dibebaskan:</span>
            <span id="modalSavingsSize">0 B</span>
          </div>
        </div>

        <div class="modal-notice">
          <strong>Keamanan Eksekusi In-Place:</strong> 1 berkas asli per grup duplikat ber-hash identik DIJAMIN tetap dipertahankan. Sistem TIDAK membuat salinan baru ataupun memindahkan file ke folder lain.
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeCleanModal()">Batal</button>
        <button id="btnExecuteClean" class="btn btn-clean" onclick="executeClean()">
          <span>Ya, Bersihkan Sekarang</span>
        </button>
      </div>
    </div>
  </div>

  <!-- TOAST CONTAINER -->
  <div class="toast-container" id="toastContainer"></div>

  <script>
    let currentAuditData = null;
    let browserState = {
      currentPath: '',
      parentPath: null,
      selectedPath: ''
    };

    function setFolderPath(pathVal) {
      document.getElementById('targetPathInput').value = pathVal;
      startScan();
    }

    async function quickSelectCommon(targetName) {
      try {
        const res = await fetch('/api/browse');
        const data = await res.json();
        const found = data.shortcuts.find(s => s.name.toLowerCase().includes(targetName.toLowerCase()));
        if (found) {
          setFolderPath(found.path);
        } else {
          setFolderPath(targetName);
        }
      } catch {
        setFolderPath(targetName);
      }
    }

    function showToast(message, type = 'success') {
      const container = document.getElementById('toastContainer');
      const toast = document.createElement('div');
      toast.className = 'toast ' + type;
      toast.innerHTML = '<span>' + message + '</span>';
      container.appendChild(toast);
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
      }, 4000);
    }

    function switchTab(tabName) {
      document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
      document.getElementById('tabContentDuplicates').style.display = 'none';
      document.getElementById('tabContentGiants').style.display = 'none';
      document.getElementById('tabContentTemps').style.display = 'none';

      if (tabName === 'duplicates') {
        event.currentTarget.classList.add('active');
        document.getElementById('tabContentDuplicates').style.display = 'block';
      } else if (tabName === 'giants') {
        event.currentTarget.classList.add('active');
        document.getElementById('tabContentGiants').style.display = 'block';
      } else if (tabName === 'temps') {
        event.currentTarget.classList.add('active');
        document.getElementById('tabContentTemps').style.display = 'block';
      }
    }

    /* === DIRECTORY BROWSER MODAL FUNCTIONS === */
    async function openFolderBrowserModal() {
      const modal = document.getElementById('folderBrowserModal');
      modal.classList.add('open');
      const currentVal = document.getElementById('targetPathInput').value.trim();
      await fetchDirectory(currentVal || '');
    }

    function closeFolderBrowserModal() {
      document.getElementById('folderBrowserModal').classList.remove('open');
    }

    async function fetchDirectory(dirPath) {
      const listEl = document.getElementById('browserFolderList');
      listEl.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--text-muted);"><div class="spinner" style="margin: 0 auto 8px;"></div>Memuat direktori...</div>';

      try {
        const url = '/api/browse' + (dirPath ? ('?dir=' + encodeURIComponent(dirPath)) : '');
        const res = await fetch(url);
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Gagal memuat direktori');
        }

        browserState.currentPath = data.currentPath;
        browserState.parentPath = data.parentPath;
        browserState.selectedPath = data.currentPath;

        document.getElementById('browserCurrentPathText').textContent = data.currentPath;
        document.getElementById('browserSelectedPreview').textContent = data.currentPath;
        document.getElementById('btnNavUp').disabled = !data.parentPath;

        // Render Shortcuts & Drives
        renderShortcuts(data.shortcuts, data.drives);

        // Render Subdirectories
        renderFolderList(data.directories);

      } catch (err) {
        listEl.innerHTML = '<div style="padding: 20px; text-align: center; color: #fb7185;">' + escapeHtml(err.message) + '</div>';
      }
    }

    function renderShortcuts(shortcuts, drives) {
      const container = document.getElementById('browserShortcutsContainer');
      let html = '';

      if (drives && drives.length > 0) {
        drives.forEach(drive => {
          html += \`<button class="shortcut-chip" onclick="fetchDirectory('\${escapeHtml(drive)}')">💾 \${escapeHtml(drive)}</button>\`;
        });
      }

      if (shortcuts && shortcuts.length > 0) {
        shortcuts.forEach(s => {
          html += \`<button class="shortcut-chip" onclick="fetchDirectory('\${escapeHtml(s.path)}')">\${s.icon || '📁'} \${escapeHtml(s.name)}</button>\`;
        });
      }

      container.innerHTML = html;
    }

    function renderFolderList(dirs) {
      const listEl = document.getElementById('browserFolderList');
      if (!dirs || dirs.length === 0) {
        listEl.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--text-dim);">Tidak ada subfolder di direktori ini. Anda dapat langsung memilih folder saat ini.</div>';
        return;
      }

      let html = '';
      dirs.forEach(d => {
        html += \`
          <div class="folder-item" onclick="selectFolderItem('\${escapeHtml(d.fullPath)}', this)" ondblclick="fetchDirectory('\${escapeHtml(d.fullPath)}')">
            <div class="folder-item-left">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              </svg>
              <span class="folder-item-name">\${escapeHtml(d.name)}</span>
            </div>
            <span class="folder-item-action">Klik 2x untuk masuk</span>
          </div>
        \`;
      });

      listEl.innerHTML = html;
    }

    function selectFolderItem(folderPath, element) {
      document.querySelectorAll('.folder-item').forEach(el => el.classList.remove('selected'));
      if (element) element.classList.add('selected');
      browserState.selectedPath = folderPath;
      document.getElementById('browserSelectedPreview').textContent = folderPath;
    }

    function navigateParentFolder() {
      if (browserState.parentPath) {
        fetchDirectory(browserState.parentPath);
      }
    }

    function applySelectedFolderAndScan() {
      const chosen = browserState.selectedPath || browserState.currentPath;
      if (chosen) {
        document.getElementById('targetPathInput').value = chosen;
        closeFolderBrowserModal();
        startScan();
      }
    }

    async function triggerWindowsSystemDialog() {
      showToast('Membuka kotak dialog folder Windows...', 'success');
      try {
        const res = await fetch('/api/pick-folder-dialog', { method: 'POST' });
        const data = await res.json();
        if (data.selectedPath) {
          document.getElementById('targetPathInput').value = data.selectedPath;
          closeFolderBrowserModal();
          showToast('Folder terpilih: ' + data.selectedPath, 'success');
          startScan();
        } else if (data.supported === false) {
          showToast('Dialog Windows tidak tersedia di lingkungan ini. Gunakan penjelajah folder bawaan.', 'error');
        }
      } catch (err) {
        showToast('Gagal membuka dialog sistem: ' + err.message, 'error');
      }
    }

    function handleNativeBrowserDirSelected(event) {
      const files = event.target.files;
      if (files && files.length > 0) {
        const sampleFile = files[0];
        // Ekstrak nama folder dari webkitRelativePath
        const relPath = sampleFile.webkitRelativePath;
        if (relPath) {
          const folderName = relPath.split('/')[0];
          document.getElementById('targetPathInput').value = folderName;
          closeFolderBrowserModal();
          showToast('Folder "' + folderName + '" terpilih dari browser. Memulai pemindaian...', 'success');
          startScan();
        }
      }
    }

    /* === SCANNING & AUDIT FUNCTIONS === */
    async function startScan() {
      const input = document.getElementById('targetPathInput');
      const targetPath = input.value.trim();
      const scanBtn = document.getElementById('scanBtn');

      if (!targetPath) {
        showToast('Harap masukkan atau pilih path folder target!', 'error');
        return;
      }

      scanBtn.disabled = true;
      scanBtn.innerHTML = '<div class="spinner"></div><span>Memindai...</span>';

      try {
        const response = await fetch('/api/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetPath })
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Terjadi kesalahan saat memindai.');
        }

        currentAuditData = data;
        renderDashboard(data);
        showToast('Pemindaian berhasil diselesaikan!', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        scanBtn.disabled = false;
        scanBtn.innerHTML = \`
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <span>Pindai Folder</span>
        \`;
      }
    }

    function renderDashboard(data) {
      const m = data.metrics;
      document.getElementById('valTotalFiles').textContent = m.totalFiles.toLocaleString();
      document.getElementById('valTotalBytes').textContent = m.formattedTotalBytes;
      document.getElementById('valGiantFiles').textContent = m.giantFilesCount.toLocaleString();
      document.getElementById('subGiantFiles').textContent = m.giantFilesCount > 0 ? (m.formattedGiantFilesBytes + ' total') : 'Tidak ada file > 1 GB';
      document.getElementById('valSavings').textContent = m.formattedPotentialSavings;
      document.getElementById('subSavings').textContent = \`\${m.duplicateCopiesCount} duplikat, \${m.tempFilesCount} file .tmp\`;

      document.getElementById('tabBadgeDuplicates').textContent = data.duplicateGroups.length;
      document.getElementById('tabBadgeGiants').textContent = data.giantFiles.length;
      document.getElementById('tabBadgeTemps').textContent = data.tempFiles.length;

      const cleanBanner = document.getElementById('cleanBanner');
      if (m.potentialSavingsBytes > 0) {
        cleanBanner.style.display = 'flex';
        document.getElementById('bannerTitle').textContent = \`Ditemukan \${m.duplicateCopiesCount} Salinan Duplikat & \${m.tempFilesCount} File Sementara\`;
        document.getElementById('bannerDesc').textContent = \`Potensi penghematan: \${m.formattedPotentialSavings}. Pembersihan dilakukan in-place tanpa menghapus berkas asli.\`;
      } else {
        cleanBanner.style.display = 'none';
      }

      renderDuplicates(data.duplicateGroups);
      renderGiants(data.giantFiles);
      renderTemps(data.tempFiles);
    }

    function renderDuplicates(groups) {
      const container = document.getElementById('duplicateList');
      if (!groups || groups.length === 0) {
        container.innerHTML = \`
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
            <p>Hebat! Tidak ditemukan berkas duplikat ber-hash identik di folder ini.</p>
          </div>
        \`;
        return;
      }

      let html = '';
      groups.forEach((group, index) => {
        const shortHash = group.sha256.substring(0, 14) + '...';
        const isOpen = index === 0 ? 'open' : '';
        html += \`
          <div class="accordion-item \${isOpen}" id="acc-item-\${index}">
            <div class="accordion-header" onclick="toggleAccordion(\${index})">
              <div class="accordion-title-wrap">
                <span class="hash-badge" title="SHA-256: \${group.sha256}">SHA: \${shortHash}</span>
                <span class="accordion-file-info">\${escapeHtml(group.files[0].name)}</span>
              </div>
              <div class="accordion-meta">
                <span class="pill-count">\${group.totalCopies} Berkas Identik</span>
                <span class="pill-savings">Hemat: \${group.formattedPotentialSavings}</span>
                <svg class="accordion-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>
            </div>
            <div class="accordion-body">
              <ul class="file-list">
                \${group.files.map(f => \`
                  <li class="file-row \${f.isOriginal ? 'original' : 'duplicate'}">
                    <div class="file-left">
                      \${f.isOriginal 
                        ? '<span class="tag-status tag-original">✓ ASLI (DIJAGA)</span>' 
                        : '<span class="tag-status tag-copy">✕ SALINAN KEMBAR</span>'
                      }
                      <span class="file-path" title="\${escapeHtml(f.fullPath)}">\${escapeHtml(f.fullPath)}</span>
                    </div>
                    <div class="file-right">
                      <span>\${f.formattedSize}</span>
                      <span>\${f.mtime}</span>
                    </div>
                  </li>
                \`).join('')}
              </ul>
            </div>
          </div>
        \`;
      });
      container.innerHTML = html;
    }

    function toggleAccordion(index) {
      const item = document.getElementById('acc-item-' + index);
      if (item) item.classList.toggle('open');
    }

    function renderGiants(giants) {
      const container = document.getElementById('giantList');
      if (!giants || giants.length === 0) {
        container.innerHTML = \`
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10 9 9 9 8 9"></polyline>
            </svg>
            <p>Tidak ada berkas yang ukurannya melebihi ambang batas 1 GB.</p>
          </div>
        \`;
        return;
      }

      let html = \`
        <table>
          <thead>
            <tr>
              <th>Nama Berkas</th>
              <th>Status</th>
              <th>Ukuran</th>
              <th>Path Lengkap</th>
            </tr>
          </thead>
          <tbody>
      \`;

      giants.forEach(g => {
        html += \`
          <tr>
            <td style="font-weight: 700;">\${escapeHtml(g.name)}</td>
            <td><span class="giant-pill">FILE RAKSASA (&gt; 1 GB)</span></td>
            <td style="font-weight: 700; color: #fb7185;">\${g.formattedSize}</td>
            <td style="font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; color: var(--text-muted);">\${escapeHtml(g.fullPath)}</td>
          </tr>
        \`;
      });

      html += \`</tbody></table>\`;
      container.innerHTML = html;
    }

    function renderTemps(temps) {
      const container = document.getElementById('tempList');
      if (!temps || temps.length === 0) {
        container.innerHTML = \`
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            <p>Bersih! Tidak ada berkas sementara (.tmp) yang terdeteksi.</p>
          </div>
        \`;
        return;
      }

      let html = \`
        <table>
          <thead>
            <tr>
              <th>Nama Berkas</th>
              <th>Tipe</th>
              <th>Ukuran</th>
              <th>Path Lengkap</th>
            </tr>
          </thead>
          <tbody>
      \`;

      temps.forEach(t => {
        html += \`
          <tr>
            <td style="font-weight: 600;">\${escapeHtml(t.name)}</td>
            <td><span class="pill-count" style="background: rgba(245, 158, 11, 0.15); border-color: rgba(245, 158, 11, 0.3); color: #fcd34d;">BERKAS .TMP</span></td>
            <td style="font-weight: 600;">\${t.formattedSize}</td>
            <td style="font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; color: var(--text-muted);">\${escapeHtml(t.fullPath)}</td>
          </tr>
        \`;
      });

      html += \`</tbody></table>\`;
      container.innerHTML = html;
    }

    function openCleanModal() {
      if (!currentAuditData) return;
      const m = currentAuditData.metrics;
      document.getElementById('modalTargetDir').textContent = currentAuditData.targetPath;
      document.getElementById('modalCopiesCount').textContent = m.duplicateCopiesCount + ' berkas';
      document.getElementById('modalTempsCount').textContent = m.tempFilesCount + ' berkas';
      document.getElementById('modalSavingsSize').textContent = m.formattedPotentialSavings;
      document.getElementById('cleanModal').classList.add('open');
    }

    function closeCleanModal() {
      document.getElementById('cleanModal').classList.remove('open');
    }

    async function executeClean() {
      if (!currentAuditData) return;
      const btn = document.getElementById('btnExecuteClean');
      btn.disabled = true;
      btn.innerHTML = '<div class="spinner"></div><span>Membersihkan In-Place...</span>';

      try {
        const response = await fetch('/api/clean', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetPath: currentAuditData.targetPath })
        });

        const resData = await response.json();
        if (!response.ok) {
          throw new Error(resData.error || 'Gagal mengeksekusi pembersihan.');
        }

        closeCleanModal();
        showToast(\`Berhasil membebaskan \${resData.formattedFreedBytes} ruang disk (\${resData.totalDeletedCount} file dihapus in-place)!\`, 'success');

        if (resData.updatedAudit) {
          currentAuditData = resData.updatedAudit;
          renderDashboard(resData.updatedAudit);
        } else {
          startScan();
        }
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>Ya, Bersihkan Sekarang</span>';
      }
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    window.addEventListener('DOMContentLoaded', () => {
      startScan();
    });
  </script>
</body>
</html>`;
}

/**
 * Server HTTP Native
 */
function createAuditServer(port = DEFAULT_PORT) {
  const server = http.createServer(async (req, res) => {
    // Parse URL dengan aman
    const baseURL = `http://${req.headers.host || 'localhost'}`;
    const parsedUrl = new URL(req.url, baseURL);
    const pathname = parsedUrl.pathname;
    const method = req.method.toUpperCase();

    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Helper pembaca body JSON
    const readBody = () => new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 5 * 1024 * 1024) {
          reject(new Error('Request body terlalu besar (maksimal 5MB)'));
        }
      });
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch {
          reject(new Error('Format JSON tidak valid'));
        }
      });
      req.on('error', reject);
    });

    // 1. Web UI Dashboard
    if (pathname === '/' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getHtmlUI());
      return;
    }

    // 2. Directory Browser API
    if (pathname === '/api/browse' && method === 'GET') {
      try {
        const queryDir = parsedUrl.searchParams.get('dir') || '';
        const listing = await getDirectoryListing(queryDir);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(listing));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // 3. Native Windows Folder Picker Dialog API
    if (pathname === '/api/pick-folder-dialog' && method === 'POST') {
      try {
        const dialogResult = await openNativeFolderDialog();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(dialogResult));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // 4. Scan API
    if (pathname === '/api/scan' && method === 'POST') {
      try {
        const body = await readBody();
        const targetPath = body.targetPath || DEFAULT_TARGET_FOLDER;
        const result = await auditStorage(targetPath);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // 5. Clean API
    if (pathname === '/api/clean' && method === 'POST') {
      try {
        const body = await readBody();
        const targetPath = body.targetPath || DEFAULT_TARGET_FOLDER;
        const result = await cleanStorageInPlace(targetPath);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // 6. Info API
    if (pathname === '/api/info' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        cwd: process.cwd(),
        defaultTarget: DEFAULT_TARGET_FOLDER,
        giantFileThresholdBytes: GIANT_FILE_THRESHOLD_BYTES,
        platform: os.platform()
      }));
      return;
    }

    // 404 Handler
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint tidak ditemukan' }));
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port ${port} sedang digunakan. Mencoba port ${port + 1}...`);
      server.listen(port + 1);
    } else {
      console.error('Terjadi kesalahan pada server:', err);
    }
  });

  server.listen(port, () => {
    const activePort = server.address().port;
    console.log('================================================================');
    console.log('🚀 STORAGE AUDIT & CLEANER PRO BERHASIL DIJALANKAN');
    console.log('================================================================');
    console.log(`📡 URL Web UI      : http://localhost:${activePort}`);
    console.log(`📁 Default Target  : ${path.resolve(process.cwd(), DEFAULT_TARGET_FOLDER)}`);
    console.log(`⚡ Mode Pembersihan: In-Place (Langsung di tempat)`);
    console.log(`🛡️  Keamanan        : 1 file asli per grup duplikat dijaga aman`);
    console.log(`📂 Penjelajah Folder: Tombol "Pilih Folder" aktif di antarmuka Web UI`);
    console.log('================================================================\n');
  });

  return server;
}

// Jalankan server jika dieksekusi langsung
if (require.main === module) {
  createAuditServer(DEFAULT_PORT);
}

module.exports = {
  createAuditServer,
  auditStorage,
  cleanStorageInPlace,
  getDirectoryListing,
  openNativeFolderDialog,
  calculateFileHash,
  formatBytes
};
