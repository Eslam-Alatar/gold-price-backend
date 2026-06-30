const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

// 💾 الذاكرة المركزية الذكية (تأمين فابريكا بأسعار افتراضية مبدئية لو أول مرة يقوم)
let cachedPrices = { karat24: 3600, karat21: 3150, karat18: 2700 };
let lastFetchTime = 0;
let lastUpdatedTimestamp = new Date().toISOString(); // تسجيل وقت التحديث بدقة
let isFetching = false;

// ⏱️ حساب المدة الديناميكية (10 دقائق + أو - ثوانٍ عشوائية لكسر النمط)
function getDynamicDuration() {
    const BASE_DURATION = 10 * 60 * 1000; // 10 دقائق
    const minSeconds = -30;
    const maxSeconds = 30;
    const randomSeconds = Math.floor(Math.random() * (maxSeconds - minSeconds + 1)) + minSeconds;
    return BASE_DURATION + (randomSeconds * 1000);
}

// 🛰️ دالة الـ Scraping مع الـ Validation والـ Retry والـ Timeout السريع
async function scrapeWithRetry(retries = 2, delay = 1500) {
    for (let i = 0; i < retries; i++) {
        try {
            // 🕐 تقليص الـ Timeout لـ 5 ثوانٍ لحماية السيرفر من التعليق
            const response = await axios.get('https://market.isagha.com/prices', {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                    'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8'
                },
                timeout: 5000
            });

            const $ = cheerio.load(response.data);
            let prices = { karat24: 0, karat21: 0, karat18: 0 };

            $('table tbody tr').each((index, element) => {
                const rowText = $(element).find('td').eq(0).text().trim();
                const priceText = $(element).find('td').eq(1).text().replace(/[^\d.]/g, '').trim();
                const priceValue = parseFloat(priceText);

                if (rowText.includes('24')) prices.karat24 = priceValue;
                if (rowText.includes('21')) prices.karat21 = priceValue;
                if (rowText.includes('18')) prices.karat18 = priceValue;
            });

            // 🎯 الـ Validation (التحقق من صحة البيانات والنطاق المنطقي)
            // نضمن إن الأسعار مش أصفار وموجودة جوة نطاق منطقي للذهب في مصر (مثلاً أكبر من 1000 وأقل من 6000)
            if (prices.karat21 > 1000 && prices.karat21 < 6000 && prices.karat24 > 0) {
                return prices; // البيانات سليمة تماماً، اخرج ورجعها
            }

            throw new Error("Data validation failed (Invalid prices parsed or HTML changed)");

        } catch (error) {
            console.error(`⚠️ Attempt ${i + 1} failed: ${error.message}`);
            // لو الـ Error بسبب حظر 429 أو خطأ سيرفر، انتظر مدة تدريجية قبل الإعادة (Backoff)
            if (i < retries - 1) {
                await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
            }
        }
    }
    return null; // فشلت كل المحاولات
}

// 🛣️ الـ API الرئيسي المطور لـ كاشلي
app.get('/api/gold-rates', async (req, res) => {
    const currentTime = Date.now();
    const currentAllowedDuration = getDynamicDuration();

    // ⚡ إضافة Cache-Control لشبكة الـ CDN الخاصة بـ Vercel لتخفيف العبء أكثر
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');

    // 1️⃣ لو الكاش لسه جديد، رجعه فوراً مع التوقيت
    if (currentTime - lastFetchTime < currentAllowedDuration) {
        return res.json({
            success: true,
            rates: cachedPrices,
            lastUpdated: lastUpdatedTimestamp
        });
    }

    // 2️⃣ حارس القفل: منع الـ Distributed Stampede لو في ريكويست شغال حالياً
    if (isFetching) {
        return res.json({
            success: true,
            rates: cachedPrices, // إرجاع آخر سعر سليم مسجل بدلاً من إسقاط العميل
            lastUpdated: lastUpdatedTimestamp
        });
    }

    // 3️⃣ تفعيل القفل وجلب البيانات الجديدة بأمان
    isFetching = true;
    const freshPrices = await scrapeWithRetry();
    isFetching = false;

    if (freshPrices) {
        cachedPrices = freshPrices;
        lastFetchTime = currentTime;
        lastUpdatedTimestamp = new Date().toISOString(); // تحديث الـ Timestamp الحقيقي
    } else {
        // 🛡️ لو فشل تماماً (بسبب تغير الواجهة أو عطل موقع الصاغة) السيرفر هيعتمد على آخر كاش سليم متسجل جواه
        console.log("🚨 Scraping failed permanently. Falling back to previous cached prices.");
    }

    res.json({
        success: true, // دائماً true لأننا بنحميه بأسعار الكاش القديم
        rates: cachedPrices,
        lastUpdated: lastUpdatedTimestamp
    });
});

module.exports = app;

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`Local server on port ${PORT}`));
}