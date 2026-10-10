# Trạng Nguyên Kỳ Lộ

**Ngược dòng tuổi thơ.** Game ô ăn quan tiếng Việt với một thế cờ duy nhất. Người chơi ghi danh trước khi bắt đầu; mỗi ván có ba lượt liên tiếp để ăn được nhiều quân nhất, không có lượt của đối thủ. Giao diện có hoạt ảnh từng quân và âm thanh tùy chọn; không có hoàn tác, gợi ý hay lời giải.

Bản công khai: [longluongexotic-droid.github.io/o-an-quan](https://longluongexotic-droid.github.io/o-an-quan/). **Bảng Vàng** hiển thị 10 người có điểm cao nhất từ database chung trên Supabase. Hạng 1 nhận danh hiệu **Trạng nguyên**, hạng 2 nhận danh hiệu **Thám hoa**.

## Chạy trên máy

Cần Node.js. Chạy `npm start` rồi mở http://127.0.0.1:4187. Game không cần bước build hay thư viện cài cục bộ; `docs/` được xuất bản trực tiếp trên GitHub Pages.

Chạy `npm ci` rồi `npm test` để kiểm tra luật, client bảng xếp hạng và quyền/điểm của database. PGlite dùng cho kiểm thử SQL được khóa phiên bản trong `package-lock.json`; các kiểm thử này chạy cục bộ, không ghi vào Supabase thật.

Giao diện dùng giấy ngà, mực đỏ nâu và bàn gỗ với dân ba sắc sỏi, quan bằng ngọc. Quân rải theo vòng cung, quân bị ăn bay về bảng điểm và hiện số điểm cộng.

Font tiêu đề là **SG85-Saigon 1985** nguyên bản của Thái Hiếu, tự lưu ở `docs/fonts/SAIGON1985.ttf`. [Nguồn tác giả và điều kiện sử dụng](https://fontzin.com/10-font-sai-gon-xua/) cho phép dùng cá nhân, thương mại và nhúng web; cấm bán lại hoặc chỉnh sửa font. Readme tác giả được giữ ở `docs/fonts/README-ThaiHieu.txt`. Nội dung, tên người chơi và luật dùng **Noto Serif** tự lưu trong `docs/fonts/`, kèm giấy phép SIL Open Font License ở `OFL-NotoSerif.txt`; Sài Gòn 1985 chỉ dùng cho tiêu đề.

## Bảng xếp hạng và Supabase

Tên dài 1–24 ký tự, hỗ trợ tiếng Việt, được chuẩn hóa Unicode và khoảng trắng, từ chối ký tự điều khiển/ẩn. Mỗi tên là **duy nhất toàn hệ thống**, không phân biệt chữ hoa/thường, và **không thể đổi sau khi ghi danh**. Supabase Anonymous Auth tạo danh tính khách riêng cho trình duyệt; không cần email hay mật khẩu.

Mỗi tên được **bắt đầu tối đa 3 ván**. Ván mới được tính ngay khi server tạo ván; mở lại trang hoặc gửi lại cùng yêu cầu không trừ thêm ván. Ván đang chơi phải tiếp tục từ nước đã lưu, không thể bỏ ván để đặt lại bàn cờ. Chỉ có thể mở ván tiếp theo sau khi ván hiện tại kết thúc và còn lượt chơi.

Cần kết nối mạng để ghi danh, mở ván và đi từng nước. Server lưu chuỗi nước đi sau mỗi nước được chấp nhận; tải lại trang khôi phục đúng ván và tiến trình đó. Khi kết nối gián đoạn, game yêu cầu kết nối lại và đồng bộ trạng thái trước khi chơi tiếp. Yêu cầu mở ván và nước đi có kiểm tra retry để không ghi hai lần.

Server kiểm tra từng tiền tố nước đi dựa trên **275 chuỗi kết thúc hợp lệ**, gồm các trường hợp kết thúc sớm, rồi tự chốt điểm khi ván hoàn tất. Trình duyệt không được tự ghi điểm hay thay thế chuỗi đã lưu. Bảng Vàng giữ **điểm cao nhất** trong các ván của tên đó; nếu hòa điểm, người đạt điểm ấy trước xếp trên, sau đó dùng ID ổn định để phân thứ tự.

Phiên khách được lưu trong trình duyệt. Xóa dữ liệu trình duyệt hoặc dùng thiết bị khác tạo danh tính mới và **không thể nhận lại tên đã được giữ**; cần dùng đúng trình duyệt còn phiên cũ để tiếp tục. Tên, điểm và số ván đã dùng vẫn được giữ trên server.

Đợt nâng cấp bảo toàn 9 hồ sơ điểm cũ. Vì bản trước không lưu số ván đã chơi, mỗi tên cũ được tính **một ván lịch sử đã dùng**, còn hai ván mới. Các tên cũ trùng sau chuẩn hóa được gộp: giữ điểm cao nhất và thời điểm sớm nhất đạt điểm đó, liên kết các danh tính cũ vào cùng tên và cùng hạn mức. Bảng dữ liệu điểm cũ được giữ nguyên.

Để cấu hình vào một project Supabase khác:

1. Chạy [`202610090001_leaderboard.sql`](supabase/migrations/202610090001_leaderboard.sql), sau đó [`202610100001_ky_lo.sql`](supabase/migrations/202610100001_ky_lo.sql) bằng SQL Editor với quyền chủ database. Project đã có migration đầu chỉ cần áp dụng migration thứ hai. Các bảng tên, hạn mức, ván và đường đi đều private; client chỉ gọi RPC được cấp quyền.
2. Bật **Anonymous Sign-Ins** trong Authentication của project. Kiểm tra các Auth hooks hiện có cho phép loại người dùng này nếu project được dùng chung với ứng dụng khác.
3. Đặt Project URL và **publishable key** (hoặc legacy `anon` key) trong [`docs/leaderboard-config.mjs`](docs/leaderboard-config.mjs), rồi xuất bản `docs/` lên GitHub Pages. Đây là cấu hình công khai cho trình duyệt; **không đưa secret key, service-role key hoặc token quản trị vào frontend/Git**.

RPC hiện hành: `oaq_top10()` cho khách đọc; `oaq_player_status()`, `oaq_register_player(p_name)`, `oaq_start_game(p_request_id)` và `oaq_play_move(p_game_id, p_expected_moves, p_move)` yêu cầu phiên xác thực. Các RPC ghi trả hồ sơ, số ván và chuỗi nước đi chuẩn trên server. `oaq_submit_score` cũ đã bị thu hồi quyền; `oaq_top20()` chỉ còn là wrapper của top10 để tương thích đọc.

`node scripts/generate-leaderboard-paths.mjs` kiểm tra seed khớp engine; `--write` tạo lại phần seed trước khi áp dụng migration mới. Nếu thay luật hoặc thế cờ, cần phiên bản màn chơi và migration mới để giữ đúng ý nghĩa của điểm cũ.

## Trang quản lý Bảng Vàng

Mở [trang quản lý](https://longluongexotic-droid.github.io/o-an-quan/admin.html), nhập email được cấp quyền, rồi mở liên kết Supabase gửi qua email. Trang quản lý dùng phiên đăng nhập riêng, không thay danh tính khách hoặc tiến độ của người chơi trên cùng trình duyệt.

Quản trị viên có thể tìm tất cả người đã ghi danh, sửa tên, đặt điểm hiển thị từ 0–38 (hoặc gỡ điểm), và ẩn/khôi phục người khỏi Bảng Vàng. Tên vẫn phải duy nhất. Mỗi lần lưu cần lý do và được ghi lịch sử trước/sau; xung đột dữ liệu được phát hiện, gửi lại cùng yêu cầu không tạo lần sửa trùng.

Điểm quản trị chỉ điều chỉnh bảng xếp hạng; điểm chơi thực, lịch sử ván và giới hạn 3 ván vẫn được giữ. Bỏ chọn “Dùng điểm chơi thực” để đặt điểm riêng; bật lại để dùng kết quả game. Điểm đặt riêng tiếp tục được áp dụng cho đến khi quản trị viên chọn lại điểm chơi thực. Người bị ẩn vẫn giữ tên và lịch sử.

Thiết lập trên project khác:

1. Chạy [`202610100002_admin.sql`](supabase/migrations/202610100002_admin.sql) sau hai migration game.
2. Chủ project thêm email quản trị vào `oaq_private.admin_allowlist` bằng SQL Editor. Không cần public email hay đưa secret key vào mã web.
3. Giữ bật xác minh email; thêm URL chính xác của `admin.html` vào Authentication → URL Configuration và đặt Site URL tương ứng. Backend kiểm tra email đã xác minh trong `auth.users`, từ chối người dùng anonymous và mọi email ngoài allowlist trên từng RPC quản trị.
4. Đăng nhập bằng liên kết email. [SMTP mặc định của Supabase](https://supabase.com/docs/guides/auth/auth-smtp) chỉ gửi tới email thành viên tổ chức và có giới hạn thấp; nếu dùng email khác, cấu hình SMTP riêng. Không tắt xác minh email để thay thế.

`docs/admin.html`, `docs/admin.css`, `docs/admin.mjs` là giao diện; `docs/admin-client.mjs` xử lý đăng nhập và RPC. Các bảng quyền, yêu cầu lưu và lịch sử chỉnh sửa đều private; người chơi chỉ được đọc Bảng Vàng công khai như trước.

## Màn chơi và cách tính điểm

Thế cờ được tái tạo từ bốn nước đi hợp lệ xen kẽ của một ván chuẩn. Xuất phát có 38 dân và hai quan còn trên bàn; mỗi bên đã ăn 6 dân. Điểm thử thách bắt đầu từ 0.

Giữ cách rải nối tiếp, ăn qua ô trống và ăn liên hoàn của ô ăn quan. 1 dân = 1 điểm, 1 quan = 10 điểm; không áp dụng luật quan non. Hết hai quan thì dừng. Không cộng dân còn trên bàn ở cuối thử thách. Nếu phía người chơi hết dân, trừ 5 điểm để đặt mỗi ô 1 dân; không đủ điểm thì kết thúc.

Luật tham khảo: https://arxiv.org/html/2507.03711v1, phần III. Phần giới hạn ba lượt là biến thể giải đố của game này.

Engine duyệt toàn bộ cây ba lượt để xác nhận mức tối đa **38 điểm** và một chuỗi tối ưu duy nhất. Nước ăn nhiều nhất ngay lượt đầu (+13) chỉ có thể đạt tối đa 28 điểm sau ba lượt; kiểm thử độc lập xác nhận kết quả này.

## Mã nguồn

- `engine.mjs`: luật thuần JavaScript, giải bằng duyệt toàn bộ cây ba lượt; provenance của thế cờ nằm trong `PUZZLE_PROVENANCE`.
- `engine.test.mjs`: kiểm thử bảo toàn quân, rải nối tiếp, chững quan, ăn liên hoàn, quan trống dân, đặt lại quân, kết thúc sớm và lời giải độc lập.
- `docs/engine.mjs`: bản engine dùng trong game; đồng bộ từ `engine.mjs` khi sửa luật.
- `docs/app.mjs`: điều khiển game và đăng ký WebMCP nếu trình duyệt hỗ trợ.
- `docs/leaderboard.mjs`, `docs/leaderboard-config.mjs`: phiên khách, ghi danh, số ván, lưu từng nước và đọc Bảng Vàng trên Supabase.
- `supabase/migrations/`, `scripts/generate-leaderboard-paths.mjs`, `tests/`: database, seed chuỗi hợp lệ và kiểm thử bảng xếp hạng.
- `docs/index.html`, `docs/style.css`: giao diện responsive; `docs/motion.css`: lớp hiệu ứng chuyển động.

Phím1–5 chọn ô, ←/→ chọn hướng, Enter khi đang chọn ô để đi. Hoạt ảnh tự tắt với tùy chọn giảm chuyển động của hệ điều hành.
