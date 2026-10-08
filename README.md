# Storage Audit & In-Place Cleaner Pro 🚀

Aplikasi utilitas audit penyimpanan lokal cerdas berbasis web UI yang ringan, responsif, dan zero-dependency (menggunakan modul native Node.js tanpa `npm install`).

---

## 🌟 Fitur Utama (Sesuai Spesifikasi SRS)

1. **Input Path Folder Dinamis & Tombol "Pilih Folder" (Tanpa Ketik Manual)**:
   - Dilengkapi tombol interaktif **"📁 Pilih Folder"** tepat di samping bilah input.
   - **Modal Penjelajah Folder (Directory Browser)**: Memungkinkan penelusuran folder sistem secara visual, klik 2x untuk masuk subfolder, navigasi naik level (⬆), serta memilih folder dengan 1-klik.
   - **Pintasan Cepat Direktori**: Tombol pintas 1-klik untuk `Downloads_Lab (Default)`, `Folder Proyek`, `Downloads`, `Documents`, dan `Desktop`.
   - **Integrasi Dialog Sistem Operasi**: Mendukung pembukaan kotak dialog bawaan Windows (`System.Windows.Forms.FolderBrowserDialog`) dan File Explorer browser (`webkitdirectory`).
   - Tetap mendukung input manual jika pengguna ingin menyalin path absolut atau relatif kustom.

2. **Pemindaian Rekursif & Hashing SHA-256**:
   - Memindai target folder dan seluruh subfoldernya secara rekursif.
   - Menghitung hash SHA-256 berbasis stream secara efisien (hemat RAM bahkan untuk file berukuran sangat besar).

3. **Pengelompokan Duplikat Identik**:
   - Mendeteksi dan mengelompokkan berkas dengan SHA-256 yang identik meskipun nama file atau letak foldernya berbeda (misal `modul.pdf` dan `modul_BACKUP.pdf`).
   - Secara otomatis menandai 1 berkas tertua sebagai file asli (`Original - Dijaga`) dan berkas lainnya sebagai salinan kembar (`Removable Duplicate Copy`).

4. **Deteksi Berkas Raksasa (> 1 GB)**:
   - Mengidentifikasi berkas berukuran besar yang melebihi ambang batas 1 GB (1,073,741,824 byte) dan menampilkannya dalam tabel khusus.

5. **Dashboard Visual Responsif & Modern**:
   - Tampilan antarmuka berestetika tinggi (Dark glassmorphism theme, font modern, transisi halus).
   - **4 Kartu Metrik Storage**:
     - *Total Berkas*: Jumlah seluruh file yang dipindai.
     - *Total Kapasitas*: Ukuran total penyimpanan terpakai.
     - *File Raksasa*: Jumlah & total ukuran file > 1 GB.
     - *Potensi Hemat*: Ruang yang dapat dibebaskan dari duplikat kembar & berkas sampah.
   - **Accordion Duplikat Interaktif**:
     - Pratinjau badge SHA-256 hash.
     - Detail daftar berkas dengan status `✓ ASLI (DIJAGA)` dan `✕ SALINAN KEMBAR`.
   - **Tabel Berkas Raksasa & Berkas Sampah (.tmp)**.

6. **Pembersihan In-Place Berdampak Langsung**:
   - Pembersihan dieksekusi langsung di tempat (*in-place*, tanpa membuat salinan baru atau memindahkan folder).
   - Modal konfirmasi interaktif dengan rincian berkas yang akan dihapus dan perkiraan ruang disk yang dibebaskan.
   - **Jaminan Keamanan**: Hanya menghapus salinan kembar dan file `.tmp`, serta **wajib mempertahankan 1 file asli** per grup duplikat.

---

## 📂 Struktur Berkas

```
Storage-Cleaner/
├── storage_audit.js       # Aplikasi utama (Node.js HTTP Server + Web UI terpadu)
├── storage_audit.py       # Edisi Python alternatif (menggunakan library standar Python)
├── setup_demo_data.js     # Pembuat dataset simulasi di folder 'Downloads_Lab'
├── test_audit.js          # Skrip verifikasi & unit test fungsional SRS
├── Downloads_Lab/         # Folder lab default untuk pengujian audit & pembersihan
└── README.md              # Dokumentasi lengkap proyek
```

---

## 🚀 Cara Menjalankan

### 1. Menjalankan Server Aplikasi (Node.js)

Pastikan Node.js telah terpasang di komputer Anda (Node v16+ didukung). Cukup jalankan perintah berikut di terminal:

```powershell
node storage_audit.js
```

Aplikasi akan otomatis menyajikan Web UI di browser Anda:
👉 **[http://localhost:3000](http://localhost:3000)**

*(Jika port 3000 sedang terpakai, sistem akan otomatis beralih ke port berikutnya seperti 3001).*

---

### 2. Mempersiapkan Data Uji Simulasi (`Downloads_Lab`)

Untuk membuat sampel data uji yang memiliki berkas duplikat identik di folder berbeda, berkas `.tmp`, dan berkas unik:

```powershell
node setup_demo_data.js
```

---

### 3. Menjalankan Tes Otomatis (SRS Verification)

Untuk memvalidasi integritas logika pemindaian, grouping SHA-256, dan pembersihan in-place:

```powershell
node test_audit.js
```

---

## 🌐 Endpoint API Internal

| Metode | Endpoint | Deskripsi | Request Body Contoh |
|---|---|---|---|
| `GET` | `/` | Antarmuka pengguna Web UI Dashboard | - |
| `POST` | `/api/scan` | Memindai folder target dan mengembalikan statistik & grup | `{"targetPath": "Downloads_Lab"}` |
| `POST` | `/api/clean` | Mengeksekusi pembersihan in-place duplikat & .tmp | `{"targetPath": "Downloads_Lab"}` |
| `GET` | `/api/info` | Informasi direktori kerja dan metadata runtime | - |

---

## 🛡️ Prinsip Keamanan Eksekusi In-Place
- Skrip memverifikasi keamanan jalur kanonikal (*canonical path check*) untuk memastikan tidak terjadi *path traversal* di luar direktori yang sedang dipindai.
- Algoritma pembersihan mengunci 1 file asli tertua per grup SHA-256 hash dan mengecualikannya secara absolut dari daftar penghapusan.