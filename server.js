const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

const TARGET_MANIFEST_URL = process.env.TARGET_MANIFEST_URL;

if (!TARGET_MANIFEST_URL) {
    console.error("LỖI: Chưa set TARGET_MANIFEST_URL");
    process.exit(1);
}

const getBaseUrl = (url) => url.replace('/manifest.json', '');
const TARGET_BASE_URL = getBaseUrl(TARGET_MANIFEST_URL);

// Headers giả lập trình duyệt
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

const builder = new addonBuilder({
    id: "com.phim4k.vip.final.v7",
    version: "7.0.0",
    name: "Phim4K VIP (Full Source)",
    description: "Xem phim chất lượng gốc từ Phim4K",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
});

function cleanText(text) {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

async function getCinemetaMetadata(type, imdbId) {
    try {
        const res = await axios.get(`https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`);
        return (res.data && res.data.meta) ? res.data.meta : null;
    } catch (e) { return null; }
}

builder.defineStreamHandler(async ({ type, id }) => {
    // 1. Chỉ nhận ID IMDB
    if (!id.startsWith("tt")) return { streams: [] };

    // 2. Lấy thông tin phim
    const meta = await getCinemetaMetadata(type, id);
    if (!meta) return { streams: [] };

    const englishName = cleanText(meta.name);
    const year = parseInt(meta.year); // Chuyển năm về dạng số

    // 3. Gọi API Search của Phim4K
    const catalogId = type === 'movie' ? 'phim4k_movies' : 'phim4k_series';
    const searchUrl = `${TARGET_BASE_URL}/catalog/${type}/${catalogId}/search=${encodeURIComponent(meta.name)}.json`;

    try {
        console.log(`Tìm kiếm: ${meta.name} (${year})`);
        const res = await axios.get(searchUrl, { headers: HEADERS, timeout: 8000 });
        
        if (!res.data || !res.data.metas || res.data.metas.length === 0) {
            return { streams: [] };
        }

        // 4. THUẬT TOÁN KHỚP THÔNG MINH (Chấp nhận sai số năm +/- 1)
        const match = res.data.metas.find(m => {
            const serverName = cleanText(m.name);
            
            // Kiểm tra tên tiếng Anh có nằm trong tên server không
            const nameMatch = serverName.includes(englishName);

            // Kiểm tra năm: Tìm chuỗi số 4 chữ số trong tên server (ví dụ 2024)
            const yearMatches = m.name.match(/\d{4}/g);
            let yearMatch = false;

            if (yearMatches) {
                // Nếu tìm thấy năm nào trong tên server sai lệch không quá 1 năm so với IMDB
                yearMatch = yearMatches.some(y => Math.abs(parseInt(y) - year) <= 1);
            } else if (m.releaseInfo) {
                // Fallback check releaseInfo
                yearMatch = m.releaseInfo.includes(year.toString());
            }

            return nameMatch && yearMatch;
        });

        if (match) {
            // Lấy ID số (bỏ phần phim4k:movie:...)
            const shortId = match.id.split(':').pop();
            console.log(`Đã khớp: ${match.name} | ID: ${shortId}`);

            // 5. Lấy Link Stream
            const streamUrl = `${TARGET_BASE_URL}/stream/${type}/${shortId}.json`;
            const streamRes = await axios.get(streamUrl, { headers: HEADERS });

            if (streamRes.data && streamRes.data.streams) {
                // TRẢ VỀ TOÀN BỘ SOURCE (Khắc phục vấn đề 2, 3, 4)
                return {
                    streams: streamRes.data.streams.map(s => {
                        return {
                            name: "Phim4K VIP",      // Tên Addon bên trái
                            title: s.title || s.name, // Hiển thị tên file gốc (VD: DUNE.PART.TWO...)
                            url: s.url,               // Link Proxy gốc (Không qua Google)
                            behaviorHints: {
                                notWebReady: false,
                                bingeGroup: "phim4k-best"
                            }
                        };
                    })
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
