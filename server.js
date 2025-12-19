const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

const TARGET_MANIFEST_URL = process.env.TARGET_MANIFEST_URL;

if (!TARGET_MANIFEST_URL) {
    console.error("LỖI: Chưa set biến môi trường TARGET_MANIFEST_URL");
    process.exit(1);
}

// Hàm lấy Base URL (giữ nguyên token)
const getBaseUrl = (url) => url.replace('/manifest.json', '');
const TARGET_BASE_URL = getBaseUrl(TARGET_MANIFEST_URL);

// Cấu hình Headers giả lập trình duyệt để tránh bị chặn
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const builder = new addonBuilder({
    id: "com.phim4k.smart.bridge",
    version: "2.0.5",
    name: "Phim4K VIP (Cinemeta Sync)",
    description: "Tự động tìm và khớp phim từ Cinemeta sang Phim4K",
    resources: ["stream"],
    types: ["movie", "series"],
    idPrefixes: ["tt"], // Hỗ trợ IMDB ID
    catalogs: []
});

// Hàm lấy thông tin tên phim từ Cinemeta (dựa vào ID tt...)
async function getCinemetaMetadata(type, imdbId) {
    try {
        const metaUrl = `https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`;
        const res = await axios.get(metaUrl);
        if (res.data && res.data.meta) {
            return {
                name: res.data.meta.name,
                year: res.data.meta.year,
                releaseInfo: res.data.meta.releaseInfo
            };
        }
    } catch (e) {
        console.error(`Lỗi lấy meta Cinemeta: ${e.message}`);
    }
    return null;
}

// Hàm tìm kiếm trên Phim4K để lấy ID phim4k:...
async function findPhim4kId(type, title, year) {
    // Xác định Catalog ID dựa trên manifest của Phim4K
    const catalogId = type === 'movie' ? 'phim4k_movies' : 'phim4k_series';
    
    // Tạo link search: /catalog/{type}/{catalogId}/search={query}.json
    const searchUrl = `${TARGET_BASE_URL}/catalog/${type}/${catalogId}/search=${encodeURIComponent(title)}.json`;
    
    console.log(`[Search] Đang tìm trên Phim4K: ${title} (${year})`);

    try {
        const res = await axios.get(searchUrl, { headers: { 'User-Agent': USER_AGENT } });
        
        if (!res.data || !res.data.metas || res.data.metas.length === 0) {
            return null;
        }

        // LỌC KẾT QUẢ: Tìm phim có năm phát hành trùng khớp
        // Phim4K thường trả về nhiều kết quả, ta cần lấy cái chính xác nhất
        const match = res.data.metas.find(meta => {
            // So sánh năm (chấp nhận sai số +/- 1 năm vì đôi khi lệch ngày công chiếu)
            const metaYear = parseInt(meta.releaseInfo || meta.year);
            const targetYear = parseInt(year);
            if (metaYear && targetYear) {
                 return Math.abs(metaYear - targetYear) <= 1;
            }
            return true; // Nếu không có năm thì tạm chấp nhận
        });

        if (match) {
            console.log(`[Match] Tìm thấy khớp: ${match.name} (ID: ${match.id})`);
            return match.id; // Trả về ID dạng "phim4k:..."
        }
        
    } catch (e) {
        console.error(`Lỗi search Phim4K: ${e.message}`);
    }
    return null;
}

builder.defineStreamHandler(async ({ type, id }) => {
    // 1. Chỉ xử lý ID IMDB
    if (!id.startsWith("tt")) return { streams: [] };

    console.log(`--- Xử lý request: ${type} ${id} ---`);

    // 2. Lấy tên phim từ Cinemeta
    const meta = await getCinemetaMetadata(type, id);
    if (!meta) {
        console.log("Không tìm thấy thông tin phim trên Cinemeta");
        return { streams: [] };
    }

    // 3. Dùng tên phim để tìm ID thật bên Phim4K
    const phim4kId = await findPhim4kId(type, meta.name, meta.year);

    if (!phim4kId) {
        console.log(`Không tìm thấy phim "${meta.name}" trên server Phim4K.`);
        return { streams: [] };
    }

    // 4. Lấy stream bằng ID thật (phim4k:...)
    const streamUrl = `${TARGET_BASE_URL}/stream/${type}/${phim4kId}.json`;
    
    try {
        const response = await axios.get(streamUrl, { 
            timeout: 15000,
            headers: { 'User-Agent': USER_AGENT }
        });
        
        if (response.data && response.data.streams && response.data.streams.length > 0) {
            const modifiedStreams = response.data.streams.map(s => ({
                ...s,
                name: `[Phim4K] ${s.name || 'VIP'}`,
                description: s.title || `Sync từ: ${meta.name}`
            }));
            return { streams: modifiedStreams };
        }
    } catch (error) {
        console.error(`Lỗi lấy stream final: ${error.message}`);
    }

    return { streams: [] };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });
