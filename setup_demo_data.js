/**
 * Skrip Generator Data Simulasi untuk Uji Coba Storage Audit
 * Membuat folder 'Downloads_Lab' dengan berkas duplikat identik,
 * berkas .tmp, dan struktur subfolder yang bervariasi.
 */

const fs = require('fs');
const path = require('path');

const targetDir = path.resolve(__dirname, 'Downloads_Lab');

const dummyContents = {
  modulPdf: 'PDF_DOKUMEN_SISTEM_OPERASI_LAB_2026_BERISI_MATERI_LENGKAP_STORAGE_AUDIT_DAN_OPTIMASI_'.repeat(100),
  laporanXlsx: 'XLSX_DATA_KEUANGAN_LAB_Q1_Q2_Q3_Q4_REKAPITULASI_ANGGARAN_'.repeat(80),
  catatanUnik: 'CATATAN_PRIBADI_TIDAK_ADA_DUPLIKAT_DALAM_SISTEM_'.repeat(20),
  tempCache1: 'TEMPORARY_CACHE_SESSION_DATA_DELETE_ME_01_'.repeat(30),
  tempCache2: 'TEMPORARY_CACHE_DOWNLOAD_PATCH_TEMP_DATA_02_'.repeat(40)
};

async function setup() {
  console.log(`Membuat struktur demo di: ${targetDir}`);

  // Buat folder jika belum ada
  await fs.promises.mkdir(path.join(targetDir, 'materi', 'backup'), { recursive: true });
  await fs.promises.mkdir(path.join(targetDir, 'laporan', 'salinan'), { recursive: true });
  await fs.promises.mkdir(path.join(targetDir, 'cache_system'), { recursive: true });

  // 1. Grup Duplikat 1: Modul Kuliah (3 salinan dengan nama & folder berbeda, isi identik)
  await fs.promises.writeFile(path.join(targetDir, 'materi', 'modul_sistem.pdf'), dummyContents.modulPdf);
  await fs.promises.writeFile(path.join(targetDir, 'materi', 'modul_sistem_BACKUP.pdf'), dummyContents.modulPdf);
  await fs.promises.writeFile(path.join(targetDir, 'materi', 'backup', 'modul_sistem_SALINAN_LAMA.pdf'), dummyContents.modulPdf);

  // 2. Grup Duplikat 2: Laporan Keuangan (2 salinan, isi identik)
  await fs.promises.writeFile(path.join(targetDir, 'laporan', 'laporan_tahunan.xlsx'), dummyContents.laporanXlsx);
  await fs.promises.writeFile(path.join(targetDir, 'laporan', 'salinan', 'laporan_tahunan_COPY.xlsx'), dummyContents.laporanXlsx);

  // 3. File Sampah Sementara (.tmp)
  await fs.promises.writeFile(path.join(targetDir, 'cache_system', 'temp_session_01.tmp'), dummyContents.tempCache1);
  await fs.promises.writeFile(path.join(targetDir, 'temp_download_patch.tmp'), dummyContents.tempCache2);

  // 4. File Unik (Bukan duplikat, bukan .tmp)
  await fs.promises.writeFile(path.join(targetDir, 'catatan_penting.txt'), dummyContents.catatanUnik);

  console.log('✅ Struktur demo Downloads_Lab berhasil dibuat!');
}

setup().catch(console.error);
