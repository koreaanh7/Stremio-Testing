const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

const manifest = {
    id: "community.nguonc.phim",
    version: "1.0.8", // Tăng version để ép Stremio cập nhật cache
    name: "NguonC Phim & Anime",
    description: "Xem phim miễn phí từ NguonC. Hỗ trợ tự động chuyển tập.",
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

// --- HELPERS ---
// Hàm lấy dữ liệu an toàn, nếu lỗi trả về fallback
function safeGet(fn, fallback) {
    try {
        return fn();
    } catch (e) {
        return fallback;
    }
}

// Hàm chuẩn hóa ID
function parseId(id) {
    const parts = id.split(":");
    return {
        prefix: parts[0],
        slug: parts[1],
        episodeSlug: parts[2] // Có thể null nếu là movie
    };
}

// --- 1. CATALOG HANDLER ---
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    let url = `${API_BASE}/films/phim-moi-cap-nhat?page=1`;
    if (extra && extra.search) {
        url = `${API_BASE}/films/search?keyword=${encodeURIComponent(extra.search)}`;
    }

    try {
        const response = await axios.get(url);
        const items = response.data.items || [];
        
        return {
            metas: items.map(item => ({
                id: `nguonc:${item.slug}`,
                type: "movie", // Catalog luôn để movie để hiện chung
                name: item.name,
                poster: item.thumb_url,
                description: `Năm: ${item.year}`
            }))
        };
    } catch (e) {
        console.error("Lỗi Catalog:", e.message);
        return { metas: [] };
    }
});

// --- 2. META HANDLER (Quan trọng: Xử lý hiển thị tập) ---
builder.defineMetaHandler(async ({ type, id }) => {
    if (!id.startsWith("nguonc:")) return { meta: {} };
    const { slug } = parseId(id);

    try {
        const response = await axios.get(`${API_BASE}/film/${slug}`);
        const movie = response.data.movie;
        if (!movie) throw new Error("No movie data");

        // 1. Lấy danh sách tập an toàn
        const episodes = safeGet(() => movie.episodes[0].server_data, []);
        
        // 2. Xác định là Series hay Movie
        // Nếu có nhiều hơn 1 tập HOẶC danh mục chứa "Phim Bộ" -> Series
        const isSeries = episodes.length > 1 || 
                         JSON.stringify(movie.category || {}).includes("Phim Bộ");
        
        const stremioType = isSeries ? "series" : "movie";

        const metaObj = {
            id: id,
            type: stremioType,
            name: movie.name,
            poster: movie.thumb_url,
            background: movie.poster_url || movie.thumb_url,
            description: movie.content,
            releaseInfo: `${movie.year}`,
            language: movie.lang,
            genres: safeGet(() => movie.category.map(c => c.name), []),
        };

        // 3. Nếu là Series, BẮT BUỘC phải trả về mảng 'videos'
        if (episodes.length > 0) {
            metaObj.videos = episodes.map((ep, index) => ({
                id: `nguonc:${slug}:${ep.slug}`, // ID duy nhất cho từng tập
                title: ep.name,
                season: 1, // Gom hết vào season 1
                episode: index + 1,
                released: new Date().toISOString()
            }));
        } else {
             // Trường hợp phim lẻ, tạo 1 video ảo để Stremio hiểu
             metaObj.videos = [{
                id: `nguonc:${slug}:full`,
                title: "Full Movie",
                season: 1,
                episode: 1,
             }];
        }

        return { meta: metaObj };

    } catch (e) {
        console.error("Lỗi Meta:", e.message);
        return { meta: { id, type: "movie", name: "Lỗi tải thông tin" } };
    }
});

// --- 3. STREAM HANDLER (Fix lỗi crash) ---
builder.defineStreamHandler(async ({ type, id }) => {
    if (!id.startsWith("nguonc:")) return { streams: [] };
    const { slug, episodeSlug } = parseId(id);

    console.log(`Getting stream for: ${slug} - Ep: ${episodeSlug}`);

    try {
        const response = await axios.get(`${API_BASE}/film/${slug}`);
        const movie = response.data.movie;
        
        // Lấy danh sách tập một cách an toàn nhất
        const episodesList = (movie.episodes && movie.episodes[0]) 
                           ? movie.episodes[0].server_data 
                           : [];

        if (episodesList.length === 0) {
            console.log("Phim chưa có tập nào.");
            return { streams: [] };
        }

        let targetEpisode;

        // Logic tìm tập phim
        if (episodeSlug && episodeSlug !== "full") {
            // Tìm theo slug tập (ví dụ: tap-1, tap-2)
            targetEpisode = episodesList.find(ep => ep.slug == episodeSlug);
        } 
        
        // Fallback: Nếu không tìm thấy hoặc không có slug (play movie), lấy tập đầu tiên
        if (!targetEpisode) {
            targetEpisode = episodesList[0];
        }

        if (!targetEpisode) return { streams: [] };

        const streamUrl = targetEpisode.link_m3u8 || targetEpisode.link_embed;
        console.log("Found Stream:", streamUrl);

        return {
            streams: [
                {
                    title: `NguonC ⚡ ${movie.quality} - ${targetEpisode.name}`,
                    url: streamUrl,
                    behaviorHints: {
                        notWebReady: false,
                        bingeGroup: `nguonc-${slug}` // Tự động chuyển tập
                    }
                }
            ]
        };

    } catch (e) {
        console.error("Lỗi Stream:", e.message);
        return { streams: [] };
    }
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });
console.log(`Addon running on port ${port}`);
