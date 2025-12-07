/**
 * Firebase → PocketBase Veri Göç Scripti
 * 
 * Kullanım:
 *   POCKETBASE_URL=http://localhost:8090 \
 *   PB_ADMIN_EMAIL=admin@findco.ai \
 *   PB_ADMIN_PASSWORD=your-password \
 *   FIREBASE_EXPORT=./firebase-users.json \
 *   node migrate.js
 * 
 * NOT: Firebase şifreler BCrypt hash olarak gelir, PocketBase bunları kabul etmez.
 *      Bu yüzden kullanıcılar ilk girişte "Şifremi Unuttum" yapmalıdır.
 * 
 * @author FindCo Team
 * @version 1.0.0
 */

const fs = require('fs');

// ============================================
// YAPILANDIRMA
// ============================================

const CONFIG = {
    // PocketBase API URL
    POCKETBASE_URL: process.env.POCKETBASE_URL || 'http://localhost:8090',

    // Admin credentials (ilk setup'ta oluşturduğunuz)
    ADMIN_EMAIL: process.env.PB_ADMIN_EMAIL || 'admin@findco.ai',
    ADMIN_PASSWORD: process.env.PB_ADMIN_PASSWORD,

    // Firebase export JSON dosyası
    FIREBASE_EXPORT: process.env.FIREBASE_EXPORT || './firebase-export.json',

    // Batch boyutu (rate limiting için)
    BATCH_SIZE: 50,

    // İstekler arası bekleme (ms)
    DELAY_MS: 100
};

// ============================================
// YARDIMCI FONKSİYONLAR
// ============================================

/**
 * Belirtilen süre kadar bekle
 * @param {number} ms - Milisaniye
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * PocketBase Admin auth token al
 */
async function authenticateAdmin() {
    console.log('🔐 Admin authentication...');

    if (!CONFIG.ADMIN_PASSWORD) {
        throw new Error('PB_ADMIN_PASSWORD environment variable gerekli!');
    }

    const response = await fetch(`${CONFIG.POCKETBASE_URL}/api/admins/auth-with-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            identity: CONFIG.ADMIN_EMAIL,
            password: CONFIG.ADMIN_PASSWORD
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Admin auth failed: ${error}`);
    }

    const data = await response.json();
    console.log('✅ Admin authenticated');
    return data.token;
}

/**
 * Firebase Timestamp'ı ISO string'e çevir
 */
function convertFirebaseTimestamp(timestamp) {
    if (!timestamp) return null;

    // Firestore Timestamp formatı: { _seconds: 1234567890, _nanoseconds: 0 }
    if (timestamp._seconds) {
        return new Date(timestamp._seconds * 1000).toISOString();
    }

    // Zaten ISO string ise
    if (typeof timestamp === 'string') {
        return timestamp;
    }

    // Date objesi ise
    if (timestamp instanceof Date) {
        return timestamp.toISOString();
    }

    return null;
}

/**
 * Rastgele güvenli şifre oluştur
 */
function generateRandomPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
    let password = '';
    for (let i = 0; i < 24; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

/**
 * Firebase user verisini PocketBase formatına dönüştür
 */
function transformUser(firebaseUser, id) {
    const password = generateRandomPassword();

    return {
        // Email (zorunlu) - PocketBase users auth collection için
        email: firebaseUser.email,
        emailVisibility: true,
        password: password,
        passwordConfirm: password,

        // Profil bilgileri
        name: firebaseUser.displayName || firebaseUser.name || '',

        // Firebase UID (migration referansı için)
        firebase_uid: id,

        // Paket bilgileri (geriye uyumluluk)
        package: firebaseUser.package || 'free',
        package_name: firebaseUser.subscription?.packageName ||
            firebaseUser.package_name ||
            firebaseUser.package || 'Free',
        package_status: firebaseUser.subscriptionStatus ||
            firebaseUser.package_status || 'free',

        // Yeni abonelik sistemi
        subscriptionStatus: firebaseUser.subscriptionStatus ||
            firebaseUser.package_status || 'free',
        subscription: firebaseUser.subscription || null,
        subscription_end_date: convertFirebaseTimestamp(
            firebaseUser.subscription?.endDate ||
            firebaseUser.subscription_end_date ||
            firebaseUser.packageExpiry
        ),

        // Kullanım verileri
        api_counter: firebaseUser.api_counter || 0,
        usageToday: firebaseUser.usageToday || 0,
        totalUsage: firebaseUser.totalUsage ||
            firebaseUser.usageStats?.totalGenerations || 0,
        credits: firebaseUser.credits || 0,

        // Aktiflik durumu
        isActive: firebaseUser.subscriptionStatus === 'active' ||
            firebaseUser.package_status === 'active',

        // Tarihler
        lastLoginAt: convertFirebaseTimestamp(firebaseUser.lastLoginAt),

        // Son satın alma
        lastPurchase: firebaseUser.lastPurchase || null,

        // İstatistik önbelleği
        statsCache: firebaseUser.statsCache || null
    };
}

/**
 * Tek bir kullanıcıyı PocketBase'e aktar
 */
async function importUser(user, token) {
    const response = await fetch(`${CONFIG.POCKETBASE_URL}/api/collections/users/records`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': token
        },
        body: JSON.stringify(user)
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(JSON.stringify(error));
    }

    return await response.json();
}

// ============================================
// ANA GÖÇ FONKSİYONU
// ============================================

async function migrateUsers() {
    console.log('🚀 Firebase → PocketBase Göç Başlıyor...\n');
    console.log('📋 Yapılandırma:');
    console.log(`   PocketBase URL: ${CONFIG.POCKETBASE_URL}`);
    console.log(`   Admin Email: ${CONFIG.ADMIN_EMAIL}`);
    console.log(`   Firebase Export: ${CONFIG.FIREBASE_EXPORT}\n`);

    // 1. Firebase export dosyasını oku
    console.log(`📁 Dosya okunuyor: ${CONFIG.FIREBASE_EXPORT}`);

    if (!fs.existsSync(CONFIG.FIREBASE_EXPORT)) {
        console.error(`❌ Dosya bulunamadı: ${CONFIG.FIREBASE_EXPORT}`);
        console.log('\nKullanım:');
        console.log('  1. Firebase Console > Firestore > Export Data');
        console.log('  2. JSON dosyasını bu klasöre kopyalayın');
        console.log('  3. FIREBASE_EXPORT=./dosya.json node migrate.js');
        process.exit(1);
    }

    const rawData = fs.readFileSync(CONFIG.FIREBASE_EXPORT, 'utf8');
    const firebaseData = JSON.parse(rawData);

    // 2. Users koleksiyonunu bul
    let users = {};

    // Format 1: { users: { doc1: {...}, doc2: {...} } }
    if (firebaseData.users) {
        users = firebaseData.users;
    }
    // Format 2: { __collections__: { users: {...} } }
    else if (firebaseData.__collections__?.users) {
        users = firebaseData.__collections__.users;
    }
    // Format 3: Direkt user listesi array
    else if (Array.isArray(firebaseData)) {
        firebaseData.forEach((user, index) => {
            users[user.id || index] = user;
        });
    }
    else {
        console.error('❌ Tanınmayan Firebase export formatı');
        console.log('Beklenen formatlar:');
        console.log('  - { users: { docId: {...} } }');
        console.log('  - { __collections__: { users: {...} } }');
        console.log('  - [ { id: "...", email: "..." }, ... ]');
        process.exit(1);
    }

    const userIds = Object.keys(users);
    console.log(`📊 ${userIds.length} kullanıcı bulundu\n`);

    // 3. Admin auth
    const token = await authenticateAdmin();

    // 4. Kullanıcıları aktar
    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    const errors = [];

    console.log('📤 Kullanıcılar aktarılıyor...\n');

    for (let i = 0; i < userIds.length; i++) {
        const id = userIds[i];
        const firebaseUser = users[id];

        // Email olmayan kayıtları atla
        if (!firebaseUser.email) {
            console.log(`⚠️  [${i + 1}/${userIds.length}] Email yok, atlanıyor: ${id}`);
            skippedCount++;
            continue;
        }

        try {
            // Firebase → PocketBase format dönüşümü
            const pbUser = transformUser(firebaseUser, id);

            // PocketBase'e kaydet
            await importUser(pbUser, token);

            successCount++;
            console.log(`✅ [${i + 1}/${userIds.length}] ${pbUser.email}`);

        } catch (error) {
            errorCount++;
            const errorMsg = `${firebaseUser.email}: ${error.message}`;
            errors.push(errorMsg);
            console.error(`❌ [${i + 1}/${userIds.length}] ${errorMsg}`);
        }

        // Rate limiting
        if ((i + 1) % CONFIG.BATCH_SIZE === 0) {
            console.log(`\n⏳ Batch tamamlandı, ${CONFIG.DELAY_MS * 2}ms bekleniyor...\n`);
            await delay(CONFIG.DELAY_MS * 2);
        } else {
            await delay(CONFIG.DELAY_MS);
        }
    }

    // 5. Sonuç raporu
    console.log('\n' + '='.repeat(50));
    console.log('📊 GÖÇ TAMAMLANDI');
    console.log('='.repeat(50));
    console.log(`✅ Başarılı: ${successCount}`);
    console.log(`❌ Hata: ${errorCount}`);
    console.log(`⚠️  Atlanan: ${skippedCount}`);
    console.log(`📋 Toplam: ${userIds.length}`);

    if (errors.length > 0) {
        console.log('\n❌ Hata Detayları:');
        errors.slice(0, 20).forEach(e => console.log(`   - ${e}`));
        if (errors.length > 20) {
            console.log(`   ... ve ${errors.length - 20} hata daha`);
        }

        // Hataları dosyaya kaydet
        fs.writeFileSync('migration-errors.log', errors.join('\n'));
        console.log('\n📁 Tüm hatalar: migration-errors.log');
    }

    console.log('\n💡 ÖNEMLİ: Kullanıcıların şifreleri rastgele oluşturuldu.');
    console.log('   Kullanıcılar "Şifremi Unuttum" ile yeni şifre almalıdır.');
    console.log('\n🎉 Göç tamamlandı!');
}

// ============================================
// SCRIPT BAŞLAT
// ============================================

migrateUsers().catch(error => {
    console.error('💥 Kritik hata:', error);
    process.exit(1);
});
