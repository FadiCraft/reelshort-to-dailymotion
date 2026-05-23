const { chromium } = require('playwright');
const fs = require('fs');

// دالة بسيطة للتحقق من تشابه النصوص (عدد الكلمات المشتركة)
function checkSimilarity(title1, title2) {
    const words1 = title1.toLowerCase().replace(/[^\u0621-\u064A0-9a-zA-Z\s]/g, '').split(/\s+/);
    const words2 = title2.toLowerCase().replace(/[^\u0621-\u064A0-9a-zA-Z\s]/g, '').split(/\s+/);
    
    let matches = 0;
    words1.forEach(word => {
        if (word.length > 2 && words2.includes(word)) {
            matches++;
        }
    });
    return matches;
}

async function startScraping() {
    console.log("جاري تشغيل المتصفح...");
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    try {
        // ---- الخطوة 1: جلب اسم الفيلم من موقع ReelShort ----
        const reelShortUrl = "https://www.reelshort.com/ar/shelf/%D9%85%D8%AF%D8%A8%D9%84%D8%AC-short-movies-dramas-118859";
        console.log(`جاري الانتقال إلى موقع ReelShort: ${reelShortUrl}`);
        
        await page.goto(reelShortUrl, { waitUntil: 'networkidle' });
        
        // انتظام تحميل عناصر الأفلام بناءً على الكود الذي أرفقته
        await page.waitForSelector('h2.line-clamp-2 a', { timeout: 15000 });

        // استخراج تفاصيل أول فيلم
        const movieDetails = await page.evaluate(() => {
            const firstMovieLink = document.querySelector('h2.line-clamp-2 a');
            if (!firstMovieLink) return null;
            
            return {
                title: firstMovieLink.textContent.trim(),
                reelshortUrl: "https://www.reelshort.com" + firstMovieLink.getAttribute('href')
            };
        });

        if (!movieDetails) {
            console.log("لم يتم العثور على أي أفلام في الصفحة.");
            await browser.close();
            return;
        }

        console.log(`تم استخراج الفيلم بنجاح: "${movieDetails.title}"`);

        // ---- الخطوة 2: البحث في موقع Dailymotion ----
        // تنظيف الاسم من الإضافات مثل [ مدبلج ] للبحث بشكل أفضل
        const searchTitle = movieDetails.title.replace(/\[\s*مدبلج\s*\]/g, '').trim();
        const dailymotionSearchUrl = `https://www.dailymotion.com/search/${encodeURIComponent(searchTitle)}/videos`;
        
        console.log(`جاري البحث في Dailymotion عن: "${searchTitle}"`);
        await page.goto(dailymotionSearchUrl, { waitUntil: 'networkidle' });

        // الانتظار حتى تظهر نتائج البحث
        await page.waitForSelector('a[href^="/video/"]', { timeout: 15000 }).catch(() => null);

        // استخراج الفيديوهات ومطابقتها
        const embedUrl = await page.evaluate((originalTitle) => {
            const videoLinks = Array.from(document.querySelectorAll('a[href^="/video/"]'));
            
            for (let link of videoLinks) {
                const titleElement = link.querySelector('h2, span, xmp'); // حسب الهيكل الحالي لدايلي موشن
                const videoTitle = titleElement ? titleElement.textContent.trim() : link.getAttribute('title') || "";
                const href = link.getAttribute('href');

                if (href) {
                    // استخراج الـ ID الخاص بالفيديو (مثال: /video/x8q1abc -> x8q1abc)
                    const videoId = href.split('/video/')[1]?.split('?')[0];
                    
                    if (videoId) {
                        return `https://www.dailymotion.com/embed/video/${videoId}`;
                    }
                }
            }
            return null;
        }, movieDetails.title);

        if (embedUrl) {
            movieDetails.dailymotionEmbedUrl = embedUrl;
            console.log(`تم العثور على رابط الـ Embed: ${embedUrl}`);
        } else {
            movieDetails.dailymotionEmbedUrl = "لم يتم العثور على رابط مطابق";
            console.log("تعذر العثور على فيديو مطابق في Dailymotion.");
        }

        // ---- الخطوة 3: حفظ النتائج في ملف JSON ----
        fs.writeFileSync('result.json', JSON.stringify(movieDetails, null, 2), 'utf-8');
        console.log("تم حفظ النتائج في الملف result.json بنجاح.");

    } catch (error) {
        console.error("حدث خطأ أثناء العمل:", error);
    } finally {
        await browser.close();
    }
}

startScraping();
