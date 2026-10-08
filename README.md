# Ô ăn quan — Ba nước đi

Game web tiếng Việt, một thế cờ duy nhất. Người chơi đi ba lượt liên tiếp, chọn một ô dân ở hàng phía mình và một chiều rải để tối đa hóa điểm. Không có đối thủ AI. Giao diện có hoạt ảnh từng quân, âm thanh tùy chọn, hoàn tác, chơi lại và lời giải ở bảng kết quả.

## Chạy trên máy

Cần Node.js; không cần cài thư viện. Chạy `npm start` rồi mở http://127.0.0.1:4187. Chạy `npm test` để kiểm tra luật và lời giải. `docs/` chứa toàn bộ game có thể đưa lên hosting tĩnh. Giao diện dùng giấy ngà, mực đỏ nâu và bàn gỗ với quân dân ba sắc sỏi, quân quan bằng ngọc. Hoạt ảnh rải theo vòng cung; quân bị ăn bay về bảng điểm và hiện số điểm cộng.

Font tiêu đề là **SG85-Saigon 1985** nguyên bản của Thái Hiếu, tự lưu ở `docs/fonts/SAIGON1985.ttf`. [Nguồn tác giả và điều kiện sử dụng](https://fontzin.com/10-font-sai-gon-xua/) cho phép dùng cá nhân, thương mại và nhúng web; cấm bán lại hoặc chỉnh sửa font. Readme tác giả được giữ ở `docs/fonts/README-ThaiHieu.txt`. Đoạn hướng dẫn và luật dùng font serif hệ thống để dễ đọc.

## Màn chơi và cách tính điểm

Thế cờ được tái tạo từ bốn nước đi hợp lệ xen kẽ của một ván chuẩn. Xuất phát có 38 dân và hai quan còn trên bàn; mỗi bên đã ăn 6 dân. Điểm thử thách bắt đầu từ 0.

Giữ cách rải nối tiếp, ăn qua ô trống và ăn liên hoàn của ô ăn quan. 1 dân = 1 điểm, 1 quan = 10 điểm; không áp dụng luật quan non. Hết hai quan thì dừng. Không cộng dân còn trên bàn ở cuối thử thách. Nếu phía người chơi hết dân, trừ 5 điểm để đặt mỗi ô 1 dân; không đủ điểm thì kết thúc.

Luật tham khảo: https://arxiv.org/html/2507.03711v1, phần III. Phần giới hạn ba lượt là biến thể giải đố của game này.

Chuỗi tối ưu duy nhất: ô3 sang phải (+3), ô5 sang trái (+16), ô5 sang phải (+19), tổng38 điểm. Nước ăn nhiều nhất ngay lượt đầu (+13) chỉ có thể đạt tối đa28 điểm sau ba lượt.

## Mã nguồn

- `engine.mjs`: luật thuần JavaScript, giải bằng duyệt toàn bộ cây ba lượt; provenance của thế cờ nằm trong `PUZZLE_PROVENANCE`.
- `engine.test.mjs`: 10 kiểm thử về bảo toàn quân, rải nối tiếp, chững quan, ăn liên hoàn, quan trống dân, đặt lại quân, kết thúc sớm và lời giải độc lập.
- `docs/engine.mjs`: bản engine dùng trong game; đồng bộ từ `engine.mjs` khi sửa luật.
- `docs/app.mjs`: điều khiển game và đăng ký WebMCP nếu trình duyệt hỗ trợ.
- `docs/index.html`, `docs/style.css`: giao diện responsive; `docs/motion.css`: lớp hiệu ứng chuyển động.

Phím1–5 chọn ô, ←/→ chọn hướng, Enter khi đang chọn ô để đi. Hoạt ảnh tự tắt với tùy chọn giảm chuyển động của hệ điều hành.
