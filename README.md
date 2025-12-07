# PocketBase Deployment - Firebase to PocketBase Migration

Bu klasör, Firebase altyapısından PocketBase'e geçiş için gerekli tüm dosyaları içerir.

## 📁 Dosya Yapısı

```
pocketbase/
├── docker-compose.yml    # Docker Compose yapılandırması
├── env.template          # Environment değişkenleri şablonu
├── pb_hooks/
│   └── main.pb.js        # Backend hooks (iyzico webhook, cron, mailer)
├── migrate.js            # Firebase → PocketBase migration script
├── server-optimize.sh    # Sunucu optimizasyon scripti (10k bağlantı)
└── README.md
```

## 🚀 Hızlı Başlangıç

### 1. Sunucu Hazırlığı (Netcup RS 1000)

```bash
# Scripti sunucuya kopyala ve çalıştır
scp server-optimize.sh root@your-server:/tmp/
ssh root@your-server
chmod +x /tmp/server-optimize.sh
sudo /tmp/server-optimize.sh
sudo reboot
```

### 2. PocketBase Kurulumu

```bash
# Sunucuda
cd /opt/pocketbase

# Dosyaları kopyala
scp docker-compose.yml env.template pb_hooks/main.pb.js root@your-server:/opt/pocketbase/
scp pb_hooks/main.pb.js root@your-server:/opt/pocketbase/pb_hooks/

# .env oluştur
cp env.template .env
nano .env  # Gerçek değerleri gir

# Başlat
docker compose up -d
docker compose logs -f
```

### 3. İlk Kurulum

1. `http://your-server:8090/_/` adresine git
2. Admin hesabı oluştur
3. `users` collection için gerekli alanları ekle (implementation_plan.md'ye bak)
4. Settings > Mail'den SMTP ayarlarını yap

### 4. Firebase Verilerini Aktar

```bash
# Firebase Console > Firestore > Export Data (JSON)
# firebase-export.json dosyasını oluştur

POCKETBASE_URL=http://localhost:8090 \
PB_ADMIN_EMAIL=admin@findco.ai \
PB_ADMIN_PASSWORD=your-password \
FIREBASE_EXPORT=./firebase-export.json \
node migrate.js
```

### 5. iyzico Webhook Ayarı

iyzico Merchant Panel'de webhook URL olarak ekle:
```
https://api.findco.ai/api/iyzico-webhook
```

## 📋 Users Collection Alanları

Admin Panel'de `users` collection için eklenecek alanlar:

| Alan | Tip | Açıklama |
|------|-----|----------|
| `name` | Text | Kullanıcı adı |
| `firebase_uid` | Text | Eski Firebase UID |
| `package` | Text | Paket adı (geriye uyum) |
| `package_name` | Text | Paket adı |
| `package_status` | Select | free, active, canceled |
| `subscriptionStatus` | Select | free, active, canceled |
| `subscription` | JSON | Abonelik detayları |
| `subscription_end_date` | DateTime | Bitiş tarihi |
| `api_counter` | Number | Günlük sayaç |
| `usageToday` | Number | Bugünkü kullanım |
| `totalUsage` | Number | Toplam kullanım |
| `credits` | Number | Kredi bakiyesi |
| `isActive` | Bool | Aktif mi |
| `lastLoginAt` | DateTime | Son giriş |
| `lastPurchase` | JSON | Son satın alma |
| `iyzico_subscription_ref` | Text | iyzico referans |

## 🔒 Güvenlik

- Admin panel erişimini IP ile kısıtla (Nginx)
- SMTP için Google App Password kullan
- `PB_ENCRYPTION_KEY` 32+ karakter olmalı
- Production'da webhook imza doğrulaması ekle

## 📞 Destek

Sorularınız için: info@findco.ai
