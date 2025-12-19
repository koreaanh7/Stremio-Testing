const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

const manifest = {
    id: "community.nguonc.phim",
    version: "1.0.2",
    name: "NguonC Phim & Anime",
    description: "Xem phim mới, phim bộ, anime từ NguonC. Hỗ trợ tìm kiếm.",
    // Khai báo các loại tài nguyên addon hỗ trợ
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "anime"],
    catalogs: [
        {
            type: "movie",
            id: "nguonc_phimmoi",
            name: "NguonC - Mới Cập Nhật",
            extra: [{ name: "search", isRequired: false }] // Cho phép chức năng tìm kiếm
        }
    ],
    idPrefixes: ["nguonc:"]
};

const builder = new addonBuilder(manifest);
const API_BASE = "https://phim.nguonc.com/api";

// --- HÀM HỖ TRỢ (HELPER) ---
// Chuyển đổi dữ liệu item từ NguonC sang format sơ lược của Stremio
function toMetaPreview(item) {
    return {
        id: `nguonc:${item.slug}`,
        type: "movie", // Mặc định hiển thị ở dạng movie trong catalog
        name: item.name,
        poster: item.thumb_url,
        description: `Năm: ${item.year} - ${item.original_name || ''}`
    };
}

// --- 1. XỬ LÝ CATALOG & TÌM KIẾM ---
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    let url = "";

    // A. Xử lý Tìm kiếm
    if (extra && extra.search) {
        // API search của NguonC
        url = `${API_BASE}/films/search?keyword=${encodeURIComponent(extra.search)}`;
    } 
    // B. Xử lý Danh sách mới (Mặc định)
    else if (id === "nguonc_phimmoi") {
        url = `${API_BASE}/films/phim-moi-cap-nhat?page=1`;
    } else {
        return { metas: [] };
    }

    try {
        const response = await axios.get(url);
        const items = response.data.items || []; // Lưu ý: API search trả về items trực tiếp hoặc trong data
        
        const metas = items.map(toMetaPreview);
        return { metas };
    } catch (error) {
        console.error("Lỗi Catalog/Search:", error.message);
        return { metas: [] };
    }
});

// --- 2. XỬ LÝ META (Chi tiết phim & Danh sách tập) ---
builder.defineMetaHandler(async ({ type, id }) => {
    if (!id.startsWith("nguonc:")) return { meta: {} };
    const slug = id.split(":")[1];

    try {
        const response = await axios.get(`${API_BASE}/film/${slug}`);
        const movie = response.data.movie;
        
        // Xác định loại phim (movie hay series) dựa trên số tập
        const isSeries = movie.total_episodes > 1 || movie.category?.[1]?.list.some(c => c.name === "Phim Bộ");
        const stremioType = isSeries ? "series" : "movie";

        // Tạo thông tin cơ bản
        const metaObj = {
            id: id,
            type: stremioType,
            name: movie.name,
            poster: movie.thumb_url,
            background: movie.poster_url,
            description: movie.content,
            releaseInfo: movie.year.toString(),
            language: movie.lang,
            genres: movie.category ? Object.values(movie.category).flatMap(c => c.list.map(i => i.name)) : [],
        };

        // Xử lý danh sách tập phim (Videos)
        // Stremio cần danh sách 'videos' để hiển thị các tập cho series
        if (movie.episodes && movie.episodes.length > 0) {
            const serverData = movie.episodes[0].server_data; // Lấy server đầu tiên
            
            metaObj.videos = serverData.map((ep, index) => ({
                // ID của tập phim sẽ chứa cả slug phim và slug tập (hoặc index)
                // Format: nguonc:slug_phim:slug_tap
                id: `${id}:${ep.slug}`, 
                title: ep.name, // Ví dụ: "Tập 1", "Tập 2"
                season: 1,      // NguonC thường không chia season rõ ràng, ta gom hết vào season 1
                episode: index + 1,
                released: new Date().toISOString() // Hoặc lấy ngày update nếu có
            }));
        }

        return { meta: metaObj };
    } catch (error) {
        console.error("Lỗi Meta:", error.message);
        return { meta: {} };
    }
});

// --- 3. XỬ LÝ STREAM (Lấy link phát) ---
builder.defineStreamHandler(async ({ type, id }) => {
    // ID nhận vào sẽ có dạng: nguonc:slug_phim (nếu là phim lẻ) hoặc nguonc:slug_phim:slug_tap (nếu chọn tập)
    if (!id.startsWith("nguonc:")) return { streams: [] };

    const parts = id.split(":");
    const filmSlug = parts[1];
    const episodeSlug = parts[2]; // Có thể undefined nếu là phim lẻ bấm play trực tiếp

    try {
        const response = await axios.get(`${API_BASE}/film/${filmSlug}`);
        const movie = response.data.movie;
        const episodes = movie.episodes[0].server_data;

        let targetEpisode;

        if (episodeSlug) {
            // Trường hợp 1: Chọn tập cụ thể (Series)
            targetEpisode = episodes.find(ep => ep.slug === episodeSlug);
        } else {
            // Trường hợp 2: Phim lẻ hoặc bấm play luôn -> Lấy tập đầu tiên
            targetEpisode = episodes[0];
        }

        if (!targetEpisode) return { streams: [] };

        const streamUrl = targetEpisode.link_m3u8 || targetEpisode.link_embed;

        return {
            streams: [
                {
                    title: `NguonC - ${targetEpisode.name} - ${movie.quality}`,
                    url: streamUrl,
                    behaviorHints: {
                        notWebReady: false,
                        bingeGroup: `nguonc-${filmSlug}` // Giúp tự động chuyển tập
                    }
                }
            ]
        };

    } catch (error) {
        console.error("Lỗi Stream:", error.message);
        return { streams: [] };
    }
});

// Cấu hình cổng cho Beamup / Local
// Beamup/Heroku/Render thường cung cấp biến môi trường PORT
const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });

console.log(`Addon đang chạy tại: http://127.0.0.1:${port}/manifest.json`);