# Danh sách chức năng hệ thống Telegram Shop Bot

Cập nhật: 21/07/2026

Tài liệu này liệt kê các chức năng hiện có của hệ thống bot bán hàng Telegram, web admin, thanh toán, giao hàng tự động và các phần vận hành liên quan. Nội dung chỉ mô tả chức năng và biến cấu hình, không ghi token, mật khẩu hoặc thông tin bí mật thật.

## 1. Tổng quan hệ thống

Hệ thống là một shop bán sản phẩm số qua Telegram, có bot cho khách mua hàng và web admin cho chủ shop quản lý.

Các phần chính:

- Bot Telegram cho khách hàng.
- Web admin quản lý shop.
- Web storefront trong `public/shop`.
- API server Express.
- Database qua adapter Prisma/Mongo tương thích.
- Tự động kiểm tra giao dịch ngân hàng.
- Tự động kiểm tra nạp USDT BEP20/TRC20.
- Tự động giao hàng sau khi thanh toán.
- Hệ thống ví nội bộ.
- Hệ thống thông báo đơn hàng.
- Hệ thống icon Telegram custom emoji.
- Hệ thống reseller/API bán hàng.
- Backup, export, audit log và công cụ vận hành.

## 2. Luồng khách hàng trên bot

Luồng mở bot:

1. Khách bấm `/start`.
2. Bot ưu tiên cho khách chọn ngôn ngữ trước.
3. Sau khi chọn ngôn ngữ, bot kiểm tra điều kiện tham gia nhóm/kênh bắt buộc.
4. Nếu chưa tham gia nhóm, bot hiển thị thông báo bằng đúng ngôn ngữ khách đã chọn.
5. Khi khách đã tham gia nhóm, bot mở menu chính.
6. Khách có thể mua hàng, xem sản phẩm, nạp ví, xem đơn hàng, tài khoản, hỗ trợ, API, giới thiệu.

Các chức năng bot cho khách:

- Chọn ngôn ngữ.
- Lưu ngôn ngữ theo từng user.
- Hiển thị toàn bộ menu theo ngôn ngữ đã chọn.
- Kiểm tra tham gia nhóm bắt buộc.
- Cho admin bỏ qua kiểm tra nhóm nếu cấu hình bật.
- Có chế độ fail-open để tạm cho qua nếu bot chưa đủ quyền kiểm tra nhóm.
- Menu dạng reply keyboard.
- Menu dạng inline keyboard theo từng màn hình.
- Xóa hoặc thay thế menu cũ để tránh loạn tin nhắn.
- Chống spam thao tác nhanh.
- Tự fallback về menu khi state bị mất sau restart.

## 3. Đa ngôn ngữ

Hệ thống hỗ trợ 3 ngôn ngữ:

- Tiếng Việt.
- English.
- 中文.

Phạm vi đa ngôn ngữ:

- Màn hình chọn ngôn ngữ.
- Thông báo bắt buộc tham gia nhóm.
- Menu chính.
- Menu ví.
- Menu mua hàng.
- Danh mục.
- Sản phẩm.
- Đơn hàng.
- Thanh toán.
- Nạp ví.
- USDT BEP20/TRC20.
- QR thanh toán.
- Thông báo lỗi.
- Nút quay lại, hủy, kiểm tra thanh toán.
- Thông báo thành công/thất bại.
- Nội dung hướng dẫn khách chuyển khoản.

Ghi chú:

- Ngôn ngữ được lưu ở user.
- Khi user đổi ngôn ngữ, các màn hình sau sẽ dùng ngôn ngữ mới.
- Nếu thiếu key dịch, hệ thống fallback về tiếng Việt.

## 4. Menu bot

Menu chính có các nhóm chức năng:

- Mua hàng.
- Đơn hàng.
- Ví.
- Tài khoản.
- Sản phẩm.
- Hỗ trợ.
- Giới thiệu.
- API.
- Ẩn menu.
- Admin Panel cho admin.

Menu có thể dùng:

- Emoji thường.
- Telegram custom emoji bằng ID.
- Icon động của Telegram.
- Cấu hình icon từ web admin.
- Kiểm tra icon custom emoji có load được hay không.

## 5. Danh mục sản phẩm

Chức năng danh mục:

- Tạo danh mục.
- Sửa danh mục.
- Ẩn/hiện danh mục.
- Sắp xếp danh mục theo thứ tự.
- Gắn icon emoji thường.
- Gắn Telegram custom emoji ID.
- Gắn mô tả.
- Gắn ảnh/file ID nếu cần.
- Đếm sản phẩm trong danh mục.
- Cache danh mục để bot phản hồi nhanh hơn.
- Tự làm mới cache khi admin sửa danh mục.

## 6. Sản phẩm

Chức năng sản phẩm:

- Tạo sản phẩm.
- Sửa sản phẩm.
- Ẩn/hiện sản phẩm.
- Tự tạo mã sản phẩm nếu admin không nhập.
- Gắn sản phẩm vào danh mục.
- Tên sản phẩm.
- Mô tả sản phẩm.
- Ghi chú sản phẩm.
- Giá bán.
- Giá vốn nếu cần theo dõi.
- Tiền tệ sản phẩm.
- Số lượng mua tối thiểu.
- Số lượng mua tối đa.
- Số lượng đã bán ảo.
- Ảnh sản phẩm bằng Telegram file ID hoặc URL.
- Icon sản phẩm bằng emoji thường.
- Icon sản phẩm bằng Telegram custom emoji ID.
- Tồn kho cảnh báo thấp.
- Tự tắt sản phẩm khi hết hàng nếu bật.
- Tự ẩn sản phẩm khi hết hàng nếu bật.
- Lọc sản phẩm theo trạng thái.
- Lọc sản phẩm theo danh mục.
- Lọc sản phẩm theo kiểu giao hàng.
- Tìm kiếm sản phẩm.
- Sắp xếp theo tên, giá, thời gian tạo.

## 7. Kiểu giao hàng sản phẩm

Hệ thống hỗ trợ nhiều kiểu giao hàng:

- `STOCK_LINES`: bán từng dòng tồn kho.
- `TEXT`: gửi nội dung cố định trong sản phẩm.
- `FILE`: gửi file theo đường dẫn/file payload.

Với `STOCK_LINES`:

- Mỗi dòng hàng là một `StockItem`.
- Khi đơn giao thành công, dòng tồn kho được đánh dấu đã bán.
- Có kiểm tra số lượng tồn trước khi bán.
- Có cảnh báo tồn kho thấp.
- Có thể tự tắt sản phẩm khi số lượng tồn bằng ngưỡng cấu hình.
- Có cơ chế tránh cấp trùng hàng khi nhiều khách mua cùng lúc.

Với `TEXT`:

- Bot gửi thẳng nội dung đã cấu hình.
- Phù hợp với key chung, hướng dẫn, link, mã cố định.

Với `FILE`:

- Bot gửi file cho khách.
- Nếu Telegram gửi file lỗi mạng, hệ thống retry.
- Nếu file là phần phụ không bắt buộc, có thể bỏ qua sau khi retry để đơn không kẹt vô hạn.

## 8. Nhập kho

Chức năng nhập kho:

- Nhập nhiều dòng hàng.
- Nhập từ text.
- Nhập từ file nếu admin dùng giao diện hỗ trợ upload.
- Gắn stock vào đúng sản phẩm.
- Xem tồn kho chưa bán.
- Xem stock đã bán.
- Tự enable sản phẩm khi nhập thêm hàng nếu cấu hình phù hợp.
- Cập nhật cache tồn kho sau khi nhập.

## 9. Đơn hàng

Chức năng đơn hàng:

- Tạo đơn khi khách chọn sản phẩm và số lượng.
- Mã đơn riêng ngắn, dễ đọc cho khách/admin.
- Lưu ID database đầy đủ.
- Lưu Telegram user ID.
- Lưu chat ID.
- Lưu sản phẩm.
- Lưu số lượng.
- Lưu giá gốc.
- Lưu giảm giá.
- Lưu tổng tiền cuối cùng.
- Lưu tiền tệ hiển thị.
- Lưu phương thức thanh toán.
- Lưu payment reference.
- Lưu trạng thái giao hàng.
- Lưu lỗi giao hàng nếu có.
- Lưu nội dung đã giao nếu cần.
- Lưu thời điểm hủy/hết hạn.

Trạng thái đơn:

- `PENDING`: chờ thanh toán.
- `PAID`: đã thanh toán, chờ giao hoặc đang giao lại.
- `DELIVERED`: đã giao hàng.
- `CANCELED`: đã hủy/hết hạn.

Chức năng admin với đơn:

- Xem danh sách đơn.
- Lọc đơn theo trạng thái.
- Xem chi tiết đơn.
- Tìm theo mã đơn.
- Kiểm tra sản phẩm trong đơn.
- Giao lại đơn.
- Hoàn tiền.
- Thu hồi tiền đã hoàn.
- Xử lý đơn lỗi giao hàng.
- Theo dõi lỗi chat không tồn tại hoặc bot bị chặn.

## 10. Mã đơn giữa bot và web admin

Hệ thống có 2 loại ID:

- ID database dài: dùng nội bộ trong DB/API.
- Mã đơn ngắn: dùng cho khách và admin nhìn nhanh.

Mục tiêu hiển thị:

- Bot nên hiển thị mã đơn ngắn.
- Web admin nên ưu tiên hiển thị mã đơn ngắn.
- Khi cần tra cứu kỹ, admin vẫn có thể xem ID database đầy đủ.
- Thông báo hoàn tiền hoặc giao hàng nên dùng cùng mã đơn để tránh nhầm.

## 11. Thanh toán bằng ví nội bộ

Chức năng ví:

- Mỗi user có ví riêng.
- Khách xem số dư ví.
- Khách nạp tiền vào ví.
- Khách mua sản phẩm bằng ví.
- Khi mua bằng ví, hệ thống trừ số dư ngay nếu đủ tiền.
- Nếu không đủ tiền, bot báo cần nạp thêm.
- Ghi lịch sử giao dịch ví.
- Admin có thể cộng tiền.
- Admin có thể trừ tiền.
- Admin có thể xem lịch sử giao dịch.
- Có giao dịch hoàn tiền.
- Có chức năng thu hồi tiền đã hoàn.

Loại giao dịch ví:

- `DEPOSIT`: nạp tiền.
- `PURCHASE`: mua hàng.
- `REFUND`: hoàn tiền.
- `ADMIN_ADD`: admin cộng tiền.
- `ADMIN_DEDUCT`: admin trừ tiền.
- `REFUND_REVERSAL`: thu hồi tiền đã hoàn.

## 12. Nạp ví bằng ngân hàng VietQR

Chức năng nạp VND:

- Khách chọn nạp ví bằng ngân hàng.
- Bot hỏi số tiền VND muốn nạp.
- Bot tạo nội dung chuyển khoản riêng.
- Bot tạo QR VietQR.
- Khách quét QR và chuyển khoản.
- Bank poller tự kiểm tra lịch sử giao dịch.
- Khi match đúng tiền/nội dung, hệ thống tự cộng ví.
- Bot thông báo nạp thành công.
- Admin có thể xem giao dịch nạp trong web.

Ghi chú:

- Nạp VND là chuyển khoản ngân hàng trực tiếp.
- Khách không cần nạp ví trước nếu chọn thanh toán đơn bằng QR ngân hàng trực tiếp.
- Nội dung chuyển khoản cần đúng để auto nhận.

## 13. Thanh toán đơn bằng ngân hàng VietQR

Chức năng thanh toán đơn VND:

- Khách chọn sản phẩm.
- Bot tạo đơn chờ thanh toán.
- Bot hiển thị QR ngân hàng đúng số tiền.
- Khách chuyển khoản trực tiếp cho đơn.
- Bank poller tự kiểm tra giao dịch.
- Khi match, đơn chuyển sang `PAID`.
- Hệ thống tự giao hàng.
- Nếu quá hạn, đơn bị hủy.

Điểm kiểm tra:

- Match theo số tiền.
- Match theo nội dung chuyển khoản/mã đơn.
- Tránh xử lý trùng giao dịch.
- Có hết hạn đơn.
- Có log lỗi poller nếu API ngân hàng timeout.

## 14. Thanh toán và nạp bằng USDT

Hệ thống hỗ trợ USDT qua crypto:

- BEP20 trên BNB Smart Chain.
- TRC20 trên Tron nếu có cấu hình địa chỉ/API.

Chức năng USDT:

- Bật/tắt thanh toán crypto bằng cấu hình.
- Bật/tắt poller crypto.
- Cấu hình địa chỉ nhận BEP20.
- Cấu hình địa chỉ nhận TRC20.
- Cấu hình API key BscScan.
- Cấu hình API key TronGrid.
- Tạo đơn nạp USDT.
- Tạo đơn thanh toán USDT.
- Tính số USDT cần chuyển.
- Hiển thị số USD chính.
- Hiển thị VND/CNY tương đương cho khách dễ hiểu.
- Tạo QR USDT ngay trong bot.
- Có nút mở QR USDT.
- Có nút "Tôi đã chuyển, kiểm tra".
- Tự quét blockchain để xác nhận.
- Tự cộng ví hoặc thanh toán đơn sau khi nhận đúng giao dịch.
- Có thời gian hết hạn lệnh nạp/thanh toán.
- Lưu network, token, địa chỉ nhận, số crypto, tỷ giá tại thời điểm tạo đơn.

## 15. Tỷ giá USD/USDT

Hệ thống dùng USD/USDT làm tiền chính cho trải nghiệm quốc tế.

Chức năng tỷ giá:

- Tự cập nhật tỷ giá USDT/VND theo thị trường nếu bật.
- Có tỷ giá fallback trong `.env`.
- Có chu kỳ cập nhật tỷ giá.
- Hiển thị `1 USDT = x.xxxđ`.
- Giá sản phẩm có thể hiển thị USD là chính.
- Với khách Việt, bot hiển thị thêm VND tương đương.
- Với khách Trung, bot hiển thị thêm CNY tương đương.
- Với khách tiếng Anh, bot hiển thị USD chính và phần quy đổi nếu cần.

Biến cấu hình liên quan:

- `CRYPTO_USD_VND_RATE_AUTO`.
- `CRYPTO_USD_VND_RATE`.
- `CRYPTO_USD_VND_RATE_UPDATE_MS`.
- `CRYPTO_USD_CNY_RATE`.

## 16. QR thanh toán

Hệ thống tạo QR cho:

- VietQR ngân hàng.
- USDT BEP20.
- USDT TRC20 nếu cấu hình.

Chức năng QR:

- Tạo QR ngay trong bot.
- Gửi QR dạng ảnh.
- Nếu gửi ảnh lỗi mạng, thử gửi file.
- Nếu Telegram API lỗi tạm, retry.
- Caption QR ghi rõ mạng, số tiền, địa chỉ, thời hạn.
- Nội dung QR dùng đúng địa chỉ ví hoặc thông tin ngân hàng.

## 17. Bank poller

Chức năng bank poller:

- Chạy nền theo chu kỳ.
- Gọi API lịch sử giao dịch MB Bank.
- Có timeout để tránh treo server.
- Tự retry ở chu kỳ tiếp theo nếu API lỗi.
- Match giao dịch nạp ví.
- Match giao dịch thanh toán đơn.
- Ghi log khi có lỗi.
- Chống xử lý trùng bằng payment reference.
- Tự hủy đơn quá hạn.

Biến cấu hình liên quan:

- `MBBANK_API_TOKEN`.
- `MBBANK_HISTORY_BASE`.
- `BANK_CODE`.
- `BANK_NAME`.
- `BANK_ACCOUNT`.
- `BANK_ACCOUNT_NAME`.
- `DEFAULT_BANK_NAME`.
- `DEFAULT_BANK_ACCOUNT`.
- `DEFAULT_BANK_OWNER`.

## 18. Crypto poller

Chức năng crypto poller:

- Chạy nền theo chu kỳ.
- Bật nếu có địa chỉ nhận và `CRYPTO_POLL_ENABLED=true`.
- Tự nhận biết mạng đang bật: BEP20/TRC20.
- Kiểm tra giao dịch USDT trên blockchain.
- Match đúng địa chỉ nhận.
- Match số USDT cần chuyển.
- Xử lý sai số nhỏ nếu logic có cấu hình.
- Xác nhận nạp ví.
- Xác nhận thanh toán đơn.
- Lưu hash/reference giao dịch.
- Tránh xử lý trùng giao dịch.
- Hủy lệnh hết hạn.

Biến cấu hình liên quan:

- `CRYPTO_PAY_ENABLED`.
- `CRYPTO_POLL_ENABLED`.
- `CRYPTO_POLL_INTERVAL_MS`.
- `CRYPTO_EXPIRE_MINUTES`.
- `BEP20_USDT_ADDRESS`.
- `TRC20_USDT_ADDRESS`.
- `BSCSCAN_API_KEY`.
- `TRONGRID_API_KEY`.

## 19. Giao hàng tự động

Chức năng giao hàng:

- Giao hàng sau khi đơn được xác nhận thanh toán.
- Hỗ trợ giao text.
- Hỗ trợ giao file.
- Hỗ trợ giao nhiều dòng stock.
- Lưu nội dung giao hàng vào đơn nếu cần.
- Chuyển đơn sang `DELIVERED` sau khi giao thành công.
- Nếu giao lỗi, đơn quay về `PAID` để có thể giao lại.
- Có retry khi lỗi mạng Telegram.
- Có giới hạn retry file đính kèm.
- Có thể bỏ qua attachment phụ nếu gửi file lỗi nhưng đơn vẫn có nội dung chính.

Các lỗi được xử lý:

- Telegram socket hang up.
- Telegram ECONNRESET.
- Chat không tồn tại.
- Bot bị user chặn.
- File không gửi được.
- Thiếu stock.

## 20. Delivery recovery

Chức năng khôi phục giao hàng:

- Chạy nền theo chu kỳ.
- Tìm đơn `PAID` chưa giao.
- Thử giao lại theo batch.
- Có backoff tăng dần khi lỗi tạm.
- Có giới hạn tuổi đơn cần recovery.
- Nếu lỗi vĩnh viễn như `chat not found`, bot bị chặn, hệ thống chặn retry tự động để tránh spam log.
- Admin vẫn có thể xem và xử lý thủ công.

Biến cấu hình thường dùng:

- Chu kỳ recovery.
- Batch size.
- Max age theo giờ.
- Số lần retry gửi Telegram.

## 21. Thông báo đơn hàng

Hệ thống có thông báo đơn hàng cho:

- Channel công khai.
- Bot/khách hoặc admin tùy cấu hình.
- Người dùng cụ thể theo chế độ riêng.

Chức năng thông báo:

- Bật/tắt thông báo đơn lên channel.
- Bật/tắt thông báo đơn trong bot.
- User có thể ẩn thông báo 1 ngày nếu thấy phiền.
- Admin có thể chỉnh chế độ thông báo cho user trên web admin.
- Hỗ trợ trạng thái bật, tắt, tắt 24 giờ.
- Thông báo channel ẩn danh người mua.
- Tên người mua được mask, ví dụ `ngu***`.
- Không lộ username/chat ID đầy đủ trên channel công khai.
- Link mua hàng trong thông báo trỏ đúng vào sản phẩm.
- Nội dung thông báo có tên sản phẩm, số lượng, tổng tiền.

## 22. Quyền riêng tư người mua

Chức năng bảo vệ thông tin:

- Không hiển thị đầy đủ tên/username khách trên channel.
- Mask tên người mua.
- Không đưa Telegram ID thật lên thông báo công khai.
- Không đưa email/token/API secret ra giao diện khách.
- Log kỹ thuật có redact bot token trong lỗi Telegram.

## 23. Tài khoản khách hàng

Chức năng tài khoản:

- Lưu Telegram ID.
- Lưu username.
- Lưu first name.
- Lưu ngôn ngữ.
- Lưu số dư.
- Lưu VIP level.
- Lưu tổng chi tiêu.
- Lưu mã giới thiệu.
- Lưu người giới thiệu.
- Lưu trạng thái bị khóa.
- Lưu trạng thái thông báo đơn.
- Xem thông tin tài khoản trên bot.
- Xem lịch sử mua hàng.
- Xem lịch sử ví.

## 24. VIP

Chức năng VIP:

- Có nhiều cấp VIP.
- Cấu hình tên cấp.
- Cấu hình chi tiêu tối thiểu.
- Cấu hình phần trăm giảm giá.
- Cấu hình bonus referral.
- Cấu hình quyền lợi.
- Tự cập nhật tổng chi tiêu sau đơn thành công.
- Có thể nâng cấp VIP dựa trên tổng chi tiêu.
- Admin quản lý cấu hình VIP trong hệ thống.

## 25. Referral

Chức năng giới thiệu:

- Mỗi user có mã giới thiệu.
- Khách mới có thể được gắn người giới thiệu.
- Lưu quan hệ referrer/referee.
- Tính hoa hồng theo đơn.
- Hoa hồng có trạng thái.
- Có thể kết hợp với VIP bonus.
- Admin xem hệ thống giới thiệu.

## 26. Coupon và khuyến mãi

Chức năng coupon:

- Tạo mã giảm giá.
- Giảm theo phần trăm hoặc số tiền.
- Giới hạn số lần dùng.
- Đếm số lần đã dùng.
- Đơn tối thiểu.
- Giảm tối đa.
- Coupon chỉ cho VIP nếu cấu hình.
- Ngày hết hạn.
- Bật/tắt coupon.
- Áp dụng coupon khi mua hàng.

## 27. Giảm giá theo số lượng

Chức năng giảm giá số lượng:

- Cấu hình bậc giảm theo số lượng mua.
- Áp dụng khi khách mua nhiều.
- Quản lý trên web admin.
- Giúp bán sản phẩm số theo combo/số lượng lớn.

## 28. Khiếu nại và hỗ trợ

Chức năng hỗ trợ:

- Menu hỗ trợ trong bot.
- Link kênh hỗ trợ.
- Trang khiếu nại trên admin.
- Lưu và theo dõi khiếu nại nếu khách gửi.
- Admin xử lý khiếu nại.

## 29. Web admin

Web admin có các khu vực chính:

- Tổng quan.
- Giao dịch ví/Nạp tiền.
- Đơn hàng.
- Khiếu nại.
- Danh mục.
- Sản phẩm.
- Nhập kho.
- Mã giảm giá.
- Giảm giá số lượng.
- Người dùng.
- Hoạt động khách.
- Reseller/API.
- Đơn đại lý.
- Affiliate/CTV.
- Cấp VIP.
- Cấu hình bot.
- Gửi tin hàng loạt.
- Lịch gửi tin.
- Nhật ký gửi tin.
- Cấu hình shop.
- Thanh toán.
- Theo dõi ngân hàng.
- SePay Debug.
- Database viewer.
- Cài đặt icon.
- Gói/plans nếu bật trong admin.

## 30. Dashboard admin

Chức năng tổng quan:

- Doanh thu hôm nay.
- Số đơn hôm nay.
- User mới.
- Sản phẩm đang bật.
- Tổng user.
- Doanh thu toàn thời gian.
- Đơn chờ xử lý.
- Doanh thu 30 ngày.
- Biểu đồ doanh thu 7/30 ngày.
- Top sản phẩm bán chạy.
- Cảnh báo tồn kho thấp.
- Danh sách đơn gần đây.
- Trạng thái bot online/offline.

## 31. Quản lý sản phẩm trên admin

Chức năng:

- Tạo/sửa/ẩn sản phẩm.
- Tìm kiếm sản phẩm.
- Lọc trạng thái.
- Lọc danh mục.
- Lọc kiểu giao hàng.
- Xem số lượng tồn.
- Cấu hình giá.
- Cấu hình giá vốn.
- Cấu hình tiền tệ.
- Cấu hình min/max quantity.
- Cấu hình ảnh/icon.
- Cấu hình auto disable/hide khi hết hàng.
- Xem sản phẩm theo danh mục.

## 32. Quản lý user trên admin

Chức năng:

- Xem danh sách user.
- Tìm user.
- Xem chi tiết user.
- Xem số dư.
- Xem tổng chi tiêu.
- Xem VIP.
- Xem đơn của user.
- Xem giao dịch ví của user.
- Cộng/trừ tiền thủ công.
- Khóa/mở user nếu có cấu hình.
- Bật/tắt thông báo đơn cho từng user.
- Tắt thông báo 24 giờ cho user.

## 33. Quản lý giao dịch ví trên admin

Chức năng:

- Xem toàn bộ giao dịch ví.
- Lọc theo ngày.
- Lọc theo loại giao dịch.
- Xem số tiền.
- Xem mô tả giao dịch.
- Xem user liên quan.
- Xem thời gian.
- Thu hồi tiền đã hoàn.
- Tránh thu hồi nhầm nhiều lần bằng trạng thái/reference.

## 34. Thu hồi tiền đã hoàn

Chức năng:

- Admin xem giao dịch hoàn tiền.
- Admin bấm thu hồi nếu đơn đã xử lý xong hoặc hoàn sai.
- Hệ thống tạo giao dịch thu hồi.
- Trừ lại số tiền đã hoàn khỏi ví khách.
- Ghi mô tả liên kết với giao dịch hoàn tiền cũ.
- Ghi log audit admin.
- Chặn thu hồi trùng cùng một giao dịch.

## 35. Cấu hình shop

Chức năng:

- Tên shop.
- Mô tả shop.
- Link hỗ trợ.
- Link kênh bắt buộc.
- Cấu hình giao diện/menu.
- Cấu hình thông báo.
- Cấu hình thanh toán.
- Cấu hình icon.
- Cache cấu hình để bot chạy nhanh.
- Tự invalidate cache khi admin lưu.

## 36. Icon Telegram custom emoji

Chức năng icon:

- Cấu hình icon cho menu bot.
- Cấu hình icon cho danh mục.
- Cấu hình icon cho sản phẩm.
- Hỗ trợ emoji thường.
- Hỗ trợ Telegram custom emoji ID.
- Có nhiều key icon để thay toàn bộ menu.
- Có preview icon.
- Có nút kiểm tra icon.
- Kiểm tra icon bằng Telegram `getCustomEmojiStickers`.
- Hiển thị icon nào hợp lệ, icon nào lỗi.
- Lưu tất cả icon từ web admin.
- Bot tự load icon mới sau khi lưu.

## 37. Gửi tin hàng loạt

Chức năng broadcast:

- Gửi tin cho toàn bộ user.
- Gửi tin cho nhóm user theo điều kiện nếu admin chọn.
- Gửi tin cho VIP.
- Theo dõi số gửi thành công.
- Theo dõi số gửi thất bại.
- Lưu lịch sử broadcast.
- Có trang nhật ký gửi tin.
- Có lịch gửi tin.
- Gửi cảnh báo tồn kho nếu cần.

## 38. Lịch gửi tin

Chức năng:

- Tạo tin hẹn giờ.
- Lưu nội dung.
- Lưu thời gian gửi.
- Theo dõi trạng thái.
- Admin xem lịch.
- Admin xem lịch sử gửi.

## 39. Reseller/API bán hàng

Chức năng reseller/API:

- Admin tạo API key cho reseller.
- Quản lý key.
- Bật/tắt key.
- Xem kết nối API.
- Xem tài liệu API.
- Xem đơn reseller.
- Cho hệ thống bên ngoài lấy catalog nếu endpoint hỗ trợ.
- Cho hệ thống bên ngoài tạo đơn nếu endpoint hỗ trợ.
- Theo dõi đơn đại lý.

## 40. API server

Các nhóm API chính:

- Health check.
- Catalog shop.
- Admin auth.
- Dashboard stats.
- Products.
- Categories.
- Orders.
- Users.
- Wallet transactions.
- Coupons.
- Quantity discounts.
- Broadcast.
- Scheduled broadcast.
- Seller API keys.
- Bank history/debug.
- Payment settings.
- Bot settings.
- Icon settings/check.
- Database viewer.
- Export CSV.
- IPN webhook.

Endpoint tiêu biểu:

- `GET /health`.
- `GET /api/shop/catalog`.
- `POST /webhook/ipn`.
- `GET /admin-new`.
- `GET /api/admin/bot-status`.
- `GET /api/admin/stats`.
- `GET /api/admin/products`.
- `GET /api/admin/categories`.
- `GET /api/admin/orders`.
- `GET /api/admin/users`.
- `GET /api/admin/transactions`.

## 41. Web storefront

Chức năng web bán hàng:

- Trang shop tĩnh trong `public/shop`.
- Load catalog qua API.
- Hiển thị danh mục/sản phẩm.
- Có link mở bot để mua.
- Có thể dùng deep link vào đúng sản phẩm.
- Hỗ trợ khách xem nhanh sản phẩm ngoài Telegram.

## 42. Deep link sản phẩm

Chức năng link mua hàng:

- Tạo link Telegram mở bot.
- Link có payload sản phẩm.
- Khi khách bấm link, bot mở đúng sản phẩm nếu payload hợp lệ.
- Dùng trong thông báo channel.
- Dùng trong web storefront.
- Giúp khách không phải tự tìm lại sản phẩm.

## 43. Bảo mật admin

Chức năng bảo mật:

- Admin đăng nhập bằng username/password.
- Dùng `ADMIN_SECRET` cho API admin.
- Middleware kiểm tra quyền admin.
- Chỉ admin trong `ADMIN_IDS` được dùng lệnh admin bot.
- Log hành động admin vào audit.
- Không hiển thị secret trong tài liệu/chức năng.
- Token bot được redact trong log lỗi.

## 44. Audit log

Chức năng audit:

- Ghi admin ID.
- Ghi hành động.
- Ghi target.
- Ghi chi tiết.
- Ghi thời gian.
- Theo dõi tạo/sửa/xóa sản phẩm.
- Theo dõi chỉnh danh mục.
- Theo dõi giao dịch ví.
- Theo dõi thu hồi hoàn tiền.
- Theo dõi các thao tác nhạy cảm.

## 45. Backup và export

Chức năng:

- Backup dữ liệu định kỳ.
- Cấu hình thư mục backup.
- Cấu hình số bản backup tối đa.
- Log backup.
- Export đơn hàng CSV.
- Export doanh thu CSV.
- Export user CSV.
- Dùng cho đối soát và lưu trữ.

Biến cấu hình:

- `BACKUP_DIR`.
- `MAX_BACKUPS`.
- `EXPORT_DIR`.

## 46. Database viewer

Chức năng:

- Xem dữ liệu các collection/model chính.
- Dùng cho kiểm tra nhanh trong admin.
- Chỉ đọc để hạn chế rủi ro.
- Hỗ trợ các bảng như user, product, order, stock, wallet, transaction, coupon, category, complaint, audit log, referral, VIP, setting.

## 47. Cache và hiệu năng

Chức năng:

- Pre-warm cache khi server khởi động.
- Cache danh mục.
- Cache sản phẩm/menu.
- Cache cấu hình shop.
- Cache emoji/icon.
- Invalidate cache khi admin cập nhật dữ liệu.
- DB keep-alive để giảm lỗi kết nối.
- Nén response HTTP bằng compression.
- Giới hạn body upload admin để nhập kho nhiều dòng/file.

## 48. Chống spam và ổn định bot

Chức năng:

- Rate limit thao tác bot.
- Safe edit message để tránh lỗi `message is not modified`.
- Retry khi Telegram API lỗi mạng.
- Giới hạn socket Telegram.
- Chế độ polling.
- Chế độ webhook nếu cấu hình.
- Tắt webhook khi dùng polling.
- Graceful shutdown khi tắt server.
- Log lỗi không làm crash toàn bộ app nếu là lỗi tạm.

## 49. Cấu hình vận hành Telegram

Các cấu hình quan trọng:

- `BOT_TOKEN`.
- `TELEGRAM_BOT_TOKEN`.
- `BOT_MODE`.
- `WEBHOOK_ENABLED`.
- `WEBHOOK_URL`.
- `WEBHOOK_CERT_PATH`.
- `WEBHOOK_KEY_PATH`.
- `HTTPS_PORT`.
- `TELEGRAM_KEEP_ALIVE`.
- `TELEGRAM_MAX_SOCKETS`.
- `TELEGRAM_SEND_RETRY_ATTEMPTS`.
- `TELEGRAM_DOCUMENT_RETRY_ATTEMPTS`.

Gợi ý:

- VPS thường nên dùng polling nếu webhook/SSL chưa ổn.
- Nếu dùng polling, đặt `WEBHOOK_ENABLED=false`.
- Nếu dùng webhook, cần URL HTTPS hợp lệ và Telegram gọi được từ internet.

## 50. Cấu hình nhóm bắt buộc

Chức năng:

- Bắt khách tham gia nhóm/kênh trước khi dùng bot.
- Link nhóm hiển thị theo ngôn ngữ khách chọn.
- Bot kiểm tra membership.
- Bot cần là admin trong nhóm/kênh để kiểm tra ổn định.
- Có cấu hình cho phép admin bypass.
- Có cấu hình fail-open.

Biến cấu hình:

- `REQUIRED_GROUP`.
- `REQUIRED_GROUP_URL`.
- `REQUIRE_GROUP_JOIN`.
- `GROUP_GATE_FAILOPEN`.
- `GROUP_GATE_ADMIN_BYPASS`.

## 51. SePay/IPN

Chức năng:

- Có endpoint IPN webhook.
- Có secret token để xác thực IPN.
- Có cấu hình merchant/secret nếu dùng SePay.
- Dùng cho tích hợp thanh toán ngoài nếu cần.

Biến cấu hình:

- `IPN_SECRET_TOKEN`.
- `SEPAY_MERCHANT_ID`.
- `SEPAY_SECRET_KEY`.

## 52. Log hệ thống

Chức năng:

- Log server start.
- Log DB ready.
- Log cache pre-warm.
- Log bot polling/webhook.
- Log bank polling.
- Log crypto polling.
- Log delivery recovery.
- Log Telegram retry.
- Log lỗi giao hàng.
- Log lỗi bank API.
- Log lỗi crypto API.
- Log cập nhật tỷ giá.
- Có thể gửi log tới Telegram channel nếu cấu hình bot log.

Biến cấu hình:

- `LOG_BOT_TOKEN`.
- `LOG_CHANNEL_ID`.

## 53. File và module chính

Backend:

- `src/server.js`: khởi động Express, bot, poller, webhook/IPN, static admin/shop.
- `src/bot.js`: logic bot khách hàng và handler Telegram.
- `src/api-routes.js`: API admin.
- `src/wallet.js`: ví, giao dịch, hoàn tiền, thu hồi hoàn tiền.
- `src/delivery.js`: giao hàng.
- `src/delivery-recovery.js`: tự giao lại đơn bị kẹt.
- `src/bank-poller.js`: tự kiểm tra giao dịch ngân hàng.
- `src/bank-history.js`: gọi API lịch sử MB Bank.
- `src/crypto-poller.js`: tự kiểm tra giao dịch crypto.
- `src/payment/crypto.js`: logic USDT/BEP20/TRC20/QR/tỷ giá.
- `src/payment/vietqr.js`: tạo VietQR.
- `src/order-notifications.js`: cấu hình thông báo đơn theo user.
- `src/order-code.js`: mã đơn ngắn.
- `src/telegram-links.js`: link bot/deep link sản phẩm.
- `src/icon-utils.js`: kiểm tra custom emoji ID.
- `src/emoji-map.js`: map icon bot.
- `src/money-display.js`: format USD/VND/CNY.
- `src/i18n`: nội dung đa ngôn ngữ.

Admin React:

- `admin-react/src/pages/Dashboard.jsx`.
- `admin-react/src/pages/Orders.jsx`.
- `admin-react/src/pages/Transactions.jsx`.
- `admin-react/src/pages/Products.jsx`.
- `admin-react/src/pages/Categories.jsx`.
- `admin-react/src/pages/StockEntry.jsx`.
- `admin-react/src/pages/Customers.jsx`.
- `admin-react/src/pages/Promotions.jsx`.
- `admin-react/src/pages/QuantityDiscounts.jsx`.
- `admin-react/src/pages/SellerApi.jsx`.
- `admin-react/src/pages/ResellerOrders.jsx`.
- `admin-react/src/pages/bot/BotConfig.jsx`.
- `admin-react/src/pages/bot/Broadcast.jsx`.
- `admin-react/src/pages/bot/ScheduledBroadcast.jsx`.
- `admin-react/src/pages/bot/BotLogs.jsx`.
- `admin-react/src/pages/system/Settings.jsx`.
- `admin-react/src/pages/system/Payment.jsx`.
- `admin-react/src/pages/system/BankMonitor.jsx`.
- `admin-react/src/pages/system/DatabaseViewer.jsx`.
- `admin-react/src/pages/system/SepayDebug.jsx`.

## 54. Database models chính

Models/chức năng dữ liệu:

- `User`: user Telegram, ngôn ngữ, ví, VIP, referral, trạng thái thông báo.
- `Category`: danh mục, icon, trạng thái.
- `Product`: sản phẩm, giá, tồn kho, delivery mode, icon.
- `StockItem`: dòng hàng tồn kho.
- `Order`: đơn hàng, thanh toán, giao hàng.
- `Coupon`: mã giảm giá.
- `Referral`: giới thiệu và hoa hồng.
- `Setting`: cấu hình key-value.
- `BackupLog`: lịch sử backup.
- `AuditLog`: nhật ký admin.
- `VipLevel`: cấu hình VIP.
- `Broadcast`: lịch sử gửi tin.
- `Wallet`: ví user.
- `WalletTransaction`: giao dịch ví.
- `Complaint`: khiếu nại nếu bật.
- `ScheduledBroadcast`: tin hẹn giờ nếu bật.

## 55. Test hiện có

Các nhóm test trong thư mục `test`:

- Delivery recovery.
- Icon utils.
- Menu icons.
- Order code.
- Order notifications.
- Order privacy.
- Payment amounts.
- Refund reversal.
- Telegram links.

Lệnh test:

```bash
npm test
```

## 56. Lệnh vận hành thường dùng

Cài dependency:

```bash
npm install
```

Chạy production/local:

```bash
npm start
```

Chạy development:

```bash
npm run dev
```

Chạy test:

```bash
npm test
```

Build admin React:

```bash
cd admin-react
npm install
npm run build
```

Kéo code trên VPS:

```bash
git pull origin main
npm install
npm start
```

## 57. Các biến môi trường quan trọng

Bot:

- `BOT_TOKEN`.
- `TELEGRAM_BOT_TOKEN`.
- `ADMIN_IDS`.
- `TELEGRAM_CHAT_ID`.
- `PORT`.

Database:

- `DATABASE_URL`.
- `MONGODB_URI`.
- `MONGODB_DB`.

Admin:

- `ADMIN_SECRET`.
- `ADMIN_USERNAME`.
- `ADMIN_PASSWORD`.
- `ADMIN_TELEGRAM`.

Ngân hàng:

- `BANK_CODE`.
- `BANK_NAME`.
- `BANK_ACCOUNT`.
- `BANK_ACCOUNT_NAME`.
- `MBBANK_API_TOKEN`.
- `MBBANK_HISTORY_BASE`.
- `DEFAULT_BANK_NAME`.
- `DEFAULT_BANK_ACCOUNT`.
- `DEFAULT_BANK_OWNER`.

Crypto:

- `CRYPTO_PAY_ENABLED`.
- `CRYPTO_POLL_ENABLED`.
- `CRYPTO_POLL_INTERVAL_MS`.
- `CRYPTO_EXPIRE_MINUTES`.
- `CRYPTO_USD_VND_RATE_AUTO`.
- `CRYPTO_USD_VND_RATE`.
- `CRYPTO_USD_VND_RATE_UPDATE_MS`.
- `CRYPTO_USD_CNY_RATE`.
- `BEP20_USDT_ADDRESS`.
- `TRC20_USDT_ADDRESS`.
- `BSCSCAN_API_KEY`.
- `TRONGRID_API_KEY`.

Nhóm/kênh:

- `REQUIRED_GROUP`.
- `REQUIRED_GROUP_URL`.
- `REQUIRE_GROUP_JOIN`.
- `GROUP_GATE_FAILOPEN`.
- `GROUP_GATE_ADMIN_BYPASS`.
- `ORDER_NOTIFY_CHANNEL`.
- `SUPPORT_CHANNEL_URL`.

Webhook/IPN:

- `BOT_MODE`.
- `WEBHOOK_ENABLED`.
- `WEBHOOK_URL`.
- `WEBHOOK_CERT_PATH`.
- `WEBHOOK_KEY_PATH`.
- `HTTPS_PORT`.
- `IPN_SECRET_TOKEN`.
- `SEPAY_MERCHANT_ID`.
- `SEPAY_SECRET_KEY`.

Email/log/backup:

- `GMAIL_USER`.
- `GMAIL_APP_PASSWORD`.
- `EMAIL_FROM`.
- `LOG_BOT_TOKEN`.
- `LOG_CHANNEL_ID`.
- `BACKUP_DIR`.
- `MAX_BACKUPS`.
- `EXPORT_DIR`.

## 58. Những điểm cần kiểm tra khi vận hành

Checklist sau khi update VPS:

- Bot chạy được bằng `npm start`.
- Log có `DB ready`.
- Log có `Bot polling mode` hoặc webhook đúng cấu hình.
- Bank polling đã start nếu bật thanh toán ngân hàng.
- Crypto polling đã start nếu bật USDT và có địa chỉ ví.
- Tỷ giá USDT/VND cập nhật được.
- Admin web vào được.
- Sản phẩm hiển thị đúng.
- QR ngân hàng tạo được.
- QR USDT tạo được.
- Đơn test bằng ví giao hàng được.
- Đơn test bằng VietQR tự nhận được.
- Nạp ví VND tự cộng được.
- Nạp USDT BEP20 tự cộng được.
- Thông báo channel đã ẩn tên khách.
- Link thông báo mở đúng sản phẩm.
- Icon custom emoji hiển thị đúng.
- User có thể tắt thông báo 1 ngày.
- Admin có thể thu hồi tiền hoàn.
- Recovery không spam lại đơn lỗi vĩnh viễn.

## 59. Rủi ro và lưu ý

- Nếu Telegram báo `socket hang up` hoặc `ECONNRESET`, thường là lỗi mạng tới Telegram, hệ thống sẽ retry.
- Nếu Telegram báo `chat not found`, user/chat không còn hợp lệ, recovery sẽ chặn retry tự động.
- Nếu Telegram báo `bot was blocked by the user`, khách đã chặn bot, không thể giao qua bot cho khách đó.
- Nếu dùng BEP20 từ Binance, cần chuyển đúng mạng `BNB Smart Chain (BEP20)` và đúng token USDT.
- Nếu chuyển nhầm mạng, bot không thể tự nhận.
- Nếu thiếu `BSCSCAN_API_KEY`, BEP20 poller có thể không hoạt động ổn định.
- Nếu thiếu `TRONGRID_API_KEY` hoặc `TRC20_USDT_ADDRESS`, TRC20 sẽ bị bỏ qua.
- Nếu bank API timeout, đơn/nạp VND sẽ tự nhận ở chu kỳ sau khi API hồi phục.
- Nếu restart server, state tạm trong bot có thể mất, khách nên bấm `/start` lại.
- Không nên chạy đồng thời nhiều process bot cùng một token ở polling mode.

## 60. Tóm tắt luồng tiền

VND:

1. Khách mua hàng trực tiếp bằng QR ngân hàng hoặc nạp VND vào ví.
2. Bank poller kiểm tra MB Bank.
3. Match giao dịch.
4. Cộng ví hoặc thanh toán đơn.
5. Giao hàng tự động.

USD/USDT:

1. Giá chính hiển thị theo USD/USDT.
2. Bot hiển thị thêm VND/CNY tương đương theo ngôn ngữ.
3. Khách nạp USDT vào ví hoặc thanh toán đơn bằng USDT.
4. Bot tạo QR USDT đúng mạng.
5. Crypto poller kiểm tra blockchain.
6. Match giao dịch.
7. Cộng ví hoặc thanh toán đơn.
8. Giao hàng tự động.

Ví nội bộ:

1. Khách nạp VND hoặc USDT vào ví.
2. Số dư được lưu trong hệ thống.
3. Khi mua bằng ví, bot trừ ví.
4. Nếu đơn lỗi/hủy cần hoàn, admin hoàn tiền.
5. Nếu hoàn nhầm hoặc đơn đã xử lý xong, admin thu hồi tiền đã hoàn.

## 61. Luồng chi tiết khách mới vào bot

Mục tiêu của luồng này là bảo đảm khách luôn đi theo đúng thứ tự: chọn ngôn ngữ, tham gia nhóm, rồi mới dùng menu.

Các bước:

1. Khách mở bot hoặc bấm `/start`.
2. Bot kiểm tra user đã tồn tại trong database chưa.
3. Nếu chưa có user, bot tạo user mới với thông tin Telegram.
4. Bot kiểm tra user đã có ngôn ngữ chưa.
5. Nếu chưa có ngôn ngữ, bot hiển thị màn hình chọn ngôn ngữ.
6. Khách chọn `Tiếng Việt`, `English` hoặc `中文`.
7. Bot lưu ngôn ngữ vào user.
8. Bot kiểm tra cấu hình `REQUIRE_GROUP_JOIN`.
9. Nếu bật bắt buộc tham gia nhóm, bot kiểm tra khách đã tham gia `REQUIRED_GROUP` chưa.
10. Nếu chưa tham gia, bot gửi hướng dẫn tham gia nhóm bằng đúng ngôn ngữ khách vừa chọn.
11. Khách bấm vào link nhóm/kênh.
12. Khách quay lại bot và bấm kiểm tra hoặc `/start` lại.
13. Bot kiểm tra lại membership.
14. Nếu đạt, bot hiển thị menu chính.
15. Nếu không đạt, bot tiếp tục giữ ở màn hình yêu cầu tham gia nhóm.

Các trường hợp đặc biệt:

- Nếu bot chưa là admin của nhóm và `GROUP_GATE_FAILOPEN=false`, khách có thể bị chặn vì bot không kiểm tra được.
- Nếu bot chưa là admin của nhóm và `GROUP_GATE_FAILOPEN=true`, hệ thống cho khách đi tiếp để tránh khóa nhầm.
- Nếu user là admin và `GROUP_GATE_ADMIN_BYPASS=true`, admin được bỏ qua cổng tham gia nhóm.
- Nếu khách đổi ngôn ngữ sau này, toàn bộ menu và thông báo sau đó dùng ngôn ngữ mới.

## 62. Luồng chi tiết mua hàng bằng ví

Mục tiêu: khách đã có số dư ví và mua hàng nhanh, không cần quét QR mỗi đơn.

Các bước:

1. Khách bấm `Mua hàng`.
2. Bot hiển thị danh mục đang bật.
3. Khách chọn danh mục.
4. Bot hiển thị sản phẩm còn bán trong danh mục.
5. Khách chọn sản phẩm.
6. Bot hiển thị chi tiết sản phẩm: tên, mô tả, tồn kho, giá USD chính và quy đổi nếu cần.
7. Khách nhập số lượng hoặc chọn số lượng từ nút.
8. Bot kiểm tra min/max quantity.
9. Bot kiểm tra tồn kho nếu sản phẩm là `STOCK_LINES`.
10. Bot tính tổng tiền.
11. Bot áp dụng VIP discount nếu user đủ điều kiện.
12. Bot áp dụng coupon nếu khách nhập mã hợp lệ.
13. Bot tạo order trạng thái `PENDING`.
14. Khách chọn thanh toán bằng ví.
15. Hệ thống kiểm tra số dư ví.
16. Nếu không đủ số dư, bot báo số tiền thiếu và gợi ý nạp ví.
17. Nếu đủ số dư, hệ thống trừ ví.
18. Tạo giao dịch ví loại `PURCHASE`.
19. Order chuyển sang `PAID`.
20. Hệ thống gọi giao hàng tự động.
21. Nếu giao thành công, order chuyển sang `DELIVERED`.
22. Bot gửi hàng cho khách.
23. Hệ thống gửi thông báo đơn nếu bật.
24. Hệ thống cập nhật totalSpent và VIP.
25. Hệ thống tính referral commission nếu có.

Điểm cần đúng:

- Không trừ ví nếu đơn chưa tạo hợp lệ.
- Không giao hàng nếu ví không đủ.
- Không cấp trùng stock.
- Nếu giao hàng lỗi sau khi đã trừ ví, đơn giữ `PAID` để recovery hoặc admin giao lại.

## 63. Luồng chi tiết mua hàng bằng VietQR trực tiếp

Mục tiêu: khách mua đơn VND bằng cách quét QR ngân hàng, không cần nạp ví trước.

Các bước:

1. Khách chọn sản phẩm.
2. Khách chọn số lượng.
3. Bot tính tổng tiền cần thanh toán.
4. Bot tạo order `PENDING`.
5. Khách chọn thanh toán bằng ngân hàng/VietQR.
6. Bot tạo nội dung chuyển khoản riêng cho đơn.
7. Bot tạo QR ngân hàng với đúng số tiền và nội dung.
8. Bot gửi ảnh QR cho khách.
9. Khách chuyển khoản đúng số tiền.
10. Bank poller lấy lịch sử giao dịch.
11. Bank poller tìm giao dịch khớp số tiền và nội dung/mã đơn.
12. Nếu khớp, order chuyển sang `PAID`.
13. Hệ thống giao hàng tự động.
14. Order chuyển sang `DELIVERED` nếu giao thành công.
15. Bot thông báo thành công cho khách.

Các lỗi thường gặp:

- Khách chuyển sai nội dung: poller có thể không match.
- Khách chuyển sai số tiền: poller có thể không match.
- API ngân hàng timeout: hệ thống chờ chu kỳ sau.
- Đơn hết hạn trước khi tiền về: cần admin xử lý thủ công nếu tiền đã nhận.

## 64. Luồng chi tiết nạp ví bằng VND

Mục tiêu: khách nạp tiền vào ví trước, sau đó mua nhiều lần bằng ví.

Các bước:

1. Khách bấm `Ví`.
2. Khách chọn `Nạp tiền`.
3. Bot hỏi phương thức nạp.
4. Khách chọn ngân hàng/VietQR.
5. Bot hỏi số tiền VND muốn nạp.
6. Bot kiểm tra số tiền tối thiểu.
7. Bot tạo lệnh nạp ví.
8. Bot tạo nội dung chuyển khoản riêng.
9. Bot tạo QR ngân hàng.
10. Khách chuyển khoản.
11. Bank poller match giao dịch.
12. Hệ thống cộng số dư ví.
13. Tạo giao dịch ví `DEPOSIT`.
14. Bot báo nạp ví thành công.
15. Admin thấy giao dịch trong trang nạp tiền/giao dịch.

Điểm cần đúng:

- Không cộng ví hai lần cho một giao dịch.
- Nội dung chuyển khoản nên rõ để auto nhận.
- Nếu khách chuyển thiếu/thừa, admin cần đối soát.

## 65. Luồng chi tiết nạp ví bằng USDT BEP20/TRC20

Mục tiêu: khách nạp USD/USDT vào ví, hệ thống tự xác nhận blockchain.

Các bước:

1. Khách bấm `Ví`.
2. Khách chọn `Nạp tiền`.
3. Bot hỏi phương thức nạp.
4. Khách chọn USDT BEP20 hoặc USDT TRC20.
5. Bot hỏi số tiền muốn nạp.
6. Bot hiểu số tiền theo USD/USDT.
7. Bot hiển thị thêm quy đổi VND/CNY tùy ngôn ngữ.
8. Bot tạo lệnh nạp crypto.
9. Bot ghi network, token, địa chỉ nhận, số USDT cần chuyển.
10. Bot tạo QR ví USDT.
11. Bot gửi thông tin rõ ràng: mạng, số USDT, địa chỉ ví, thời hạn.
12. Khách chuyển đúng mạng và đúng số USDT.
13. Crypto poller kiểm tra blockchain.
14. Poller tìm giao dịch vào đúng địa chỉ nhận.
15. Poller kiểm tra token là USDT.
16. Poller kiểm tra số lượng nhận được đủ.
17. Nếu khớp, hệ thống cộng ví.
18. Tạo giao dịch ví `DEPOSIT`.
19. Bot thông báo nạp USDT thành công.

Điểm cần đúng:

- BEP20 phải chuyển bằng mạng BNB Smart Chain.
- TRC20 phải chuyển bằng mạng Tron.
- Chuyển nhầm mạng không tự nhận được.
- Chuyển từ Binance được, miễn là chọn đúng mạng BEP20/TRC20 và đúng địa chỉ.
- Nên chuyển đúng số USDT bot yêu cầu để auto match nhanh.

## 66. Luồng chi tiết mua hàng bằng USDT

Mục tiêu: khách thanh toán đơn trực tiếp bằng USDT thay vì nạp ví trước.

Các bước:

1. Khách chọn sản phẩm.
2. Bot hiển thị giá USD chính.
3. Bot hiển thị quy đổi VND/CNY tương đương.
4. Khách chọn số lượng.
5. Bot tính tổng USD.
6. Bot tạo order `PENDING`.
7. Khách chọn phương thức USDT BEP20/TRC20.
8. Bot tính số USDT cần chuyển.
9. Bot tạo QR USDT.
10. Khách chuyển đúng số USDT.
11. Crypto poller xác nhận giao dịch.
12. Order chuyển sang `PAID`.
13. Hệ thống giao hàng.
14. Order chuyển sang `DELIVERED`.
15. Thông báo đơn được gửi nếu bật.

Điểm khác với nạp ví:

- Nạp ví: tiền vào số dư, khách dùng sau.
- Thanh toán đơn USDT: tiền dùng trực tiếp cho đơn hiện tại.
- Nếu đơn hết hạn nhưng khách đã chuyển tiền, cần admin đối soát và cộng ví/giao hàng thủ công.

## 67. Bảng trạng thái đơn hàng

| Trạng thái | Ý nghĩa | Ai tạo/cập nhật | Bước tiếp theo |
|---|---|---|---|
| `PENDING` | Đơn đã tạo, đang chờ thanh toán | Bot | Chờ bank/crypto/ví xác nhận |
| `PAID` | Đã thanh toán, chờ giao hàng hoặc giao lỗi tạm | Payment/Wallet/Recovery | Giao hàng tự động |
| `DELIVERED` | Đã giao hàng thành công | Delivery | Kết thúc |
| `CANCELED` | Đã hủy hoặc hết hạn | Expiration/Admin | Không giao tự động |

Các trường quan trọng:

- `paymentMethod`: ví, ngân hàng, crypto.
- `paymentRef`: mã giao dịch hoặc reference nội bộ.
- `cryptoNetwork`: BEP20/TRC20 nếu là crypto.
- `cryptoAmount`: số USDT cần chuyển.
- `cryptoAddress`: địa chỉ nhận.
- `cryptoUsdVndRate`: tỷ giá tại thời điểm tạo đơn.
- `deliveryError`: lỗi giao hàng gần nhất.
- `deliveryRetryBlockedAt`: thời điểm chặn retry tự động nếu lỗi vĩnh viễn.

## 68. Bảng trạng thái giao dịch ví

| Loại | Dấu tiền | Ý nghĩa |
|---|---:|---|
| `DEPOSIT` | Cộng | Khách nạp tiền vào ví |
| `PURCHASE` | Trừ | Khách mua hàng bằng ví |
| `REFUND` | Cộng | Admin/hệ thống hoàn tiền |
| `ADMIN_ADD` | Cộng | Admin cộng tiền thủ công |
| `ADMIN_DEDUCT` | Trừ | Admin trừ tiền thủ công |
| `REFUND_REVERSAL` | Trừ | Admin thu hồi khoản đã hoàn |

Nguyên tắc:

- Mỗi giao dịch ví cần có mô tả rõ.
- Giao dịch hoàn tiền nên liên kết được với đơn.
- Thu hồi hoàn tiền không được chạy trùng nhiều lần.
- Số dư user phải khớp với tổng giao dịch sau khi đối soát.

## 69. Bảng lỗi Telegram thường gặp

| Lỗi | Ý nghĩa | Cách hệ thống xử lý | Cách admin xử lý |
|---|---|---|---|
| `socket hang up` | Mạng tới Telegram bị ngắt | Retry | Chờ hoặc chạy lại nếu kéo dài |
| `ECONNRESET` | Kết nối bị reset | Retry | Kiểm tra mạng VPS |
| `message is not modified` | Nội dung edit không đổi | Bỏ qua qua safe handler | Không cần xử lý |
| `chat not found` | Chat/user không còn hợp lệ | Chặn retry tự động | Không thể giao qua chat đó |
| `bot was blocked by the user` | Khách đã chặn bot | Chặn retry tự động | Liên hệ khách ngoài bot |
| `Bad Request` khi gửi file | File/path/file id lỗi | Retry hoặc lưu lỗi | Kiểm tra payload sản phẩm |

## 70. Bảng lỗi thanh toán thường gặp

| Tình huống | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| Bank polling timeout | API ngân hàng chậm | Chờ chu kỳ sau hoặc kiểm tra token API bank |
| Không tự cộng ví VND | Sai nội dung hoặc sai số tiền | Đối soát lịch sử bank và cộng thủ công |
| Không tự nhận BEP20 | Sai mạng, sai địa chỉ, thiếu API key | Kiểm tra BscScan/API và transaction hash |
| Không tự nhận TRC20 | Chưa cấu hình địa chỉ/API TronGrid | Cấu hình `TRC20_USDT_ADDRESS` và `TRONGRID_API_KEY` |
| Khách chuyển USDT thiếu | Số nhận nhỏ hơn yêu cầu | Admin xử lý thủ công |
| Khách chuyển sau khi hết hạn | Lệnh đã bị hủy | Admin tạo giao dịch bù hoặc giao thủ công |
| Tỷ giá không cập nhật | API tỷ giá lỗi | Hệ thống dùng fallback trong env |

## 71. Mapping chức năng sang file code

| Chức năng | File chính |
|---|---|
| Khởi động server | `src/server.js` |
| Handler bot Telegram | `src/bot.js` |
| Menu bot | `src/bot-ui/keyboards.js` |
| Nội dung tin nhắn bot | `src/bot-ui/messages.js` |
| Safe edit/gửi message | `src/bot-ui/safe.js` |
| Đa ngôn ngữ | `src/i18n/index.js`, `src/i18n/vi.js`, `src/i18n/en.js`, `src/i18n/zh.js` |
| Danh mục | `src/category.js` |
| Sản phẩm/admin API | `src/api-routes.js` |
| Ví | `src/wallet.js` |
| Giao hàng | `src/delivery.js` |
| Giao lại đơn kẹt | `src/delivery-recovery.js` |
| Bank polling | `src/bank-poller.js` |
| Lịch sử bank | `src/bank-history.js` |
| VietQR | `src/payment/vietqr.js` |
| Crypto polling | `src/crypto-poller.js` |
| Logic USDT/QR crypto/tỷ giá | `src/payment/crypto.js` |
| Hiển thị tiền USD/VND/CNY | `src/money-display.js` |
| Mã đơn ngắn | `src/order-code.js` |
| Link sản phẩm Telegram | `src/telegram-links.js` |
| Thông báo đơn | `src/order-notifications.js` |
| Icon custom emoji | `src/icon-utils.js`, `src/emoji-map.js` |
| Referral | `src/referral.js` |
| VIP | `src/vip.js` |
| Coupon | `src/coupon.js` |
| Giảm giá số lượng | `src/quantity-discount.js` |
| Tồn kho | `src/inventory.js` |
| Broadcast | `src/broadcast.js` |
| Seller API | `src/seller-api.js` |
| Export | `src/export.js` |
| Backup | `src/backup.js` |
| Audit log | `src/audit.js` |
| DB adapter | `src/lib/prisma.js` |

## 72. Mapping web admin sang file giao diện

| Trang admin | File |
|---|---|
| Đăng nhập | `admin-react/src/pages/Login.jsx` |
| Tổng quan | `admin-react/src/pages/Dashboard.jsx` |
| Đơn hàng | `admin-react/src/pages/Orders.jsx` |
| Giao dịch/Nạp tiền | `admin-react/src/pages/Transactions.jsx` |
| Sản phẩm | `admin-react/src/pages/Products.jsx` |
| Danh mục | `admin-react/src/pages/Categories.jsx` |
| Nhập kho | `admin-react/src/pages/StockEntry.jsx` |
| Người dùng | `admin-react/src/pages/Customers.jsx` |
| Mã giảm giá | `admin-react/src/pages/Promotions.jsx` |
| Giảm giá số lượng | `admin-react/src/pages/QuantityDiscounts.jsx` |
| Khiếu nại | `admin-react/src/pages/Complaints.jsx` |
| Reseller/API | `admin-react/src/pages/SellerApi.jsx` |
| Kết nối API | `admin-react/src/pages/ApiConnections.jsx` |
| Tài liệu API | `admin-react/src/pages/ApiDocs.jsx` |
| Đơn reseller | `admin-react/src/pages/ResellerOrders.jsx` |
| Cấu hình bot | `admin-react/src/pages/bot/BotConfig.jsx` |
| Gửi tin hàng loạt | `admin-react/src/pages/bot/Broadcast.jsx` |
| Lịch gửi tin | `admin-react/src/pages/bot/ScheduledBroadcast.jsx` |
| Lịch sử/log bot | `admin-react/src/pages/bot/BotLogs.jsx` |
| Hoạt động khách | `admin-react/src/pages/bot/UserActivity.jsx` |
| Cài đặt chung/icon | `admin-react/src/pages/system/Settings.jsx` |
| Thanh toán | `admin-react/src/pages/system/Payment.jsx` |
| Theo dõi ngân hàng | `admin-react/src/pages/system/BankMonitor.jsx` |
| SePay Debug | `admin-react/src/pages/system/SepayDebug.jsx` |
| Database | `admin-react/src/pages/system/DatabaseViewer.jsx` |
| Referral | `admin-react/src/pages/system/Referral.jsx` |
| Plans/VIP nếu bật | `admin-react/src/pages/system/Plans.jsx` |

## 73. Checklist test sau mỗi lần sửa code

Bot cơ bản:

- Bấm `/start` với user mới.
- Chọn tiếng Việt.
- Kiểm tra thông báo tham gia nhóm hiển thị tiếng Việt.
- Đổi sang English.
- Kiểm tra menu hiển thị English.
- Đổi sang 中文.
- Kiểm tra menu hiển thị tiếng Trung.
- Bấm từng nút menu chính.
- Bấm quay lại ở từng màn hình.

Sản phẩm:

- Tạo danh mục mới.
- Tạo sản phẩm `TEXT`.
- Tạo sản phẩm `STOCK_LINES`.
- Nhập kho cho sản phẩm stock.
- Kiểm tra sản phẩm hiện trong bot.
- Kiểm tra sản phẩm hiện trên web shop.
- Bấm deep link sản phẩm.
- Kiểm tra đúng sản phẩm được mở.

Thanh toán ví:

- Cộng tiền ví cho user test.
- Mua sản phẩm bằng ví.
- Kiểm tra ví bị trừ đúng.
- Kiểm tra đơn chuyển `DELIVERED`.
- Kiểm tra hàng được gửi.
- Kiểm tra lịch sử ví có `PURCHASE`.

Thanh toán VND:

- Tạo lệnh nạp ví VND.
- Kiểm tra QR ngân hàng có số tiền đúng.
- Kiểm tra nội dung chuyển khoản rõ.
- Test bank poller với giao dịch thật hoặc dữ liệu debug.
- Kiểm tra cộng ví.
- Tạo đơn thanh toán QR trực tiếp.
- Kiểm tra order được auto paid và giao hàng.

Thanh toán USDT:

- Kiểm tra log crypto poller started.
- Tạo lệnh nạp BEP20.
- Kiểm tra QR USDT hiện trong bot.
- Kiểm tra địa chỉ nhận đúng.
- Kiểm tra số USDT cần chuyển đúng.
- Kiểm tra có dòng quy đổi VND/CNY.
- Test callback "Tôi đã chuyển, kiểm tra".
- Kiểm tra poller không cộng trùng.

Thông báo:

- Bật thông báo channel.
- Mua thử sản phẩm.
- Kiểm tra channel chỉ hiện tên đã ẩn.
- Kiểm tra link mua hàng vào đúng sản phẩm.
- Tắt thông báo channel.
- Mua thử và kiểm tra channel không nhận tin.
- Tắt thông báo user 24h.
- Kiểm tra user không bị làm phiền trong thời gian mute.

Admin:

- Đăng nhập admin.
- Vào dashboard.
- Vào đơn hàng.
- Vào giao dịch ví.
- Bấm thu hồi hoàn tiền trên một giao dịch test hợp lệ.
- Kiểm tra không thu hồi được lần hai.
- Vào cài đặt icon.
- Nhập custom emoji ID.
- Bấm kiểm tra icon.
- Lưu icon.
- Kiểm tra bot load icon mới.

Giao hàng:

- Mua sản phẩm `TEXT`.
- Mua sản phẩm `STOCK_LINES`.
- Mua sản phẩm `FILE`.
- Test khi file gửi lỗi.
- Kiểm tra order lỗi vẫn giữ `PAID`.
- Kiểm tra delivery recovery chạy.
- Kiểm tra lỗi `chat not found` bị chặn retry tự động.

## 74. Checklist update lên VPS

Trước khi update:

- Backup `.env`.
- Backup database nếu chuẩn bị sửa dữ liệu lớn.
- Kiểm tra VPS đang chạy process nào.
- Không chạy hai bot cùng token cùng lúc.

Các bước update:

1. Dừng process cũ.
2. Vào đúng thư mục dự án trên VPS.
3. Kiểm tra `git status`.
4. Nếu có sửa local ngoài ý muốn, stash hoặc backup.
5. `git pull origin main`.
6. `npm install`.
7. Nếu admin React có build mới, bảo đảm `admin-react/dist` đã có trong repo hoặc build lại.
8. Kiểm tra `.env` có đủ biến mới.
9. Chạy `npm test`.
10. Chạy `npm start`.
11. Kiểm tra log start.
12. Test `/start` trên bot.
13. Test admin web.
14. Test một đơn ví nhỏ.
15. Test QR hoặc poller nếu đang bật.

Sau khi update:

- Xem log 3-5 phút.
- Kiểm tra có lỗi Telegram lặp vô hạn không.
- Kiểm tra bank polling/crypto polling có chạy không.
- Kiểm tra tỷ giá cập nhật.
- Kiểm tra delivery recovery không spam đơn cũ lỗi vĩnh viễn.

## 75. Checklist cấu hình `.env` tối thiểu để bot chạy

Bắt buộc:

- `BOT_TOKEN` hoặc `TELEGRAM_BOT_TOKEN`.
- `ADMIN_IDS`.
- `PORT`.
- Database config đang dùng.
- `ADMIN_SECRET`.
- `ADMIN_USERNAME`.
- `ADMIN_PASSWORD`.

Nếu dùng polling:

- `BOT_MODE=polling`.
- `WEBHOOK_ENABLED=false`.
- `WEBHOOK_URL=` để trống.

Nếu dùng webhook:

- `BOT_MODE=webhook`.
- `WEBHOOK_ENABLED=true`.
- `WEBHOOK_URL=https://domain-or-ip:port`.
- `WEBHOOK_CERT_PATH` nếu dùng self-signed cert.
- `WEBHOOK_KEY_PATH` nếu chạy HTTPS local.

Nếu dùng ngân hàng:

- `BANK_CODE`.
- `BANK_NAME`.
- `BANK_ACCOUNT`.
- `BANK_ACCOUNT_NAME`.
- `MBBANK_API_TOKEN`.
- `MBBANK_HISTORY_BASE`.

Nếu dùng USDT BEP20:

- `CRYPTO_PAY_ENABLED=true`.
- `CRYPTO_POLL_ENABLED=true`.
- `BEP20_USDT_ADDRESS`.
- `BSCSCAN_API_KEY`.

Nếu dùng USDT TRC20:

- `CRYPTO_PAY_ENABLED=true`.
- `CRYPTO_POLL_ENABLED=true`.
- `TRC20_USDT_ADDRESS`.
- `TRONGRID_API_KEY`.

Nếu bắt buộc tham gia nhóm:

- `REQUIRE_GROUP_JOIN=true`.
- `REQUIRED_GROUP`.
- `REQUIRED_GROUP_URL`.
- Bot phải là admin của group/channel.

## 76. Quy tắc hiển thị tiền

Mục tiêu hiển thị:

- USD/USDT là tiền chính cho sản phẩm và crypto.
- VND là tiền ngân hàng/VietQR.
- CNY chỉ là số quy đổi tham khảo cho khách tiếng Trung.

Theo ngôn ngữ:

- Tiếng Việt: hiển thị USD chính, kèm `tương đương khoảng xđ`.
- English: hiển thị USD chính, có thể kèm VND equivalent nếu cần.
- 中文: hiển thị USD chính, kèm CNY/VND equivalent nếu cần.

Ví dụ tiếng Việt:

```text
Giá: 1.00 USDT
Tương đương khoảng 26.230đ
```

Ví dụ English:

```text
Price: 1.00 USDT
Approx: 26,230 VND
```

Ví dụ 中文:

```text
价格: 1.00 USDT
约: 7.25 CNY / 26,230 VND
```

Lưu ý:

- Tỷ giá thật được hệ thống cập nhật tự động nếu bật.
- Giá fallback trong `.env` chỉ dùng khi không lấy được tỷ giá mới.
- Không nên ghi cứng tỷ giá vào nội dung bot.

## 77. Quy tắc thông báo channel

Thông báo channel cần:

- Không lộ tên đầy đủ của khách.
- Không lộ username đầy đủ.
- Không lộ Telegram ID.
- Hiển thị tên sản phẩm rõ.
- Hiển thị số lượng.
- Hiển thị tổng tiền.
- Có link mua đúng sản phẩm.
- Dùng icon đẹp nếu đã cấu hình.

Ví dụ format mong muốn:

```text
ShopVplusPremium
Đơn mới: Kiro Power 200$ ...
Người mua: ngu***
Số lượng: 1
Tổng: 26.000 VND
```

Không nên hiển thị:

```text
Tên: @usernamefull
User: 851...
```

## 78. Quy tắc xử lý hoàn tiền

Khi hoàn tiền:

1. Xác định đúng đơn.
2. Xác định đúng user.
3. Xác định số tiền đã thanh toán.
4. Tạo giao dịch `REFUND`.
5. Cộng tiền về ví user.
6. Ghi mô tả rõ mã đơn.
7. Ghi audit log.

Khi thu hồi tiền đã hoàn:

1. Chỉ thu hồi từ giao dịch `REFUND`.
2. Kiểm tra giao dịch đó chưa bị thu hồi.
3. Kiểm tra ví user còn đủ tiền.
4. Tạo giao dịch `REFUND_REVERSAL`.
5. Trừ lại ví user.
6. Ghi liên kết tới giao dịch refund gốc.
7. Ghi audit log.
8. Không cho bấm thu hồi lần hai.

## 79. Quy tắc xử lý đơn giao lỗi

Nếu giao hàng lỗi mạng tạm:

- Retry theo cấu hình.
- Nếu vẫn lỗi, giữ đơn `PAID`.
- Delivery recovery thử lại sau.

Nếu giao hàng lỗi vĩnh viễn:

- `chat not found`: không retry tự động.
- `bot was blocked by the user`: không retry tự động.
- Admin cần liên hệ khách hoặc hoàn tiền/thu hồi tùy tình huống.

Nếu thiếu hàng:

- Không chuyển `DELIVERED`.
- Ghi lỗi giao hàng.
- Admin nhập thêm stock hoặc hoàn tiền.

Nếu file sản phẩm lỗi:

- Kiểm tra payload/file path/file id.
- Sửa sản phẩm.
- Bấm giao lại đơn.

## 80. Quy tắc thêm icon mới

Các bước:

1. Vào web admin.
2. Mở `Cài đặt chung`.
3. Vào tab `Icons`.
4. Nhập emoji thường hoặc Telegram custom emoji ID.
5. Bấm kiểm tra icon.
6. Nếu icon hợp lệ, bấm lưu tất cả.
7. Vào bot và mở lại menu để kiểm tra.

Lưu ý:

- Custom emoji ID là số dài của Telegram.
- Không phải emoji nào cũng có custom emoji ID.
- Preview trong web admin chỉ chắc chắn sau khi bấm kiểm tra qua bot API.
- Nếu bot token sai hoặc Telegram lỗi mạng, nút kiểm tra icon có thể báo lỗi tạm.

## 81. Quy tắc thêm sản phẩm mới

Các bước chuẩn:

1. Tạo hoặc chọn danh mục.
2. Tạo sản phẩm.
3. Nhập tên dễ hiểu.
4. Nhập mô tả ngắn gọn.
5. Nhập giá USD/VND tùy shop đang cấu hình.
6. Chọn delivery mode.
7. Nếu là `STOCK_LINES`, nhập kho sau khi tạo.
8. Nếu là `TEXT`, điền nội dung giao.
9. Nếu là `FILE`, điền payload file đúng.
10. Đặt min/max quantity nếu cần.
11. Đặt stock alert.
12. Đặt auto disable/hide nếu muốn tự tắt khi hết hàng.
13. Gắn icon/ảnh.
14. Bật sản phẩm.
15. Test mua thử bằng user test.

## 82. Quy tắc đối soát tiền

Đối soát VND:

- So sánh lịch sử MB Bank với `WalletTransaction`.
- Kiểm tra amount.
- Kiểm tra mô tả giao dịch.
- Kiểm tra mã đơn hoặc mã nạp.
- Kiểm tra thời gian.

Đối soát USDT:

- So sánh blockchain transaction với lệnh nạp/đơn.
- Kiểm tra network.
- Kiểm tra token contract là USDT.
- Kiểm tra địa chỉ nhận.
- Kiểm tra số lượng.
- Kiểm tra hash đã xử lý chưa.

Đối soát ví:

- Tổng tiền nạp + hoàn + admin cộng - mua hàng - admin trừ - thu hồi hoàn tiền phải ra số dư hiện tại.

## 83. Những việc hệ thống đã tự động hóa

- Tạo order.
- Tạo mã đơn.
- Tạo QR ngân hàng.
- Tạo QR USDT.
- Kiểm tra bank.
- Kiểm tra blockchain.
- Cộng ví sau nạp.
- Trừ ví khi mua.
- Giao hàng sau thanh toán.
- Giao lại đơn bị kẹt.
- Hủy đơn hết hạn.
- Cập nhật tỷ giá.
- Tính VIP.
- Tính referral.
- Gửi thông báo đơn.
- Ẩn tên khách trên channel.
- Cảnh báo tồn kho thấp.
- Tắt sản phẩm hết hàng nếu cấu hình.
- Backup định kỳ nếu cấu hình.

## 84. Những việc admin vẫn cần xử lý thủ công

- Đối soát giao dịch khách chuyển sai nội dung.
- Đối soát giao dịch khách chuyển sai số tiền.
- Xử lý khách chuyển nhầm mạng USDT.
- Giao lại cho khách đã chặn bot bằng kênh khác.
- Hoàn tiền khi thiếu hàng.
- Thu hồi tiền đã hoàn nếu hoàn nhầm.
- Cập nhật sản phẩm, kho, giá, mô tả.
- Kiểm tra API key bank/crypto khi poller lỗi.
- Kiểm tra VPS khi mạng tới Telegram yếu.

## 85. Mức độ hoàn thiện theo từng mảng

| Mảng | Trạng thái | Ghi chú |
|---|---|---|
| Bot khách hàng | Đã có | Cần test đủ 3 ngôn ngữ sau mỗi lần sửa text |
| Web admin | Đã có | Có nhiều trang quản lý chính |
| Sản phẩm/danh mục | Đã có | Hỗ trợ icon, stock, ảnh, active/inactive |
| Ví nội bộ | Đã có | Có nạp, mua, hoàn, thu hồi hoàn |
| VietQR | Đã có | Phụ thuộc API bank |
| Bank polling | Đã có | Phụ thuộc token/API bên thứ ba |
| USDT BEP20 | Đã có | Phụ thuộc BscScan API và chuyển đúng mạng |
| USDT TRC20 | Có hỗ trợ | Chỉ chạy khi cấu hình địa chỉ/API TronGrid |
| QR trong bot | Đã có | Telegram lỗi mạng sẽ retry |
| Giao hàng tự động | Đã có | TEXT/STOCK_LINES/FILE |
| Delivery recovery | Đã có | Chặn retry lỗi vĩnh viễn |
| Thông báo channel | Đã có | Đã có ẩn tên khách |
| Thông báo user | Đã có | Có bật/tắt/tắt 24h |
| Icon custom emoji | Đã có | Có nút kiểm tra |
| Reseller API | Đã có | Cần test theo từng endpoint khi dùng thật |
| Backup/export | Đã có | Cần kiểm tra đường dẫn VPS |
| Test tự động | Đã có | Chạy bằng `npm test` |

