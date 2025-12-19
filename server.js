const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

const TARGET_MANIFEST_URL = process.env.TARGET_MANIFEST_URL;

if (!TARGET_MANIFEST_URL) {
    console.error("LỖI: Chưa set TARGET_MANIFEST_URL");
    process.exit(1);
}

const getBaseUrl = (url) => url.replace('/manifest.json', '');
const TARGET_BASE_URL = getBaseUrl(TARGET_MANIFEST_URL);

// Headers giả lập trình duyệt để tránh bị chặn
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

const builder = new addonBuilder({
    id: "com.phim4k.vip.pro",
    version: "7.0.0",
    name: "Phim4K VIP (Full Source)",
    description: "Hiển thị đầy đủ link VIP & Tên gốc",
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
    console.log(`\n=== Xử lý request: ${type} - ${id} ===`);

    // 1. Xử lý ID cho Series (ví dụ: tt12345:1:1 -> lấy tt12345)
    let imdbId = id;
    let season = null;
    let episode = null;

    if (id.includes(":")) {
        const parts = id.split(":");
        imdbId = parts[0];
        season = parts[1];
        episode = parts[2];
    }

    if (!imdbId.startsWith("tt")) return { streams: [] };

    // 2. Lấy tên phim gốc từ Cinemeta
    const meta = await getCinemetaMetadata(type, imdbId);
    if (!meta) {
        console.log("-> Không lấy được metadata.");
        return { streams: [] };
    }

    const englishName = cleanText(meta.name);
    const year = meta.year; // Năm phát hành (quan trọng để lọc)

    console.log(`-> Phim: ${meta.name} (${year})`);

    // 3. Tìm kiếm trên Phim4K
    // Lưu ý: Series và Movie dùng catalog ID khác nhau
    const catalogId = type === 'movie' ? 'phim4k_movies' : 'phim4k_series';
    const searchUrl = `${TARGET_BASE_URL}/catalog/${type}/${catalogId}/search=${encodeURIComponent(meta.name)}.json`;

    try {
        const res = await axios.get(searchUrl, { headers: HEADERS, timeout: 8000 });
        
        if (!res.data || !res.data.metas || res.data.metas.length === 0) {
            console.log("-> Tìm kiếm trên Phim4K trả về rỗng.");
            return { streams: [] };
        }

        // 4. Thuật toán khớp phim (Chính xác hơn)
        const match = res.data.metas.find(m => {
            const serverName = cleanText(m.name);
            
            // Điều kiện 1: Phải có Năm phát hành (trong tên hoặc releaseInfo)
            // Ví dụ server ghi: "Dune Part Two (2024)"
            const hasYear = m.name.includes(year) || (m.releaseInfo && m.releaseInfo.includes(year));
            
            // Điều kiện 2: Tên server phải chứa tên tiếng Anh (tương đối)
            const hasName = serverName.includes(englishName);

            // Logic mở rộng: Nếu khớp tên chính xác mà không thấy năm (do server ghi thiếu), vẫn chấp nhận rủi ro
            if (!hasYear && serverName === englishName) return true;

            return hasYear && hasName;
        });

        if (match) {
            // Lấy ID số (Quan trọng nhất để không bị lỗi Invalid ID Format)
            // Ví dụ: phim4k:movie:11177 -> 11177
            const shortId = match.id.split(':').pop(); 
            console.log(`-> Đã khớp ID: ${shortId} (Gốc: ${match.name})`);

            // 5. Gọi API lấy link stream
            // Nếu là series, ta vẫn gọi ID của show. Việc lọc tập phim phụ thuộc vào server trả về gì.
            // (Hiện tại ta cứ lấy hết link server trả về cho ID này)
            const streamUrl = `${TARGET_BASE_URL}/stream/${type}/${shortId}.json`;
            const streamRes = await axios.get(streamUrl, { headers: HEADERS });

            if (streamRes.data && streamRes.data.streams && streamRes.data.streams.length > 0) {
                console.log(`-> Tìm thấy ${streamRes.data.streams.length} links.`);

                // 6. MAP DỮ LIỆU (Theo đúng yêu cầu của bạn)
                const finalStreams = streamRes.data.streams.map(s => {
                    return {
                        // Title: Giữ nguyên tên file gốc (VIETSUB DUNE...)
                        title: s.title || s.name, 
                        
                        // Name: Nhãn hiển thị bên trái
                        name: `[Phim4K] ${type === 'series' ? `S${season}E${episode}` : 'VIP'}`,
                        
                        // URL: Link xem phim
                        url: s.url,
                        
                        behaviorHints: {
                            notWebReady: false,
                            bingeGroup: `phim4k-${shortId}`
                        }
                    };
                });

                // Lọc link lỗi (nếu title chứa chữ "Error")
                const cleanStreams = finalStreams.filter(s => !s.title.includes("Error: Invalid ID"));
                
                return { streams: cleanStreams };
            }
        } else {
            console.log("-> Có kết quả tìm kiếm nhưng không khớp tên/năm.");
        }

    } catch (error) {
        console.error(`Lỗi hệ thống: ${error.message}`);
    }

    return { streams: [] };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });
