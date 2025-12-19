const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

const manifest = {
    id: "community.nguonc.phim",
    version: "1.2.0",
    name: "NguonC Phim (Embed Fix)",
    description: "Tự động bóc tách link M3U8 từ trang Embed. Hỗ trợ Phim Bộ.",
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

// --- HÀM HỖ TRỢ ---
function safeList(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (typeof data === 'object') return Object.values(data);
    return [];
}

// Hàm "đào" link m3u8 từ trang Embed
async function extractM3u8(embedUrl) {
    try {
        console.log("Đang quét embed:", embedUrl);
        // Giả lập trình duyệt để tránh bị chặn cơ bản
        const response = await axios.get(embedUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Referer': 'https://phim.nguonc.com/'
            },
            timeout: 5000 // Chỉ đợi tối đa 5s
        });
        
        const html = response.data;
        
        // Regex tìm tất cả các link .m3u8 trong source HTML
        // Tìm chuỗi bắt đầu bằng http, kết thúc bằng .m3u8
        const regex = /(https?:\/\/[^"']+\.m3u8)/g;
        const matches = html.match(regex);
        
        if (matches && matches.length > 0) {
            console.log("--> Đã tìm thấy link ẩn:", matches[0]);
            return matches[0];
        }
    } catch (e) {
        console.error("Không bóc tách được link:", e.message);
    }
    return null;
}

// --- 1. CATALOG ---
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
                description: `${item.year}`
            }))
        };
    } catch (e) { return { metas: [] }; }
});

// --- 2. META ---
builder.defineMetaHandler(async ({ type, id }) => {
    if (!id.startsWith("nguonc:")) return { meta: {} };
    const slug = id.split(":")[1];

    try {
        const response = await axios.get(`${API_BASE}/film/${slug}`);
        const movie = response.data.movie;
        if (!movie) throw new Error("No Data");

        const categories = safeList(movie.category);
        const episodeServer = (movie.episodes && movie.episodes[0]) ? movie.episodes[0].server_data : [];
        const episodes = safeList(episodeServer);

        const isSeries = episodes.length > 1 || JSON.stringify(categories).toLowerCase().includes("phim bộ");
        const stremioType = isSeries ? "series" : "movie";

        const metaObj = {
            id: id,
            type: stremioType,
            name: movie.name,
            poster: movie.thumb_url,
            background: movie.poster_url || movie.thumb_url,
            description: movie.content,
            releaseInfo: `${movie.year}`,
            genres: categories.map(c => c.name),
        };

        if (episodes.length > 0) {
            metaObj.videos = episodes.map((ep, index) => ({
                id: `nguonc:${slug}:${ep.slug}`,
                title: ep.name,
                season: 1,
                episode: index + 1,
                released: new Date().toISOString()
            }));
        } else {
             metaObj.videos = [{ id: `nguonc:${slug}:full`, title: "Full Movie", season: 1, episode: 1 }];
        }
        return { meta: metaObj };
    } catch (e) { return { meta: { id, type: "movie", name: "Error" } }; }
});

// --- 3. STREAM (LOGIC MỚI) ---
builder.defineStreamHandler(async ({ type, id }) => {
    if (!id.startsWith("nguonc:")) return { streams: [] };
    
    const parts = id.split(":");
    const filmSlug = parts[1];
    const episodeSlug = parts[2];

    try {
        const response = await axios.get(`${API_BASE}/film/${filmSlug}`);
        const movie = response.data.movie;
        const episodes = safeList((movie.episodes && movie.episodes[0]) ? movie.episodes[0].server_data : []);

        if (episodes.length === 0) return { streams: [] };

        let targetEpisode = episodes.find(ep => ep.slug == episodeSlug) || episodes[0];
        if (!targetEpisode) return { streams: [] };

        // Ưu tiên 1: Link M3U8 có sẵn trong API
        let finalUrl = targetEpisode.link_m3u8;
        let titlePrefix = "Direct";

        // Ưu tiên 2: Nếu không có, thử "bóc tách" từ link Embed
        if (!finalUrl && targetEpisode.link_embed) {
            console.log("Không có m3u8 gốc, thử bóc tách từ Embed...");
            const extracted = await extractM3u8(targetEpisode.link_embed);
            if (extracted) {
                finalUrl = extracted;
                titlePrefix = "Extracted";
            }
        }

        const streams = [];

        // Nếu tìm được link video trực tiếp (M3U8)
        if (finalUrl) {
            streams.push({
                title: `⚡ NguonC [${titlePrefix}] - ${targetEpisode.name}`,
                url: finalUrl,
                behaviorHints: {
                    notWebReady: false,
                    bingeGroup: `nguonc-${filmSlug}`
                }
            });
        }

        // Luôn thêm lựa chọn mở bằng Trình Duyệt (để dự phòng)
        if (targetEpisode.link_embed) {
            streams.push({
                title: `🌐 Mở Web (Nếu lỗi) - ${targetEpisode.name}`,
                externalUrl: targetEpisode.link_embed
            });
        }

        return { streams };

    } catch (e) {
        console.error("Stream Error:", e.message);
        return { streams: [] };
    }
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });
console.log(`Addon running on port ${port}`);
