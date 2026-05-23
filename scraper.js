const { chromium } = require('playwright');
const fs = require('fs');

async function startScraping() {
    console.log("جاري تشغيل المتصفح...");
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();

    try {
        const reelShortUrl = "https://www.reelshort.com/ar/shelf/%D9%85%D8%AF%D8%A8%D9%84%D8%AC-short-movies-dramas-118859";
        console.log(`جاري الانتقال إلى: ${reelShortUrl}`);
        
        await page.goto(reelShortUrl, { waitUntil: 'networkidle', timeout: 30000 });
        
        // انتظار تحميل العناصر
        await page.waitForSelector('h2.line-clamp-2 a', { timeout: 15000 });
        await page.waitForTimeout(3000); // انتظار إضافي للتأكد من تحميل كل شيء

        // استخراج التفاصيل
        const movieDetails = await page.evaluate(() => {
            // البحث عن الكارد الأول
            const movieCard = document.querySelector('.flex.overflow-hidden');
            if (!movieCard) {
                console.log('لم يتم العثور على كارد الفيلم');
                return null;
            }

            // استخراج العنوان
            const titleElement = movieCard.querySelector('h2.line-clamp-2 a');
            const title = titleElement ? titleElement.textContent.trim() : '';
            const reelshortUrl = titleElement ? "https://www.reelshort.com" + titleElement.getAttribute('href') : '';

            // استخراج الصورة - البحث عن img داخل الـ span
            const imgElement = movieCard.querySelector('img[alt]');
            let imageUrl = '';
            let imageAlt = '';
            if (imgElement) {
                imageAlt = imgElement.getAttribute('alt') || '';
                // محاولة استخراج src أولاً
                imageUrl = imgElement.getAttribute('src') || '';
                // إذا لم يكن هناك src، جرب srcset
                if (!imageUrl || imageUrl.startsWith('data:image')) {
                    const srcset = imgElement.getAttribute('srcset');
                    if (srcset) {
                        // خذ آخر رابط في srcset (الأعلى جودة)
                        const srcsetParts = srcset.split(',');
                        const lastPart = srcsetParts[srcsetParts.length - 1].trim();
                        imageUrl = lastPart.split(' ')[0];
                    }
                }
            }

            // استخراج الوصف
            const descriptionElement = movieCard.querySelector('.rich-text.inner-html-clamp');
            const description = descriptionElement ? descriptionElement.textContent.trim() : '';

            // استخراج المشاهدات والإعجابات
            let views = '';
            let likes = '';
            
            // البحث عن كل عناصر الإحصائيات
            const statElements = movieCard.querySelectorAll('.flex.items-center');
            
            statElements.forEach(el => {
                const text = el.textContent.trim();
                // المشاهدات عادة تحتوي على M (مليون)
                if (text.includes('M') && !views) {
                    views = text;
                }
                // الإعجابات أيضاً تحتوي على M
                else if (text.includes('M') && views) {
                    likes = text;
                }
            });

            // إذا لم نجد بالطريقة الأولى، نجرب البحث المباشر
            if (!views) {
                const allStats = movieCard.querySelectorAll('.flex.text-white\\/50 .flex.items-center');
                if (allStats.length >= 2) {
                    views = allStats[0].textContent.trim();
                    likes = allStats[1].textContent.trim();
                }
            }

            return {
                title: title,
                reelshortUrl: reelshortUrl,
                image: {
                    url: imageUrl,
                    alt: imageAlt
                },
                description: description,
                views: views,
                likes: likes
            };
        });

        if (!movieDetails || !movieDetails.title) {
            console.log("لم يتم العثور على بيانات الفيلم. جاري محاولة طريقة بديلة...");
            
            // طريقة بديلة: طباعة HTML للتحقق
            const htmlSample = await page.evaluate(() => {
                const card = document.querySelector('.flex.overflow-hidden');
                return card ? card.outerHTML.substring(0, 1000) : 'لم يتم العثور على الكارد';
            });
            console.log("عينة HTML:", htmlSample);
            
            // تجربة استخراج مباشر
            const directData = await page.evaluate(() => {
                const title = document.querySelector('h2.line-clamp-2 a')?.textContent.trim() || '';
                const img = document.querySelector('img[alt]');
                const imgSrc = img ? (img.getAttribute('src') || img.getAttribute('srcset')?.split(',').pop()?.trim()?.split(' ')[0]) : '';
                const desc = document.querySelector('.rich-text')?.textContent.trim() || '';
                
                return { title, imgSrc, desc };
            });
            
            console.log("بيانات مباشرة:", directData);
        }

        console.log("البيانات المستخرجة:", JSON.stringify(movieDetails, null, 2));

        // البحث في Dailymotion
        if (movieDetails && movieDetails.title) {
            const searchTitle = movieDetails.title.replace(/\[\s*مدبلج\s*\]/g, '').trim();
            const dailymotionSearchUrl = `https://www.dailymotion.com/search/${encodeURIComponent(searchTitle)}/videos`;
            
            console.log(`جاري البحث في Dailymotion: ${searchTitle}`);
            await page.goto(dailymotionSearchUrl, { waitUntil: 'networkidle', timeout: 30000 });
            await page.waitForTimeout(3000);

            const embedUrl = await page.evaluate(() => {
                const videoLink = document.querySelector('a[href^="/video/"]');
                if (videoLink) {
                    const href = videoLink.getAttribute('href');
                    const videoId = href.split('/video/')[1]?.split('?')[0];
                    return videoId ? `https://www.dailymotion.com/embed/video/${videoId}` : null;
                }
                return null;
            });

            movieDetails.dailymotionEmbedUrl = embedUrl || "لم يتم العثور على رابط";
            console.log("رابط Dailymotion:", movieDetails.dailymotionEmbedUrl);
        }

        // حفظ النتائج
        fs.writeFileSync('result.json', JSON.stringify(movieDetails, null, 2), 'utf-8');
        console.log("✓ تم حفظ النتائج في result.json");

    } catch (error) {
        console.error("خطأ:", error.message);
        // حفظ الخطأ في الملف أيضاً للتصحيح
        fs.writeFileSync('result.json', JSON.stringify({
            error: error.message,
            timestamp: new Date().toISOString()
        }, null, 2));
    } finally {
        await browser.close();
    }
}

startScraping();
