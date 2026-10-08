# Ô ăn quan — Ba nước đi

Game web tiếng Việt, một thế cờ duy nhất. Người chơi nhập tên trước khi bắt đầu, rồi đi ba lượt liên tiếp để ăn được nhiều quân nhất. Không có đối thủ AI. Giao diện có hoạt ảnh từng quân, âm thanh tùy chọn, hoàn tác, chơi lại và lời giải ở bảng kết quả.

Bản công khai: [longluongexotic-droid.github.io/o-an-quan](https://longluongexotic-droid.github.io/o-an-quan/). **Sổ vàng** hiển thị 20 người có điểm cao nhất từ database chung trên Supabase; người ở các thiết bị khác đều đọc cùng bảng xếp hạng.

## Chạy trên máy

Cần Node.js. Chạy `npm start` rồi mở http://127.0.0.1:4187. Game không cần bước build hay thư viện cài cục bộ; `docs/` được xuất bản trực tiếp trên GitHub Pages.

Chạy `npm ci` rồi `npm test` để kiểm tra luật, client bảng xếp hạng và quyền/điểm của database. PGlite dùng cho kiểm thử SQL được khóa phiên bản trong `package-lock.json`; các kiểm thử này chạy cục bộ, không ghi vào Supabase thật.

Giao diện dùng giấy ngà, mực đỏ nâu và bàn gỗ với dân ba sắc sỏi, quan bằng ngọc. Quân rải theo vòng cung, quân bị ăn bay về bảng điểm và hiện số điểm cộng.

Font tiêu đề là **SG85-Saigon 1985** nguyên bản của Thái Hiếu, tự lưu ở `docs/fonts/SAIGON1985.ttf`. [Nguồn tác giả và điều kiện sử dụng](https://fontzin.com/10-font-sai-gon-xua/) cho phép dùng cá nhân, thương mại và nhúng web; cấm bán lại hoặc chỉnh sửa font. Readme tác giả được giữ ở `docs/fonts/README-ThaiHieu.txt`. Đoạn hướng dẫn và luật dùng font serif hệ thống để dễ đọc.

## Bảng xếp hạng và Supabase

Tên dài 1–24 ký tự, hỗ trợ tiếng Việt, được chuẩn hóa khoảng trắng và từ chối ký tự điều khiển/ẩn. Supabase Anonymous Auth tạo danh tính khách riêng cho mỗi trình duyệt; không cần email hay mật khẩu. Những người trùng tên vẫn có điểm riêng.

Sau mỗi ván hoàn tất, game tự gửi chuỗi nước đi. Server đối chiếu với 275 chuỗi kết thúc hợp lệ của màn chơi và tự lấy điểm; không tin điểm do trình duyệt gửi. Mỗi danh tính giữ **điểm cao nhất**. Ván thấp hơn không làm giảm kỷ lục; tên mới vẫn được cập nhật. Nếu hòa điểm, người đạt điểm ấy trước xếp trên, sau đó dùng ID ổn định để phân thứ tự.

Tên, phiên khách và kết quả đang chờ gửi được lưu trong trình duyệt. Khi mất mạng, game giữ ván chờ có điểm cao nhất và thử gửi lại khi có mạng; người chơi cũng có nút thử lại. Xóa dữ liệu trình duyệt hoặc đổi thiết bị tạo danh tính mới, không khôi phục danh tính/điểm cũ để tiếp tục cập nhật. Điểm đã gửi vẫn nằm trên bảng xếp hạng.

Để cấu hình vào một project Supabase khác:

1. Chạy [`supabase/migrations/202610090001_leaderboard.sql`](supabase/migrations/202610090001_leaderboard.sql) bằng SQL Editor với quyền chủ database. Migration tạo bảng private và hai RPC: `oaq_top20()` cho khách đọc, `oaq_submit_score(p_name, p_moves)` chỉ cho người đã có phiên xác thực nộp điểm.
2. Bật **Anonymous Sign-Ins** trong Authentication của project. Kiểm tra các Auth hooks hiện có cho phép loại người dùng này nếu project được dùng chung với ứng dụng khác.
3. Đặt Project URL và **publishable key** (hoặc legacy `anon` key) trong [`docs/leaderboard-config.mjs`](docs/leaderboard-config.mjs), rồi xuất bản `docs/` lên GitHub Pages. Đây là cấu hình công khai cho trình duyệt; **không đưa secret key, service-role key hoặc token quản trị vào frontend/Git**.

`node scripts/generate-leaderboard-paths.mjs` kiểm tra seed khớp engine; `--write` tạo lại phần seed trước khi áp dụng migration mới. Nếu thay luật hoặc thế cờ, cần phiên bản màn chơi và migration mới để giữ đúng ý nghĩa của điểm cũ.

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
- `docs/leaderboard.mjs`, `docs/leaderboard-config.mjs`: phiên khách, đọc hạng và nộp chuỗi nước đi lên Supabase.
- `supabase/migrations/`, `scripts/generate-leaderboard-paths.mjs`, `tests/`: database, seed chuỗi hợp lệ và kiểm thử bảng xếp hạng.
- `docs/index.html`, `docs/style.css`: giao diện responsive; `docs/motion.css`: lớp hiệu ứng chuyển động.

Phím1–5 chọn ô, ←/→ chọn hướng, Enter khi đang chọn ô để đi. Hoạt ảnh tự tắt với tùy chọn giảm chuyển động của hệ điều hành.
