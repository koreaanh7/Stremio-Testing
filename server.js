const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

// Lấy link manifest gốc từ biến môi trường
const TARGET_MANIFEST_URL = process.env.TARGET_MANIFEST_URL;

if (!TARGET_MANIFEST_URL) {
    console.error("LỖI: Chưa cài đặt biến môi trường TARGET_MANIFEST_URL");
    process.exit(1);
}

// Hàm lấy Base URL (giữ nguyên token bảo mật trong URL)
// Input: https://stremio.phim4k.xyz/TOKEN/manifest.json
// Output: https://stremio.phim4k.xyz/TOKEN
const getBaseUrl = (url) => {
    return url.replace('/manifest.json', '');
};

const TARGET_BASE_URL = getBaseUrl(TARGET_MANIFEST_URL);

const builder = new addonBuilder({
    id: "com.phim4k.bridge",
    version: "1.0.1",
    name: "Phim4K Bridge (Cinemeta)",
    description: "Hiện link Phim4K ngay trên poster của Cinemeta",
    logo: "https://i.imgur.com/wM7gP5s.png", // Logo tùy chọn
    resources: ["stream"],
    // QUAN TRỌNG: Khai báo hỗ trợ phim lẻ và phim bộ, dùng ID của IMDB (tt...)
    types: ["movie", "series"],
    idPrefixes: ["tt"], 
    catalogs: [] // Không hiện catalog riêng để tránh rác giao diện
});

builder.defineStreamHandler(async ({ type, id }) => {
    // Chỉ xử lý nếu ID bắt đầu bằng 'tt' (IMDB ID)
    if (!id.startsWith("tt")) {
        return { streams: [] };
    }

    console.log(`Đang tìm stream cho: ${type} - ${id}`);
    
    try {
        // Cấu trúc link stream của Stremio addon chuẩn: {base_url}/stream/{type}/{id}.json
        const streamUrl = `${TARGET_BASE_URL}/stream/${type}/${id}.json`;
        
        // Gọi sang Phim4K
        // Cần set timeout ngắn để tránh treo nếu Phim4k phản hồi chậm
        const response = await axios.get(streamUrl, { timeout: 10000 });
        
        if (response.data && response.data.streams && response.data.streams.length > 0) {
            // Sửa tên hiển thị để bạn biết đó là link từ Phim4K
            const modifiedStreams = response.data.streams.map(stream => ({
                ...stream,
                name: `[Phim4K] ${stream.name || ''}`,
                description: stream.title || stream.description // Đôi khi Phim4k để thông tin ở title
            }));
            
            return { streams: modifiedStreams };
        } else {
            return { streams: [] };
        }
    } catch (error) {
        // Lỗi 404 nghĩa là phim này Phim4K chưa có, bỏ qua êm đẹp
        if (error.response && error.response.status === 404) {
             return { streams: [] };
        }
        console.error(`Lỗi kết nối Phim4K: ${error.message}`);
        return { streams: [] };
    }
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: port });
