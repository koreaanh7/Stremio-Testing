const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

const manifest = {
    id: "community.nguonc.phim",
    version: "1.0.5", // Tăng version lên để Stremio cập nhật
    name: "NguonC Phim & Anime",
    description: "Xem phim mới, phim bộ, anime từ NguonC. Hỗ trợ tìm kiếm.",
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

// --- HÀM HỖ TRỢ AN TOÀN (Safe Parsing) ---
function safeGet(fn, defaultValue) {
    try {
        return fn();
    } catch (e) {
        return defaultValue;
    }
}

// --- 1. CATALOG & SEARCH ---
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    let url = "";
    console.log("Request Catalog:", id, extra); // Log để debug trên Render

    if (extra && extra.search) {
        url = `${API_BASE}/films/search?keyword=${encodeURIComponent(extra.search)}`;
    } else if (id === "nguonc_phimmoi") {
        url = `${API_BASE}/films/phim-moi-cap-nhat?page=1`;
    } else {
        return { metas: [] };
    }

    try {
        const response = await axios.get(url);
        const items = response.data.items || [];
        
        const metas = items.map(item => ({
            id: `nguonc:${item.slug}`,
            type: "movie",
            name: item.name,
            poster: item.thumb_url,
            description: `Năm: ${item.year} - ${item.original_name || ''}`
        }));
        
        return { metas };
    } catch (error) {
        console.error("Lỗi Catalog:", error.message);
        return { metas: [] };
    }
});

// --- 2. META HANDLER (Chi tiết phim) ---
builder.defineMetaHandler(async ({ type, id }) => {
    console.log("Request Meta:", id); // Log để xem đang request phim gì
    if (!id.startsWith("nguonc:")) return { meta: {} };
    
    const slug = id.split(":")[1];

    try {
        const url = `${API_BASE}/film/${slug}`;
        const response = await axios.get(url);
        const movie = response.data.movie;

        if (!movie) throw new Error("Không tìm thấy data movie");

        // Logic xác định loại phim (Series hay Movie)
        // Nếu có nhiều tập hoặc thuộc danh mục Phim Bộ -> Series
        const isSeries = movie.total_episodes > 1 || 
                         (movie.category && JSON.stringify(movie.category).includes("Phim Bộ"));
        
        const stremioType = isSeries ? "series" : "movie";

        // Xử lý Category an toàn hơn (Tránh lỗi crash nếu API đổi format)
        let genres = [];
        if (Array.isArray(movie.category)) {
            genres = movie.category.map(c => c.name);
        } else if (typeof movie.category === 'object') {
            // Trường hợp API trả về object lồng nhau
            genres = Object.values(movie.category).flatMap(c => c.list ? c.list.map(i => i.name) : []);
        }

        const metaObj = {
            id: id,
            type: stremioType,
            name: movie.name,
            poster: movie.thumb_url,
            background: movie.poster_url || movie.thumb_url,
            description: movie.content || "Không có mô tả.",
            releaseInfo: safeGet(() => movie.year.toString(), ""),
            language: movie.lang,
            genres: genres,
            country: safeGet(() => movie.country[0].name, "")
        };

        // Xử lý danh sách tập (Videos) cho Phim Bộ
        if (movie.episodes && movie.episodes.length > 0) {
            const serverData = movie.episodes[0].server_data;
            if (serverData) {
                metaObj.videos = serverData.map((ep, index) => ({
                    id: `${id}:${ep.slug}`, // ID tập phim
                    title: ep.name,
                    season: 1,
                    episode: index + 1,
                    released: new Date().toISOString()
                }));
            }
        }

        return { meta: metaObj };

    } catch (error) {
        console.error(`Lỗi Meta [${id}]:`, error.message);
        // Trả về meta cơ bản để không bị lỗi màn hình đen
        return { 
            meta: { 
                id: id, 
                type: "movie", 
                name: "Lỗi tải dữ liệu: " + slug, 
                description: "Không thể lấy chi tiết phim này từ NguonC." 
            } 
        };
    }
});

// --- 3. STREAM HANDLER (Lấy link phim) ---
builder.defineStreamHandler(async ({ type, id }) => {
    console.log("Request Stream:", id);
    if (!id.startsWith("nguonc:")) return { streams: [] };

    const parts = id.split(":");
    const filmSlug = parts[1];
    const episodeSlug = parts[2];

    try {
        const response = await axios.get(`${API_BASE}/film/${filmSlug}`);
        const movie = response.data.movie;
        
        // Tìm tập phim phù hợp
        let targetEpisode;
        const serverData = safeGet(() => movie.episodes[0].server_data, []);

        if (episodeSlug) {
            // Nếu chọn tập cụ thể
            targetEpisode = serverData.find(ep => ep.slug === episodeSlug);
        } else {
            // Nếu bấm play từ ngoài (phim lẻ) -> Lấy tập 1
            targetEpisode = serverData[0];
        }

        if (!targetEpisode) return { streams: [] };

        const streamUrl = targetEpisode.link_m3u8 || targetEpisode.link_embed;

        return {
            streams: [
                {
                    title: `NguonC - ${targetEpisode.name} - ${movie.quality || 'HD'}`,
                    url: streamUrl,
                    behaviorHints: {
                        notWebReady: false,
                        bingeGroup: `nguonc-${filmSlug}`
                    }
                }
            ]
        };

    } catch (error) {
        console.error(`Lỗi Stream [${id}]:`, error.message);
        return { streams: [] };
    }
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });
console.log(`Addon đang chạy tại port: ${port}`);
