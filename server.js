const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

const TARGET_MANIFEST_URL = process.env.TARGET_MANIFEST_URL;

if (!TARGET_MANIFEST_URL) {
    console.error("LỖI: Chưa set TARGET_MANIFEST_URL");
    process.exit(1);
}

const getBaseUrl = (url) => url.replace('/manifest.json', '');
const TARGET_BASE_URL = getBaseUrl(TARGET_MANIFEST_URL);

// Giả lập trình duyệt (để không bị chặn)
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

const builder = new addonBuilder({
    id: "com.phim4k.smart.final",
    version: "4.0.0",
    name: "Phim4K (Auto-Match)",
    description: "Tự động khớp phim Tiếng Anh sang Tiếng Việt",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
});

// Hàm làm sạch chuỗi để so sánh (bỏ dấu câu, viết thường)
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
    // Chỉ xử lý ID IMDB
    if (!id.startsWith("tt")) return { streams: [] };

    console.log(`[Start] Tìm phim ID: ${id}`);

    // 1. Lấy thông tin phim gốc (Tên Anh + Năm)
    const meta = await getCinemetaMetadata(type, id);
    if (!meta) return { streams: [] };

    const englishName = cleanText(meta.name); // Ví dụ: "dune part two"
    const year = meta.year; // Ví dụ: "2024"
    
    // 2. Tìm kiếm trên Phim4K
    const catalogId = type === 'movie' ? 'phim4k_movies' : 'phim4k_series';
    // Tìm bằng tên gốc (ví dụ "Dune")
    const searchUrl = `${TARGET_BASE_URL}/catalog/${type}/${catalogId}/search=${encodeURIComponent(meta.name)}.json`;

    try {
        console.log(`[Search] Đang tìm: "${meta.name}" (${year})`);
        const res = await axios.get(searchUrl, { headers: HEADERS, timeout: 10000 });
        
        if (!res.data || !res.data.metas || res.data.metas.length === 0) {
            console.log("-> Không tìm thấy kết quả nào.");
            return { streams: [] };
        }

        // 3. THUẬT TOÁN KHỚP THÔNG MINH
        // Duyệt qua danh sách phim trả về (có cả tiếng Việt lẫn Anh)
        const match = res.data.metas.find(m => {
            const serverName = cleanText(m.name); // Tên trên server (đã làm sạch)
            
            // Điều kiện 1: Phải chứa Năm phát hành (quan trọng nhất)
            // Phim4K ghi năm trong ngoặc, ví dụ "(2024)"
            const hasYear = m.name.includes(`(${year})`) || (m.releaseInfo && m.releaseInfo.includes(year));
            
            // Điều kiện 2: Tên trên server phải chứa tên tiếng Anh
            // Ví dụ: "hanh tinh cat phan hai dune part two" CHỨA "dune part two"
            const hasName = serverName.includes(englishName);

            return hasYear && hasName;
        });

        if (match) {
            console.log(`[Bingo] Khớp thành công: ${match.name} (ID: ${match.id})`);
            
            // 4. Lấy link stream bằng ID thực (ví dụ: phim4k:movie:11177)
            const streamUrl = `${TARGET_BASE_URL}/stream/${type}/${match.id}.json`;
            const streamRes = await axios.get(streamUrl, { headers: HEADERS });

            if (streamRes.data && streamRes.data.streams) {
                return {
                    streams: streamRes.data.streams.map(s => ({
                        ...s,
                        name: `[Phim4K] ${s.name || 'VIP'}`,
                        description: `Server: ${match.name}`
                    }))
                };
            }
        } else {
            console.log("-> Có kết quả nhưng không khớp năm hoặc tên.");
        }

    } catch (error) {
        console.error(`Lỗi: ${error.message}`);
    }

    return { streams: [] };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });
