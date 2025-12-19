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
    id: "com.phim4k.vip.final.v8",
    version: "8.0.0",
    name: "Phim4K VIP (Full ID)",
    description: "Fix lỗi ID format và hiện full source",
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
    if (!id.startsWith("tt")) return { streams: [] };

    const meta = await getCinemetaMetadata(type, id);
    if (!meta) return { streams: [] };

    const englishName = cleanText(meta.name);
    const year = parseInt(meta.year);

    // 1. Tìm kiếm phim
    const catalogId = type === 'movie' ? 'phim4k_movies' : 'phim4k_series';
    const searchUrl = `${TARGET_BASE_URL}/catalog/${type}/${catalogId}/search=${encodeURIComponent(meta.name)}.json`;

    try {
        console.log(`Tìm kiếm: ${meta.name} (${year})`);
        const res = await axios.get(searchUrl, { headers: HEADERS, timeout: 8000 });
        
        if (!res.data || !res.data.metas || res.data.metas.length === 0) {
            return { streams: [] };
        }

        // 2. Lọc kết quả (Chấp nhận sai lệch 1 năm)
        const match = res.data.metas.find(m => {
            const serverName = cleanText(m.name);
            const nameMatch = serverName.includes(englishName);
            
            // Logic tìm năm
            const yearMatches = m.name.match(/\d{4}/g);
            let yearMatch = false;
            if (yearMatches) {
                yearMatch = yearMatches.some(y => Math.abs(parseInt(y) - year) <= 1);
            } else if (m.releaseInfo) {
                yearMatch = m.releaseInfo.includes(year.toString());
            }
            return nameMatch && yearMatch;
        });

        if (match) {
            // SỬA ĐỔI QUAN TRỌNG: Lấy Full ID (phim4k:movie:11177)
            const fullId = match.id; 
            console.log(`Đã khớp: ${match.name} | Full ID: ${fullId}`);

            // Gửi request lấy link với FULL ID (encodeURIComponent để xử lý dấu hai chấm ':')
            const streamUrl = `${TARGET_BASE_URL}/stream/${type}/${encodeURIComponent(fullId)}.json`;
            const streamRes = await axios.get(streamUrl, { headers: HEADERS });

            if (streamRes.data && streamRes.data.streams) {
                console.log(`-> Tìm thấy ${streamRes.data.streams.length} link.`);
                
                // 3. Trả về danh sách link (Map đúng định dạng bạn yêu cầu)
                return {
                    streams: streamRes.data.streams.map(s => {
                        return {
                            // Tên Addon (bên trái)
                            name: "Phim4K VIP",      
                            
                            // Title: Hiện tên file gốc (VD: (VIETSUB) DUNE.PART.TWO...)
                            title: s.title || s.name, 
                            
                            // URL: Link Proxy gốc (https://stremio.phim4k.xyz/proxy/...)
                            url: s.url,               
                            
                            behaviorHints: {
                                notWebReady: false,
                                bingeGroup: "phim4k-vip"
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
