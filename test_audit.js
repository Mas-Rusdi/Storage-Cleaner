/**
 * Verifikasi Sistem Audit Penyimpanan (SRS Testing)
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { auditStorage, cleanStorageInPlace } = require('./storage_audit');

async function runTests() {
  console.log('--- MEMULAI UJI SISTEM STORAGE AUDIT ---');

  const targetDir = 'Downloads_Lab';

  // 1. Uji Audit Pemindaian
  console.log('1. Menguji fungsi auditStorage...');
  const auditResult = await auditStorage(targetDir);

  console.log(`- Total berkas ditemukan: ${auditResult.metrics.totalFiles}`);
  console.log(`- Total kapasitas: ${auditResult.metrics.formattedTotalBytes}`);
  console.log(`- Jumlah grup duplikat: ${auditResult.duplicateGroups.length}`);
  console.log(`- Jumlah salinan duplikat: ${auditResult.metrics.duplicateCopiesCount}`);
  console.log(`- Jumlah file .tmp: ${auditResult.metrics.tempFilesCount}`);
  console.log(`- Potensi hemat: ${auditResult.metrics.formattedPotentialSavings}`);

  assert.strictEqual(auditResult.metrics.totalFiles, 8, 'Harus ada 8 file di Downloads_Lab');
  assert.strictEqual(auditResult.duplicateGroups.length, 2, 'Harus ada 2 grup duplikat (modul & laporan)');
  assert.strictEqual(auditResult.metrics.duplicateCopiesCount, 3, 'Harus ada 3 salinan kembar (2 modul + 1 laporan)');
  assert.strictEqual(auditResult.metrics.tempFilesCount, 2, 'Harus ada 2 file .tmp');

  // Cek grup modul: 3 file total, 1 original, 2 removable copy
  const modulGroup = auditResult.duplicateGroups.find(g => g.totalCopies === 3);
  assert(modulGroup, 'Grup modul dengan 3 salinan harus terdeteksi');
  assert.strictEqual(modulGroup.files.filter(f => f.isOriginal).length, 1, 'Wajib tepat 1 file asli per grup');
  assert.strictEqual(modulGroup.files.filter(f => f.isRemovableCopy).length, 2, 'Harus 2 file salinan yang siap dihapus');

  console.log('✅ Uji audit pemindaian berhasil!');

  // 2. Uji Pembersihan In-Place
  console.log('\n2. Menguji fungsi cleanStorageInPlace...');
  const cleanResult = await cleanStorageInPlace(targetDir);

  console.log(`- Berhasil dibebaskan: ${cleanResult.formattedFreedBytes}`);
  console.log(`- Total file dihapus: ${cleanResult.totalDeletedCount}`);
  console.log(`- Total file gagal: ${cleanResult.totalFailedCount}`);

  assert.strictEqual(cleanResult.totalFailedCount, 0, 'Tidak boleh ada file gagal dihapus');
  // 3 salinan duplikat + 2 file .tmp = 5 file dihapus
  assert.strictEqual(cleanResult.totalDeletedCount, 5, 'Harus menghapus 5 file (3 duplikat + 2 .tmp)');

  // Verifikasi sisa file setelah pembersihan in-place
  const postAudit = cleanResult.updatedAudit;
  console.log(`- Sisa berkas setelah pembersihan: ${postAudit.metrics.totalFiles}`);
  // Harus tersisa 3 file: 1 modul asli, 1 laporan asli, 1 catatan_penting.txt
  assert.strictEqual(postAudit.metrics.totalFiles, 3, 'Harus tersisa tepat 3 file asli');
  assert.strictEqual(postAudit.duplicateGroups.length, 0, 'Tidak boleh ada grup duplikat yang tersisa');
  assert.strictEqual(postAudit.tempFiles.length, 0, 'Tidak boleh ada file .tmp yang tersisa');

  // Pastikan catatan_penting.txt masih ada
  const catatanPath = path.resolve(targetDir, 'catatan_penting.txt');
  assert(fs.existsSync(catatanPath), 'File unik catatan_penting.txt wajib tetap ada');

  console.log('✅ Uji pembersihan in-place berhasil tanpa merusak file asli!');
  console.log('\n🎉 SEMUA PENGUJIAN SRS BERHASIL 100%!');
}

runTests().catch(err => {
  console.error('❌ Uji coba gagal:', err);
  process.exit(1);
});
