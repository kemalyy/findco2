#!/bin/bash

# ============================================
# Netcup RS 1000 Sunucu Optimizasyonu
# Linux File Descriptor ve Network Limitleri
# 10.000 anlık bağlantı için optimize edilmiş
# ============================================

set -e

echo "🚀 Sunucu optimizasyonu başlıyor..."
echo "   Hedef: 10.000 anlık bağlantı"
echo ""

# Root kontrolü
if [ "$EUID" -ne 0 ]; then 
    echo "❌ Bu script root olarak çalıştırılmalıdır!"
    echo "   Kullanım: sudo ./server-optimize.sh"
    exit 1
fi

# ============================================
# 1. File Descriptor Limitleri
# ============================================

echo "📁 /etc/security/limits.conf güncelleniyor..."

cat >> /etc/security/limits.conf << 'EOF'

# ============================================
# PocketBase 10k Bağlantı Optimizasyonu
# ============================================
*               soft    nofile          65536
*               hard    nofile          65536
root            soft    nofile          65536
root            hard    nofile          65536
*               soft    nproc           65536
*               hard    nproc           65536
EOF

echo "✅ limits.conf güncellendi"

# ============================================
# 2. Kernel TCP/Network Optimizasyonu
# ============================================

echo "🔧 /etc/sysctl.conf güncelleniyor..."

cat >> /etc/sysctl.conf << 'EOF'

# ============================================
# POCKETBASE 10K BAGLANTI OPTIMIZASYONU
# ============================================

# File descriptor limiti
fs.file-max = 2097152
fs.nr_open = 2097152

# TCP/IP Stack optimizasyonu
net.core.somaxconn = 65535
net.core.netdev_max_backlog = 65535
net.ipv4.tcp_max_syn_backlog = 65535

# TCP Bağlantı havuzu
net.ipv4.tcp_max_tw_buckets = 2000000
net.ipv4.ip_local_port_range = 1024 65535

# TCP Keep-alive (Cloudflare ile uyumlu)
net.ipv4.tcp_keepalive_time = 60
net.ipv4.tcp_keepalive_intvl = 10
net.ipv4.tcp_keepalive_probes = 6

# TCP Memory tuning (8GB RAM için)
net.ipv4.tcp_mem = 786432 1048576 1572864
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216

# Connection tracking (gerekirse)
# net.netfilter.nf_conntrack_max = 1048576
EOF

echo "✅ sysctl.conf güncellendi"

# ============================================
# 3. Değişiklikleri Uygula
# ============================================

echo "🔄 Kernel parametreleri uygulanıyor..."
sysctl -p

# ============================================
# 4. Docker Kurulumu
# ============================================

if ! command -v docker &> /dev/null; then
    echo "🐳 Docker kurulumu başlıyor..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    echo "✅ Docker kuruldu"
else
    echo "✅ Docker zaten kurulu"
fi

# Docker Compose kontrolü
if ! docker compose version &> /dev/null; then
    echo "📦 Docker Compose kurulumu..."
    apt-get update
    apt-get install -y docker-compose-plugin
    echo "✅ Docker Compose kuruldu"
else
    echo "✅ Docker Compose zaten kurulu"
fi

# ============================================
# 5. Docker Daemon Optimizasyonu
# ============================================

echo "⚙️ Docker daemon.json yapılandırılıyor..."

mkdir -p /etc/docker
cat > /etc/docker/daemon.json << 'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "storage-driver": "overlay2",
  "default-ulimits": {
    "nofile": {
      "Name": "nofile",
      "Hard": 65536,
      "Soft": 65536
    }
  }
}
EOF

systemctl restart docker
echo "✅ Docker daemon yapılandırıldı"

# ============================================
# 6. PocketBase Klasör Yapısı
# ============================================

POCKETBASE_DIR="/opt/pocketbase"

echo "📂 PocketBase klasör yapısı oluşturuluyor: $POCKETBASE_DIR"

mkdir -p $POCKETBASE_DIR/{pb_data,pb_hooks,pb_migrations}
chmod 755 $POCKETBASE_DIR
chmod 755 $POCKETBASE_DIR/pb_*

echo "✅ Klasör yapısı oluşturuldu"

# ============================================
# Sonuç
# ============================================

echo ""
echo "========================================"
echo "✅ SUNUCU OPTİMİZASYONU TAMAMLANDI"
echo "========================================"
echo ""
echo "📋 Yapılan değişiklikler:"
echo "   ✅ File descriptor limitleri artırıldı (65536)"
echo "   ✅ Kernel TCP parametreleri optimize edildi"
echo "   ✅ Docker kuruldu ve yapılandırıldı"
echo "   ✅ PocketBase klasör yapısı oluşturuldu"
echo ""
echo "⚠️ ÖNEMLİ: Değişikliklerin tam etkisi için sunucuyu yeniden başlatın:"
echo "   sudo reboot"
echo ""
echo "📋 Sonraki adımlar:"
echo "   1. Sunucuyu yeniden başlat: sudo reboot"
echo "   2. Limits kontrolü: ulimit -n (65536 olmalı)"
echo "   3. docker-compose.yml ve .env dosyalarını $POCKETBASE_DIR'a kopyala"
echo "   4. docker compose up -d"
echo ""
