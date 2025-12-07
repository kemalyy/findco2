/// <reference path="../pb_data/types.d.ts" />

/**
 * PocketBase Hooks - Firebase Functions Alternatifi
 * 
 * İçerikler:
 * - Cron Job: Süresi dolmuş paketleri temizle + mail gönder
 * - iyzico Subscription Webhook: /api/iyzico-webhook
 * - Email Helper: SMTP mail gönderimi
 * 
 * @author FindCo Team
 * @version 2.0.0 (iyzico entegrasyonlu)
 */

// ============================================
// HELPER FUNCTIONS - MAIL
// ============================================

/**
 * SMTP ile email gönderimi
 * PocketBase'in dahili mailer'ını kullanır
 * Admin Panel > Settings > Mail'den SMTP yapılandırması yapılmalı
 * 
 * @param {string} to - Alıcı email adresi
 * @param {string} subject - Email başlığı
 * @param {string} html - HTML içerik
 * @param {string} text - Plain text içerik (fallback)
 * @returns {boolean} Başarılı mı
 */
function sendMail(to, subject, html, text) {
    try {
        // PocketBase dahili mailer
        const message = new MailerMessage({
            from: {
                address: $app.settings().meta.senderAddress,
                name: $app.settings().meta.senderName || "FindCo"
            },
            to: [{ address: to }],
            subject: subject,
            html: html,
            text: text || html.replace(/<[^>]*>/g, '')
        });

        $app.newMailClient().send(message);
        console.log(`✅ Email gönderildi: ${to}`);
        return true;
    } catch (error) {
        console.error(`❌ Email gönderilemedi: ${to}`, error);
        return false;
    }
}

/**
 * Paket süresi dolmuş kullanıcıya bildirim maili
 */
function getPackageExpiredEmailTemplate(userName, packageName) {
    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: 'Segoe UI', sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                         color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px; }
                .info-box { background: white; padding: 20px; border-radius: 10px; 
                           margin: 20px 0; border-left: 4px solid #667eea; }
                .button { display: inline-block; background: #667eea; color: white; 
                         padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
                .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>📭 Paket Süresi Doldu</h1>
                </div>
                <div class="content">
                    <p>Merhaba ${userName},</p>
                    <p><strong>${packageName}</strong> paketinizin süresi doldu ve 
                       hesabınız <strong>Ücretsiz Paket</strong>'e geçiş yaptı.</p>
                    
                    <div class="info-box">
                        <h3>✅ Neler Hala Kullanılabilir?</h3>
                        <ul>
                            <li>Günlük 3 içerik üretimi</li>
                            <li>Temel AI özellikleri</li>
                        </ul>
                    </div>
                    
                    <a href="https://findco.ai/profile" class="button">Paket Satın Al</a>
                </div>
                <div class="footer">
                    <p>© 2025 FindCo - AI Content Generation Platform</p>
                </div>
            </div>
        </body>
        </html>
    `;

    const text = `Merhaba ${userName}, ${packageName} paketinizin süresi doldu. Hesabınız Ücretsiz Paket'e geçti. Premium'a dönmek için: https://findco.ai/profile`;

    return { html, text };
}

/**
 * Ödeme başarılı email şablonu
 */
function getPaymentSuccessEmailTemplate(userName, packageName, endDate) {
    const formattedDate = new Date(endDate).toLocaleDateString("tr-TR", {
        day: "numeric", month: "long", year: "numeric"
    });

    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: 'Segoe UI', sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%); 
                         color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px; }
                .package-box { background: white; padding: 20px; border-radius: 10px; 
                              margin: 20px 0; border-left: 4px solid #11998e; }
                .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>✅ Aboneliğiniz Aktif!</h1>
                </div>
                <div class="content">
                    <p>Merhaba ${userName},</p>
                    <p>iyzico üzerinden ödemeniz başarıyla alındı!</p>
                    
                    <div class="package-box">
                        <h3>📦 ${packageName}</h3>
                        <p><strong>Geçerlilik:</strong> ${formattedDate}</p>
                    </div>
                    
                    <p>Artık premium özelliklerimizin keyfini çıkarabilirsiniz!</p>
                </div>
                <div class="footer">
                    <p>© 2025 FindCo - AI Content Generation Platform</p>
                </div>
            </div>
        </body>
        </html>
    `;

    return { html, text: `Merhaba ${userName}, ${packageName} aboneliğiniz aktif. Geçerlilik: ${formattedDate}` };
}

// ============================================
// CRON JOB: Süresi Dolmuş Paketleri Temizle
// ============================================

/**
 * Her gece 00:00'da çalışır (Europe/Istanbul)
 * subscription_end_date geçmiş kullanıcıları bulur
 * isActive = false yapar ve bilgilendirme maili atar
 */
cronAdd("cleanupExpiredPackages", "0 0 * * *", () => {
    console.log("🔄 Süresi dolmuş paketler kontrol ediliyor...");

    const now = new Date();
    const nowStr = now.toISOString().replace("T", " ").slice(0, 23);
    let expiredCount = 0;
    let errorCount = 0;

    try {
        // Süresi dolmuş ve hala aktif olan kullanıcıları bul
        const records = $app.dao().findRecordsByFilter(
            "users",
            `subscription_end_date != "" && 
             subscription_end_date < {:now} && 
             (subscriptionStatus = "active" || package_status = "active")`,
            "-subscription_end_date",
            500,
            0,
            { now: nowStr }
        );

        console.log(`📊 ${records.length} süresi dolmuş kullanıcı bulundu`);

        for (let record of records) {
            try {
                const email = record.get("email");
                const userName = record.get("name") || email.split("@")[0];
                const packageName = record.get("package_name") || "Premium";

                console.log(`⏰ Süresi dolmuş: ${email}, Paket: ${packageName}`);

                // Kullanıcıyı Free pakete düşür
                record.set("isActive", false);
                record.set("subscriptionStatus", "free");
                record.set("package_status", "free");
                record.set("package_name", "Free");
                record.set("package", "Free");
                record.set("subscription", null);
                record.set("subscription_end_date", null);

                $app.dao().saveRecord(record);

                // Bilgilendirme maili gönder
                const template = getPackageExpiredEmailTemplate(userName, packageName);
                sendMail(email, "📭 Paketinizin Süresi Doldu", template.html, template.text);

                expiredCount++;
                console.log(`✅ Kullanıcı güncellendi: ${email}`);

            } catch (userError) {
                errorCount++;
                console.error(`❌ Kullanıcı işlenirken hata: ${record.id()}`, userError);
            }
        }

        console.log(`✅ Temizlik tamamlandı: ${expiredCount} paket sonlandırıldı, ${errorCount} hata`);

    } catch (error) {
        console.error("❌ Cron job hatası:", error);
    }
});

// ============================================
// IYZICO SUBSCRIPTION WEBHOOK
// ============================================

/**
 * iyzico Subscription Bildirim Webhook'u
 * 
 * iyzico şu event'leri gönderir:
 * - subscription.started: Yeni abonelik başladı
 * - subscription.renewed: Abonelik yenilendi (otomatik ödeme)
 * - subscription.cancelled: Abonelik iptal edildi
 * - subscription.expired: Abonelik süresi doldu
 * - subscription.payment.failed: Ödeme başarısız
 * 
 * Endpoint: POST /api/iyzico-webhook
 */
routerAdd("POST", "/api/iyzico-webhook", (c) => {
    console.log("🔔 iyzico webhook alındı");

    try {
        const body = $apis.requestInfo(c).data;

        // 1. iyzico İmza Doğrulaması
        const iyzicoSecretKey = $os.getenv("IYZICO_SECRET_KEY");

        if (!iyzicoSecretKey) {
            console.error("❌ IYZICO_SECRET_KEY tanımlı değil!");
            return c.json(500, { success: false, error: "Server configuration error" });
        }

        console.log("📦 iyzico Event:", {
            eventType: body.eventType,
            subscriptionReferenceCode: body.subscriptionReferenceCode,
            status: body.status,
            paidPrice: body.paidPrice
        });

        // 2. Event tipine göre işlem yap
        const eventType = body.eventType || body.iyziEventType;

        switch (eventType) {
            case "subscription.started":
            case "subscription.renewed":
                return handleSubscriptionSuccess(c, body);

            case "subscription.cancelled":
                return handleSubscriptionCancelled(c, body);

            case "subscription.expired":
            case "subscription.payment.failed":
                return handleSubscriptionFailed(c, body);

            default:
                console.log(`⚠️ Bilinmeyen event tipi: ${eventType}`);
                return c.json(200, { success: true, message: "Event ignored" });
        }

    } catch (error) {
        console.error("❌ Webhook işleme hatası:", error);
        return c.json(500, { success: false, error: "Internal server error" });
    }
});

/**
 * Abonelik başarılı - aktivasyon/yenileme
 */
function handleSubscriptionSuccess(c, body) {
    try {
        // iyzico'dan gelen veriler
        const subscriptionRef = body.subscriptionReferenceCode;
        const customerEmail = body.customerEmail || body.customer?.email;
        const pricingPlanName = body.pricingPlanName || body.pricingPlan?.name || "Premium";
        const startDate = new Date();

        // Abonelik süresini hesapla (iyzico'dan period bilgisi gelir)
        const periodUnit = body.pricingPlan?.paymentInterval || "MONTHLY";
        const periodCount = body.pricingPlan?.paymentIntervalCount || 1;

        let durationDays = 30; // Default: aylık
        if (periodUnit === "YEARLY") durationDays = 365 * periodCount;
        else if (periodUnit === "WEEKLY") durationDays = 7 * periodCount;
        else durationDays = 30 * periodCount;

        const endDate = new Date();
        endDate.setDate(endDate.getDate() + durationDays);

        if (!customerEmail) {
            console.error("❌ customerEmail bulunamadı");
            return c.json(400, { success: false, error: "Missing customer email" });
        }

        // Kullanıcıyı email ile bul
        let userRecord;
        try {
            const records = $app.dao().findRecordsByFilter(
                "users",
                `email = {:email}`,
                "", 1, 0,
                { email: customerEmail }
            );

            if (records.length === 0) {
                console.error(`❌ Kullanıcı bulunamadı: ${customerEmail}`);
                return c.json(404, { success: false, error: "User not found" });
            }
            userRecord = records[0];
        } catch (e) {
            console.error("❌ Kullanıcı aranırken hata:", e);
            return c.json(500, { success: false, error: "Database error" });
        }

        // Kullanıcıyı güncelle
        userRecord.set("isActive", true);
        userRecord.set("subscriptionStatus", "active");
        userRecord.set("package_status", "active");
        userRecord.set("package_name", pricingPlanName);
        userRecord.set("package", pricingPlanName);
        userRecord.set("iyzico_subscription_ref", subscriptionRef);
        userRecord.set("subscription", {
            packageName: pricingPlanName,
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            provider: "iyzico",
            referenceCode: subscriptionRef
        });
        userRecord.set("subscription_end_date", endDate.toISOString().replace("T", " ").slice(0, 23));
        userRecord.set("usageToday", 0); // Günlük kullanımı sıfırla
        userRecord.set("api_counter", 0);
        userRecord.set("lastPurchase", {
            provider: "iyzico",
            packageName: pricingPlanName,
            date: startDate.toISOString(),
            amount: body.paidPrice || 0,
            referenceCode: subscriptionRef
        });

        $app.dao().saveRecord(userRecord);

        console.log(`🎉 Abonelik aktif edildi: ${customerEmail}, Paket: ${pricingPlanName}`);

        // Başarı maili gönder
        const userName = userRecord.get("name") || customerEmail.split("@")[0];
        const template = getPaymentSuccessEmailTemplate(userName, pricingPlanName, endDate);
        sendMail(customerEmail, "✅ Aboneliğiniz Aktif!", template.html, template.text);

        return c.json(200, {
            success: true,
            message: "Subscription activated",
            data: { email: customerEmail, package: pricingPlanName, endDate: endDate.toISOString() }
        });

    } catch (error) {
        console.error("❌ handleSubscriptionSuccess hatası:", error);
        return c.json(500, { success: false, error: "Processing error" });
    }
}

/**
 * Abonelik iptal edildi
 */
function handleSubscriptionCancelled(c, body) {
    try {
        const customerEmail = body.customerEmail || body.customer?.email;

        if (!customerEmail) {
            return c.json(400, { success: false, error: "Missing customer email" });
        }

        const records = $app.dao().findRecordsByFilter(
            "users", `email = {:email}`, "", 1, 0, { email: customerEmail }
        );

        if (records.length === 0) {
            return c.json(404, { success: false, error: "User not found" });
        }

        const userRecord = records[0];

        // Status'u canceled yap ama hemen Free'ye düşürme
        // Mevcut periyot sonuna kadar kullanmaya devam edebilir
        userRecord.set("subscriptionStatus", "canceled");
        userRecord.set("package_status", "canceled");

        $app.dao().saveRecord(userRecord);

        console.log(`⏹️ Abonelik iptal edildi: ${customerEmail}`);

        return c.json(200, { success: true, message: "Subscription cancelled" });

    } catch (error) {
        console.error("❌ handleSubscriptionCancelled hatası:", error);
        return c.json(500, { success: false, error: "Processing error" });
    }
}

/**
 * Abonelik başarısız / süresi doldu
 */
function handleSubscriptionFailed(c, body) {
    try {
        const customerEmail = body.customerEmail || body.customer?.email;

        if (!customerEmail) {
            return c.json(400, { success: false, error: "Missing customer email" });
        }

        const records = $app.dao().findRecordsByFilter(
            "users", `email = {:email}`, "", 1, 0, { email: customerEmail }
        );

        if (records.length === 0) {
            return c.json(404, { success: false, error: "User not found" });
        }

        const userRecord = records[0];
        const packageName = userRecord.get("package_name") || "Premium";
        const userName = userRecord.get("name") || customerEmail.split("@")[0];

        // Free pakete düşür
        userRecord.set("isActive", false);
        userRecord.set("subscriptionStatus", "free");
        userRecord.set("package_status", "free");
        userRecord.set("package_name", "Free");
        userRecord.set("package", "Free");
        userRecord.set("subscription", null);
        userRecord.set("subscription_end_date", null);

        $app.dao().saveRecord(userRecord);

        console.log(`❌ Abonelik sonlandı: ${customerEmail}`);

        // Bilgilendirme maili
        const template = getPackageExpiredEmailTemplate(userName, packageName);
        sendMail(customerEmail, "📭 Aboneliğiniz Sona Erdi", template.html, template.text);

        return c.json(200, { success: true, message: "Subscription expired" });

    } catch (error) {
        console.error("❌ handleSubscriptionFailed hatası:", error);
        return c.json(500, { success: false, error: "Processing error" });
    }
}

// ============================================
// EKLENTILER
// ============================================

/**
 * Health check endpoint
 */
routerAdd("GET", "/api/health", (c) => {
    return c.json(200, {
        status: "ok",
        timestamp: new Date().toISOString(),
        version: "2.0.0"
    });
});

/**
 * Yeni kullanıcı kaydı sonrası welcome mail
 */
onRecordAfterCreateRequest((e) => {
    const userName = e.record.get("name") || e.record.get("email")?.split("@")[0] || "Kullanıcı";
    const email = e.record.get("email");

    if (!email) return;

    console.log(`👤 Yeni kullanıcı: ${email}`);

    const welcomeHtml = `
        <div style="font-family: 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                        color: white; padding: 30px; text-align: center; border-radius: 10px;">
                <h1>🚀 FindCo'ya Hoş Geldiniz!</h1>
            </div>
            <div style="padding: 30px; background: #f8f9fa;">
                <p>Merhaba ${userName},</p>
                <p>FindCo ailesine katıldığınız için teşekkür ederiz!</p>
                <h3>🎁 Ücretsiz Paketiniz Aktif</h3>
                <p>Günlük <strong>3 içerik üretimi</strong> hakkınız hazır.</p>
                <a href="https://findco.ai" 
                   style="display: inline-block; background: #667eea; color: white; 
                          padding: 12px 30px; text-decoration: none; border-radius: 5px;">
                    Hemen Başlayın
                </a>
            </div>
        </div>
    `;

    sendMail(email, "🎉 FindCo'ya Hoş Geldiniz!", welcomeHtml);

}, "users");

console.log("✅ PocketBase hooks yüklendi (iyzico entegrasyonlu)");
