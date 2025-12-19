const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

const manifest = {
    id: "community.nguonc.phim",
    version: "1.1.2", // Tăng version
    name: "NguonC Phim & Anime",
    description: "Xem phim miễn phí từ NguonC. Hỗ trợ Phim Bộ & Embed.",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "anime"],
    catalogs: [
        {
            type: "movie",
            id: "nguonc_phimmoi",
            name: "NguonC - Mới Cập Nhật",
            extra: [{ name: "search", isRequired: false }]
        }
    ],
    idPrefixes: ["nguonc:"]
};

const builder = new addonBuilder(manifest);
const API_BASE = "https://phim.nguonc.com/api";

// --- HÀM HỖ TRỢ AN TOÀN TUYỆT ĐỐI ---
// Giúp lấy dữ liệu mà không bao giờ bị lỗi crash
function safeList(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (typeof data === 'object') return Object.values(data); // Chuyển Object thành Array
    return [];
}

// --- 1. CATALOG HANDLER ---
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    let url = `${API_BASE}/films/phim-moi-cap-nhat?page=1`;
    if (extra && extra.search) {
        url = `${API_BASE}/films/search?keyword=${encodeURIComponent(extra.search)}`;
    }

    try {
        const response = await axios.get(url);
        const items = safeList(response.data.items);
        
        return {
            metas: items.map(item => ({
                id: `nguonc:${item.slug}`,
                type: "movie",
                name: item.name,
                poster: item.thumb_url,
                description: `Năm: ${item.year}`
            }))
        };
    } catch (e) {
        console.error("Catalog Error:", e.message);
        return { metas: [] };
    }
});

// --- 2. META HANDLER (SỬA LỖI CRASH Ở ĐÂY) ---
builder.defineMetaHandler(async ({ type, id }) => {
    if (!id.startsWith("nguonc:")) return { meta: {} };
    const slug = id.split(":")[1];

    try {
        console.log(`Getting Meta: ${slug}`);
        const response = await axios.get(`${API_BASE}/film/${slug}`);
        const movie = response.data.movie;
        
        if (!movie) throw new Error("Empty movie data");

        // 1. Xử lý Thể loại (Category) an toàn: Chấp nhận cả Array và Object
        // Lỗi cũ nằm ở đây, giờ đã fix bằng safeList
        const categories = safeList(movie.category); 
        const genres = categories.map(c => c.name || (c.list ? c.list[0].name : ""));

        // 2. Lấy danh sách tập phim
        // NguonC thường để tập phim trong episodes[0].server_data
        const episodeServer = (movie.episodes && movie.episodes[0]) ? movie.episodes[0].server_data : [];
        const episodes = safeList(episodeServer);

        // 3. Xác định loại phim (Series hay Movie)
        // Nếu có nhiều hơn 1 tập HOẶC thuộc danh mục Phim Bộ
        const isSeries = episodes.length > 1 || 
                         JSON.stringify(categories).toLowerCase().includes("phim bộ");
        
        const stremioType = isSeries ? "series" : "movie";

        const metaObj = {
            id: id,
            type: stremioType,
            name: movie.name,
            poster: movie.thumb_url,
            background: movie.poster_url || movie.thumb_url,
            description: movie.content || "Không có mô tả",
            releaseInfo: `${movie.year}`,
            language: movie.lang,
            genres: genres,
            country: (movie.country && movie.country[0]) ? movie.country[0].name : ""
        };

        // 4. Tạo danh sách Video (Bắt buộc cho Series)
        if (episodes.length > 0) {
            metaObj.videos = episodes.map((ep, index) => ({
                id: `nguonc:${slug}:${ep.slug}`,
                title: ep.name,
                season: 1,
                episode: index + 1,
                released: new Date().toISOString()
            }));
        } else {
            // Fallback nếu không tìm thấy tập nào (để tránh lỗi giao diện)
             metaObj.videos = [{
                id: `nguonc:${slug}:full`,
                title: "Full Movie",
                season: 1,
                episode: 1,
             }];
        }

        return { meta: metaObj };

    } catch (e) {
        console.error(`Meta Error [${slug}]:`, e.message);
        // Trả về meta rỗng an toàn thay vì crash
        return { meta: { id, type: "movie", name: "Lỗi tải dữ liệu (Vui lòng thử lại)" } };
    }
});

// --- 3. STREAM HANDLER (Ưu tiên M3U8) ---
builder.defineStreamHandler(async ({ type, id }) => {
    if (!id.startsWith("nguonc:")) return { streams: [] };
    
    const parts = id.split(":");
    const filmSlug = parts[1];
    const episodeSlug = parts[2]; // Có thể là 'full' hoặc slug tập

    try {
        console.log(`Getting Stream: ${filmSlug} - Ep: ${episodeSlug}`);
        const response = await axios.get(`${API_BASE}/film/${filmSlug}`);
        const movie = response.data.movie;
        
        const episodeServer = (movie.episodes && movie.episodes[0]) ? movie.episodes[0].server_data : [];
        const episodes = safeList(episodeServer);

        if (episodes.length === 0) return { streams: [] };

        // Tìm tập phim
        let targetEpisode;
        if (episodeSlug && episodeSlug !== "full") {
            targetEpisode = episodes.find(ep => ep.slug == episodeSlug);
        }
        // Nếu không tìm thấy (hoặc là phim lẻ), lấy tập đầu tiên
        if (!targetEpisode) targetEpisode = episodes[0];

        if (!targetEpisode) return { streams: [] };

        // ƯU TIÊN link M3U8 vì Stremio chạy mượt nhất
        // Nếu không có M3U8 mới dùng Link Embed
        const streamUrl = targetEpisode.link_m3u8 || targetEpisode.link_embed;
        
        // Kiểm tra nếu là link Embed HTML (không phải video trực tiếp)
        const isEmbed = streamUrl.includes("embed");

        return {
            streams: [
                {
                    title: `NguonC - ${targetEpisode.name} (${movie.quality || 'HD'})`,
                    url: streamUrl,
                    behaviorHints: {
                        notWebReady: false,
                        bingeGroup: `nguonc-${filmSlug}`,
                        // Nếu là embed, thêm hint này để Stremio biết
                        headers: isEmbed ? { "User-Agent": "Mozilla/5.0" } : {}
                    }
                }
            ]
        };

    } catch (e) {
        console.error(`Stream Error:`, e.message);
        return { streams: [] };
    }
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });
console.log(`Addon active on port ${port}`);
