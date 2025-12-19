const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

const manifest = {
    id: "community.nguonc.phim",
    version: "1.2.0", // Nâng version
    name: "NguonC (Auto-Extract)",
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

// --- HÀM HỖ TRỢ AN TOÀN ---
function safeList(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (typeof data === 'object') return Object.values(data);
    return [];
}

// --- HÀM "ĐÀO" LINK M3U8 TỪ EMBED ---
async function extractM3u8(embedUrl) {
    try {
        console.log(`--> Đang quét Embed: ${embedUrl}`);
        const response = await axios.get(embedUrl, {
            headers: {
                // Giả danh trình duyệt thật để không bị chặn
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Referer': 'https://phim.nguonc.com/' 
            },
            timeout: 6000 // Hủy nếu quá 6 giây
        });
        
        const html = response.data;
        
        // Regex tìm chuỗi bắt đầu bằng http và kết thúc bằng .m3u8
        const regex = /(https?:\/\/[^"']+\.m3u8)/g;
        const matches = html.match(regex);
        
        if (matches && matches.length > 0) {
            console.log("--> Đã tìm thấy link ẩn:", matches[0]);
            return matches[0];
        } else {
            console.log("--> Không tìm thấy m3u8 trong source.");
        }
    } catch (e) {
        console.error("--> Lỗi khi extract:", e.message);
    }
    return null;
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
                description: `${item.year}`
            }))
        };
    } catch (e) {
        return { metas: [] };
    }
});

// --- 2. META HANDLER ---
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

        // Logic Series: Có nhiều tập HOẶC Category chứa "Phim Bộ"
        const isSeries = episodes.length > 1 || 
                         JSON.stringify(categories).toLowerCase().includes("phim bộ");
        const stremioType = isSeries ? "series" : "movie";

        const metaObj = {
            id: id,
            type: stremioType,
            name: movie.name,
            poster: movie.thumb_url,
            background: movie.poster_url || movie.thumb_url,
            description: movie.content || "Không có nội dung.",
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
             // Fallback cho phim lẻ
             metaObj.videos = [{ id: `nguonc:${slug}:full`, title: "Full Movie", season: 1, episode: 1 }];
        }

        return { meta: metaObj };

    } catch (e) {
        // Trả về meta giả để không lỗi giao diện
        return { meta: { id, type: "movie", name: "Lỗi tải thông tin" } };
    }
});

// --- 3. STREAM HANDLER (QUAN TRỌNG NHẤT) ---
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

        // Tìm tập phim
        let targetEpisode = episodes.find(ep => ep.slug == episodeSlug);
        if (!targetEpisode && !episodeSlug) targetEpisode = episodes[0]; // Mặc định tập 1
        if (!targetEpisode && episodeSlug === "full") targetEpisode = episodes[0]; // Phim lẻ
        
        if (!targetEpisode) return { streams: [] };

        const streams = [];
        let m3u8Link = targetEpisode.link_m3u8;

        // BƯỚC 1: Nếu không có m3u8 sẵn, thử Extract từ Embed
        if (!m3u8Link && targetEpisode.link_embed) {
            m3u8Link = await extractM3u8(targetEpisode.link_embed);
        }

        // BƯỚC 2: Nếu tìm thấy m3u8 (có sẵn hoặc extract được)
        if (m3u8Link) {
            streams.push({
                title: `⚡ NguonC Auto-Stream - ${targetEpisode.name}`,
                url: m3u8Link,
                behaviorHints: {
                    notWebReady: false,
                    bingeGroup: `nguonc-${filmSlug}`
                }
            });
        }

        // BƯỚC 3: Luôn thêm link mở Web (Fallback an toàn)
        if (targetEpisode.link_embed) {
            streams.push({
                title: `🌐 Mở Trình Duyệt (Dự phòng) - ${targetEpisode.name}`,
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
console.log(`Addon is running on port ${port}`);
