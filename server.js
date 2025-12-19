const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

const TARGET_MANIFEST_URL = process.env.TARGET_MANIFEST_URL;

if (!TARGET_MANIFEST_URL) {
    console.error("LỖI: Chưa set TARGET_MANIFEST_URL");
    process.exit(1);
}

// Lấy Base URL sạch (bỏ phần manifest.json)
const getBaseUrl = (url) => url.replace('/manifest.json', '');
const TARGET_BASE_URL = getBaseUrl(TARGET_MANIFEST_URL);

// Headers giả lập trình duyệt (quan trọng)
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

const builder = new addonBuilder({
    id: "com.phim4k.smart.final.v6",
    version: "6.0.0",
    name: "Phim4K VIP (Auto-Link)",
    description: "Tự động lấy link stream VIP",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
});

// Hàm làm sạch tên để so sánh
function cleanText(text) {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

// 1. Lấy thông tin từ Cinemeta
async function getCinemetaMetadata(type, imdbId) {
    try {
        const res = await axios.get(`https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`);
        return (res.data && res.data.meta) ? res.data.meta : null;
    } catch (e) { return null; }
}

builder.defineStreamHandler(async ({ type, id }) => {
    // Chỉ xử lý ID IMDB (tt...)
    if (!id.startsWith("tt")) return { streams: [] };

    console.log(`\n=== Xử lý phim: ${id} ===`);

    const meta = await getCinemetaMetadata(type, id);
    if (!meta) return { streams: [] };

    const englishName = cleanText(meta.name);
    const year = meta.year;

    // 2. Tìm kiếm trên Phim4K
    const catalogId = type === 'movie' ? 'phim4k_movies' : 'phim4k_series';
    const searchUrl = `${TARGET_BASE_URL}/catalog/${type}/${catalogId}/search=${encodeURIComponent(meta.name)}.json`;

    try {
        console.log(`-> Đang tìm: "${meta.name}" (${year})`);
        const res = await axios.get(searchUrl, { headers: HEADERS, timeout: 8000 });
        
        if (!res.data || !res.data.metas || res.data.metas.length === 0) {
            console.log("-> Không tìm thấy phim trên server.");
            return { streams: [] };
        }

        // 3. Lọc kết quả trùng khớp
        const match = res.data.metas.find(m => {
            const serverName = cleanText(m.name);
            // Khớp năm HOẶC Khớp tên tiếng Anh trong chuỗi tên dài
            const matchYear = m.name.includes(year) || (m.releaseInfo && m.releaseInfo.includes(year));
            const matchName = serverName.includes(englishName);
            return matchYear && matchName;
        });

        if (match) {
            // QUAN TRỌNG: Cắt lấy số ID (Ví dụ: phim4k:movie:11177 -> 11177)
            const shortId = match.id.split(':').pop(); 
            console.log(`-> Đã khớp: ${match.name} | ID số: ${shortId}`);

            // 4. Lấy Link Stream bằng ID số (Cách này chắc chắn chạy vì bạn đã test)
            const streamUrl = `${TARGET_BASE_URL}/stream/${type}/${shortId}.json`;
            const streamRes = await axios.get(streamUrl, { headers: HEADERS });

            if (streamRes.data && streamRes.data.streams) {
                console.log(`-> THÀNH CÔNG: Tìm thấy ${streamRes.data.streams.length} link.`);
                
                // Trả về danh sách link cho Stremio
                return {
                    streams: streamRes.data.streams.map(s => ({
                        title: s.title || s.name,   // Tên file (VD: 4K HDR...)
                        url: s.url,                 // Link proxy xem phim
                        name: "[Phim4K] VIP",       // Tên hiện trên addon
                        behaviorHints: {
                            notWebReady: false,
                            bingeGroup: "phim4k-vip"
                        }
                    }))
                };
            }
        }
    } catch (error) {
        console.error(`Lỗi: ${error.message}`);
    }

    return { streams: [] };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });
