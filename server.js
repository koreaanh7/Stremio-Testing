const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

const TARGET_MANIFEST_URL = process.env.TARGET_MANIFEST_URL;

if (!TARGET_MANIFEST_URL) {
    console.error("LỖI: Chưa set TARGET_MANIFEST_URL");
    process.exit(1);
}

const getBaseUrl = (url) => url.replace('/manifest.json', '');
const TARGET_BASE_URL = getBaseUrl(TARGET_MANIFEST_URL);

// Headers quan trọng
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

const builder = new addonBuilder({
    id: "com.phim4k.vip.final.v9",
    version: "9.0.0",
    name: "Phim4K VIP (Series Fix)",
    description: "Fix lỗi Series sắp xếp lộn xộn & gom đủ source 4K",
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

// Hàm trích xuất S và E từ tên file (Regex mạnh mẽ)
function extractEpisodeInfo(filename) {
    const name = filename.toLowerCase();
    
    // Pattern 1: S01E01, S1E1, Season 1 Episode 1
    const matchSE = name.match(/(?:s|season)\s?(\d{1,2})[\s\xe.-]*(?:e|ep|episode|tap)\s?(\d{1,2})/);
    if (matchSE) return { s: parseInt(matchSE[1]), e: parseInt(matchSE[2]) };

    // Pattern 2: 1x01
    const matchX = name.match(/(\d{1,2})x(\d{1,2})/);
    if (matchX) return { s: parseInt(matchX[1]), e: parseInt(matchX[2]) };

    // Pattern 3: Chỉ có Episode (Tap 1, E01) -> Trả về Season = 0 (để xử lý sau)
    const matchE = name.match(/(?:e|ep|episode|tap)\s?(\d{1,2})/);
    if (matchE) return { s: 0, e: parseInt(matchE[1]) };

    return null;
}

builder.defineStreamHandler(async ({ type, id }) => {
    // Chỉ xử lý ID IMDB
    if (!id.startsWith("tt")) return { streams: [] };

    // Tách ID: tt123456 (Movie) hoặc tt123456:1:1 (Series)
    const [imdbId, seasonStr, episodeStr] = id.split(':');
    const season = seasonStr ? parseInt(seasonStr) : null;
    const episode = episodeStr ? parseInt(episodeStr) : null;

    console.log(`\n=== Xử lý: ${imdbId} | Type: ${type} | S:${season} E:${episode} ===`);

    const meta = await getCinemetaMetadata(type, imdbId);
    if (!meta) return { streams: [] };

    const englishName = cleanText(meta.name);
    const year = parseInt(meta.year);

    // 1. TÌM KIẾM PHIM/SERIES TRÊN SERVER
    const catalogId = type === 'movie' ? 'phim4k_movies' : 'phim4k_series';
    const searchUrl = `${TARGET_BASE_URL}/catalog/${type}/${catalogId}/search=${encodeURIComponent(meta.name)}.json`;

    try {
        const res = await axios.get(searchUrl, { headers: HEADERS, timeout: 8000 });
        if (!res.data || !res.data.metas || res.data.metas.length === 0) return { streams: [] };

        // Logic khớp phim (như cũ)
        const match = res.data.metas.find(m => {
            const serverName = cleanText(m.name);
            const nameMatch = serverName.includes(englishName);
            const yearMatches = m.name.match(/\d{4}/g);
            let yearMatch = false;
            if (yearMatches) yearMatch = yearMatches.some(y => Math.abs(parseInt(y) - year) <= 1);
            else if (m.releaseInfo) yearMatch = m.releaseInfo.includes(year.toString());
            return nameMatch && yearMatch;
        });

        if (!match) return { streams: [] };

        const fullId = match.id; // ID Server (VD: phim4k:series:999)
        console.log(`-> Đã khớp Show: ${match.name} (ID: ${fullId})`);

        // ================= XỬ LÝ MOVIE (Đơn giản) =================
        if (type === 'movie') {
            const streamUrl = `${TARGET_BASE_URL}/stream/${type}/${encodeURIComponent(fullId)}.json`;
            const streamRes = await axios.get(streamUrl, { headers: HEADERS });
            if (streamRes.data && streamRes.data.streams) {
                return {
                    streams: streamRes.data.streams.map(s => ({
                        name: "Phim4K VIP",
                        title: s.title || s.name,
                        url: s.url,
                        behaviorHints: { notWebReady: false, bingeGroup: "phim4k-vip" }
                    }))
                };
            }
        }

        // ================= XỬ LÝ SERIES (Phức tạp) =================
        if (type === 'series') {
            // Bước A: Lấy CHI TIẾT Show (Metadata) để có danh sách tất cả các tập
            // URL Meta thường là: /meta/series/phim4k:series:123.json
            const metaUrl = `${TARGET_BASE_URL}/meta/${type}/${encodeURIComponent(fullId)}.json`;
            console.log(`-> Fetching Meta Series: ${metaUrl}`);
            
            const metaRes = await axios.get(metaUrl, { headers: HEADERS });
            
            if (!metaRes.data || !metaRes.data.meta || !metaRes.data.meta.videos) {
                console.log("-> Không lấy được danh sách tập phim.");
                return { streams: [] };
            }

            const allVideos = metaRes.data.meta.videos;
            console.log(`-> Tổng số video tìm thấy trên server: ${allVideos.length}`);

            // Bước B: Lọc thủ công (Bỏ qua cách chia Season của Server)
            // Chúng ta tìm tất cả video có tên khớp với Season & Episode yêu cầu
            const matchedVideos = allVideos.filter(vid => {
                const vidTitle = vid.title || vid.name || "";
                const info = extractEpisodeInfo(vidTitle);

                if (!info) return false;

                // Trường hợp 1: Tên file có đủ S và E (VD: S01E01) -> Phải khớp cả hai
                if (info.s !== 0) {
                    return info.s === season && info.e === episode;
                }

                // Trường hợp 2: Tên file chỉ có E (VD: Tap 1) 
                // -> Chấp nhận nếu Episode khớp (Giả định server chia folder đúng hoặc đây là show 1 season)
                if (info.s === 0) {
                    return info.e === episode;
                }
                
                return false;
            });

            console.log(`-> Số video khớp S${season}E${episode}: ${matchedVideos.length}`);

            // Bước C: Lấy link stream cho từng video đã khớp
            const streams = [];
            for (const vid of matchedVideos) {
                // vid.id là ID của tập phim (VD: phim4k:series:999:1:1 hoặc mã hash)
                const vidStreamUrl = `${TARGET_BASE_URL}/stream/${type}/${encodeURIComponent(vid.id)}.json`;
                try {
                    const sRes = await axios.get(vidStreamUrl, { headers: HEADERS });
                    if (sRes.data && sRes.data.streams) {
                        sRes.data.streams.forEach(s => {
                            streams.push({
                                name: `Phim4K S${season}E${episode}`,
                                title: s.title || vid.title || `Episode ${episode}`, // Giữ tên gốc để biết bản 1080p hay 4K
                                url: s.url,
                                behaviorHints: { notWebReady: false, bingeGroup: "phim4k-vip" }
                            });
                        });
                    }
                } catch (err) {
                    console.error(`Lỗi lấy stream video ${vid.id}: ${err.message}`);
                }
            }

            return { streams: streams };
        }

    } catch (error) {
        console.error(`Lỗi tổng: ${error.message}`);
    }

    return { streams: [] };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });
