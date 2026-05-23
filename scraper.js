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
        
        // انتظار تحميل عناصر الأفلام
        await page.waitForSelector('h2.line-clamp-2 a', { timeout: 15000 });

        // استخراج تفاصيل أول فيلم شاملة الصورة والوصف والنجوم والإعجابات
        const movieDetails = await page.evaluate(() => {
            // البحث عن أول عنصر فيلم في الصفحة
            const movieCard = document.querySelector('.flex.overflow-hidden');
            if (!movieCard) return null;
            
            // استخراج العنوان والرابط
            const titleElement = movieCard.querySelector('h2.line-clamp-2 a');
            const title = titleElement ? titleElement.textContent.trim() : '';
            const reelshortUrl = titleElement ? "https://www.reelshort.com" + titleElement.getAttribute('href') : '';
            
            // استخراج الصورة
            const imgElement = movieCard.querySelector('img[alt]');
            const imageUrl = imgElement ? (imgElement.getAttribute('srcset')?.split(',')?.pop()?.trim()?.split(' ')[0] || imgElement.getAttribute('src')) : '';
            const imageAlt = imgElement ? imgElement.getAttribute('alt') : '';
            
            // استخراج الوصف
            const descriptionElement = movieCard.querySelector('.rich-text.inner-html-clamp');
            const description = descriptionElement ? descriptionElement.textContent.trim() : '';
            
            // استخراج عدد المشاهدات/النجوم (عادةً يكون مع أيقونة التشغيل)
            const viewsElement = movieCard.querySelector('.flex.items-center.mr-24\\/vw, .flex.items-center.mr-24px');
            const views = viewsElement ? viewsElement.textContent.trim() : '';
            
            // استخراج عدد الإعجابات (عادةً يكون مع أيقونة النجمة)
            const likesElements = movieCard.querySelectorAll('.flex.items-center');
            let likes = '';
            // نتخطى العنصر الأول إذا كان للمشاهدات ونأخذ الثاني
            if (likesElements.length >= 2) {
                likes = likesElements[1].textContent.trim();
            }
            
            // تنظيف النصوص من المسافات الزائدة
            const cleanViews = views.replace(/[\s\n]+/g, ' ').trim();
            const cleanLikes = likes.replace(/[\s\n]+/g, ' ').trim();
            
            return {
                title: title,
                reelshortUrl: reelshortUrl,
                image: {
                    url: imageUrl,
                    alt: imageAlt
                },
                description: description,
                views: cleanViews,
                likes: cleanLikes
            };
        });

        if (!movieDetails) {
            console.log("لم يتم العثور على أي أفلام في الصفحة.");
            await browser.close();
            return;
        }

        console.log("تم استخراج بيانات الفيلم بنجاح:");
        console.log(`- العنوان: "${movieDetails.title}"`);
        console.log(`- الصورة: ${movieDetails.image.url}`);
        console.log(`- الوصف: ${movieDetails.description.substring(0, 100)}...`);
        console.log(`- المشاهدات: ${movieDetails.views}`);
        console.log(`- الإعجابات: ${movieDetails.likes}`);

        // ---- الخطوة 2: البحث في موقع Dailymotion ----
        const searchTitle = movieDetails.title.replace(/\[\s*مدبلج\s*\]/g, '').trim();
        const dailymotionSearchUrl = `https://www.dailymotion.com/search/${encodeURIComponent(searchTitle)}/videos`;
        
        console.log(`جاري البحث في Dailymotion عن: "${searchTitle}"`);
        await page.goto(dailymotionSearchUrl, { waitUntil: 'networkidle' });

        await page.waitForSelector('a[href^="/video/"]', { timeout: 15000 }).catch(() => null);

        const embedUrl = await page.evaluate((originalTitle) => {
            const videoLinks = Array.from(document.querySelectorAll('a[href^="/video/"]'));
            
            for (let link of videoLinks) {
                const titleElement = link.querySelector('h2, span, xmp');
                const videoTitle = titleElement ? titleElement.textContent.trim() : link.getAttribute('title') || "";
                const href = link.getAttribute('href');

                if (href) {
                    const videoId = href.split('/video/')[1]?.split('?')[0];
                    
                    if (videoId) {
                        // التحقق من تطابق العنوان
                        const similarity = (videoTitle.toLowerCase().includes(originalTitle.toLowerCase().substring(0, 10))) || 
                                         (originalTitle.toLowerCase().includes(videoTitle.toLowerCase().substring(0, 10)));
                        
                        if (similarity || !videoTitle) {
                            return `https://www.dailymotion.com/embed/video/${videoId}`;
                        }
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
        console.log("\n--- ملخص البيانات المستخرجة ---");
        console.log(JSON.stringify(movieDetails, null, 2));

    } catch (error) {
        console.error("حدث خطأ أثناء العمل:", error);
    } finally {
        await browser.close();
    }
}

startScraping();
