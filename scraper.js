const { chromium } = require('playwright');
const fs = require('fs');

// دالة للتحقق من تشابه النصوص
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

// دالة لاستخراج تفاصيل الأفلام من صفحة واحدة
async function extractMoviesFromPage(page) {
    return await page.evaluate(() => {
        const movies = [];
        const movieCards = document.querySelectorAll('h2.line-clamp-2 a');
        
        movieCards.forEach((link, index) => {
            const title = link.textContent.trim();
            const reelshortUrl = "https://www.reelshort.com" + link.getAttribute('href');
            
            // البحث عن العنصر الأب الذي يحتوي على جميع التفاصيل
            const card = link.closest('div[class*="relative"]') || link.closest('a')?.parentElement?.parentElement;
            
            let description = '';
            let imageUrl = '';
            let views = '';
            let rating = '';
            
            if (card) {
                // استخراج الوصف
                const descElement = card.querySelector('.line-clamp-3, [class*="line-clamp-3"]');
                if (descElement) {
                    description = descElement.textContent.trim();
                }
                
                // استخراج الصورة
                const imgElement = card.querySelector('img');
                if (imgElement) {
                    imageUrl = imgElement.getAttribute('src') || imgElement.getAttribute('srcset')?.split(' ')[0] || '';
                }
                
                // استخراج المشاهدات والنجوم من الصفحة كاملة
                const viewsElement = document.querySelector('.flex.text-white\\/50 .flex.items-center:first-child span:last-child');
                const ratingElement = document.querySelector('.flex.text-white\\/50 .flex.items-center:last-child span:last-child');
                
                if (viewsElement) views = viewsElement.textContent.trim();
                if (ratingElement) rating = ratingElement.textContent.trim();
            }
            
            movies.push({
                title,
                description,
                imageUrl,
                views,
                rating,
                reelshortUrl,
                dailymotionEmbedUrl: null
            });
        });
        
        return movies;
    });
}

// دالة للبحث عن فيلم في Dailymotion
async function searchDailymotion(page, movieTitle) {
    try {
        const searchTitle = movieTitle.replace(/\[\s*مدبلج\s*\]/g, '').trim();
        const searchUrl = `https://www.dailymotion.com/search/${encodeURIComponent(searchTitle)}/videos`;
        
        await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });
        
        // انتظار ظهور النتائج
        await page.waitForSelector('a[href^="/video/"]', { timeout: 10000 }).catch(() => null);
        
        const embedUrl = await page.evaluate((originalTitle) => {
            const videoLinks = Array.from(document.querySelectorAll('a[href^="/video/"]'));
            
            for (let link of videoLinks) {
                const videoTitle = link.getAttribute('title') || 
                                  link.querySelector('h2, h3, span')?.textContent?.trim() || '';
                const href = link.getAttribute('href');
                
                if (href && videoTitle) {
                    const videoId = href.split('/video/')[1]?.split('?')[0];
                    if (videoId) {
                        // التحقق من تطابق العنوان (نسبة تشابه 60% على الأقل)
                        const similarity = checkSimilarityWords(originalTitle, videoTitle);
                        if (similarity >= 2) {
                            return `https://www.dailymotion.com/embed/video/${videoId}`;
                        }
                    }
                }
            }
            return null;
        }, movieTitle);
        
        return embedUrl;
    } catch (error) {
        console.log(`خطأ في البحث عن "${movieTitle}": ${error.message}`);
        return null;
    }
}

// دالة مساعدة لحساب تشابه الكلمات
function checkSimilarityWords(title1, title2) {
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
    
    const allMovies = [];
    const baseUrl = "https://www.reelshort.com/ar/shelf/%D9%85%D8%AF%D8%A8%D9%84%D8%AC-short-movies-dramas-118859";
    
    try {
        let currentPage = 1;
        let hasMorePages = true;
        
        while (hasMorePages) {
            const pageUrl = currentPage === 1 ? baseUrl : `${baseUrl}/${currentPage}`;
            console.log(`\n📄 جاري معالجة الصفحة ${currentPage}: ${pageUrl}`);
            
            try {
                await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 30000 });
                
                // التحقق من وجود أفلام في الصفحة
                const hasMovies = await page.waitForSelector('h2.line-clamp-2 a', { timeout: 10000 })
                    .then(() => true)
                    .catch(() => false);
                
                if (!hasMovies) {
                    console.log(`لا توجد أفلام في الصفحة ${currentPage}، التوقف عن التنقل.`);
                    hasMorePages = false;
                    break;
                }
                
                // استخراج الأفلام من الصفحة الحالية
                const movies = await extractMoviesFromPage(page);
                
                if (movies.length === 0) {
                    console.log(`لم يتم العثور على أفلام في الصفحة ${currentPage}`);
                    hasMorePages = false;
                    break;
                }
                
                console.log(`تم العثور على ${movies.length} فيلم في الصفحة ${currentPage}`);
                
                // البحث عن كل فيلم في Dailymotion
                for (let i = 0; i < movies.length; i++) {
                    console.log(`\n🔍 [${allMovies.length + i + 1}] جاري البحث عن: "${movies[i].title}"`);
                    
                    const embedUrl = await searchDailymotion(page, movies[i].title);
                    movies[i].dailymotionEmbedUrl = embedUrl || "لم يتم العثور على رابط";
                    
                    if (embedUrl) {
                        console.log(`✅ تم العثور على الرابط: ${embedUrl}`);
                    } else {
                        console.log(`❌ لم يتم العثور على رابط للفيلم`);
                    }
                    
                    // حفظ مؤقت بعد كل فيلم لتجنب فقدان البيانات
                    allMovies.push(movies[i]);
                    fs.writeFileSync('movies_progress.json', JSON.stringify(allMovies, null, 2), 'utf-8');
                }
                
                currentPage++;
                
                // تأخير بسيط بين الصفحات
                await page.waitForTimeout(2000);
                
            } catch (error) {
                console.log(`خطأ في معالجة الصفحة ${currentPage}: ${error.message}`);
                hasMorePages = false;
            }
        }
        
        // حفظ النتائج النهائية
        console.log(`\n✨ تم الانتهاء من استخراج ${allMovies.length} فيلم`);
        fs.writeFileSync('all_movies_final.json', JSON.stringify(allMovies, null, 2), 'utf-8');
        
        // عرض إحصائيات
        const moviesWithLinks = allMovies.filter(m => m.dailymotionEmbedUrl && m.dailymotionEmbedUrl !== "لم يتم العثور على رابط");
        console.log(`📊 إحصائيات:`);
        console.log(`- إجمالي الأفلام: ${allMovies.length}`);
        console.log(`- الأفلام التي تم العثور على روابط لها: ${moviesWithLinks.length}`);
        console.log(`- الأفلام بدون روابط: ${allMovies.length - moviesWithLinks.length}`);
        
    } catch (error) {
        console.error("حدث خطأ أثناء العمل:", error);
        // حفظ ما تم استخراجه حتى الآن
        if (allMovies.length > 0) {
            fs.writeFileSync('movies_partial_results.json', JSON.stringify(allMovies, null, 2), 'utf-8');
            console.log(`تم حفظ ${allMovies.length} فيلم في ملف الطوارئ`);
        }
    } finally {
        await browser.close();
        console.log("تم إغلاق المتصفح.");
    }
}

startScraping();
