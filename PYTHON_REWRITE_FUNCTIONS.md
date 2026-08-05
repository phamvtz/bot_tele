# Tài liệu chức năng viết lại hệ thống từ Node.js sang Python

Cập nhật: 21/07/2026

Mục tiêu tài liệu này là mô tả đầy đủ chức năng cần giữ lại khi viết lại Telegram Shop Bot từ Node.js sang Python. Tài liệu này dùng để bàn giao cho dev Python hoặc làm checklist khi rewrite.

## 1. Mục tiêu rewrite

Viết lại toàn bộ hệ thống hiện tại từ Node.js sang Python nhưng giữ nguyên trải nghiệm người dùng và nghiệp vụ đang có.

Yêu cầu chính:

- Bot Telegram vẫn hoạt động đầy đủ.
- Web admin vẫn có đầy đủ chức năng quản lý.
- Thanh toán VND, VietQR, ví nội bộ, USDT BEP20/TRC20 vẫn tự động.
- QR thanh toán vẫn tạo trong bot.
- Đa ngôn ngữ vẫn hỗ trợ Việt, Anh, Trung.
- Thông báo channel vẫn ẩn danh người mua.
- Giao hàng tự động vẫn ổn định.
- Dữ liệu cũ cần được giữ hoặc migrate an toàn.
- Cấu hình `.env` cần rõ ràng, dễ deploy lên VPS.

## 2. Stack Python đề xuất

Backend API:

- Python 3.11 hoặc 3.12.
- FastAPI cho HTTP API và web admin backend.
- Uvicorn/Gunicorn để chạy production.
- Pydantic Settings để đọc `.env`.
- SQLAlchemy 2.x hoặc Tortoise ORM.
- Alembic để migration nếu dùng PostgreSQL.

Telegram bot:

- Aiogram 3.x là lựa chọn nên dùng.
- Hỗ trợ polling và webhook.
- Có middleware cho rate limit, i18n, auth admin.
- Có FSM/state cho các bước nhập tiền, nhập số lượng, chọn phương thức.

Database:

- PostgreSQL nếu muốn chuẩn, dễ migration.
- MongoDB nếu muốn giữ kiểu dữ liệu hiện tại.
- Nếu đang có data Mongo, cần viết script migrate hoặc giữ adapter tương thích.

Task nền:

- APScheduler cho polling định kỳ đơn giản.
- Celery + Redis nếu cần queue mạnh hơn.
- Các task cần có: bank polling, crypto polling, delivery recovery, order expiration, backup.

Frontend admin:

- Có thể giữ React admin hiện tại và chỉ đổi API backend sang Python.
- Hoặc viết lại admin bằng Next.js/React sau.
- Giai đoạn rewrite nên giữ React để giảm rủi ro.

QR:

- `qrcode` hoặc `segno` để tạo QR.
- Gửi QR qua Telegram dạng photo/file.

HTTP client:

- `httpx` async cho Telegram, bank API, BscScan, TronGrid, tỷ giá.

## 3. Kiến trúc thư mục Python đề xuất

```text
app/
  main.py                     # Khởi động FastAPI
  config.py                   # Đọc .env
  database.py                 # Kết nối DB
  models/                     # ORM models
  schemas/                    # Pydantic schemas
  api/                        # API routes
    admin/
    shop.py
    webhook.py
  bot/
    main.py                   # Khởi tạo bot
    handlers/
    keyboards/
    messages/
    middlewares/
    states.py
  services/
    wallet.py
    orders.py
    products.py
    categories.py
    delivery.py
    bank_poller.py
    crypto_poller.py
    notifications.py
    referral.py
    vip.py
    coupons.py
    inventory.py
    icons.py
    exchange_rate.py
    backup.py
  payments/
    vietqr.py
    crypto.py
    bank_history.py
  tasks/
    scheduler.py
  utils/
    money.py
    order_code.py
    telegram_links.py
    privacy.py
    retry.py
tests/
alembic/
public/
admin-react/
```

## 4. Chức năng bot cần viết lại

Bot phải có đủ các chức năng:

- `/start`.
- Chọn ngôn ngữ ngay lần đầu.
- Lưu ngôn ngữ theo user.
- Kiểm tra tham gia nhóm/kênh bắt buộc.
- Menu chính sau khi đủ điều kiện.
- Mua hàng.
- Xem sản phẩm.
- Xem danh mục.
- Xem chi tiết sản phẩm.
- Chọn số lượng.
- Áp mã giảm giá.
- Chọn phương thức thanh toán.
- Nạp ví.
- Xem ví.
- Xem lịch sử ví.
- Xem đơn hàng.
- Xem tài khoản.
- Xem thông tin referral.
- Hỗ trợ.
- API/reseller nếu user có quyền.
- Admin panel shortcut cho admin.
- Ẩn menu.
- Đổi ngôn ngữ.

## 5. Luồng mở bot bắt buộc giữ nguyên

Luồng chuẩn:

1. Khách bấm `/start`.
2. Bot tạo hoặc cập nhật user.
3. Bot kiểm tra user đã chọn ngôn ngữ chưa.
4. Nếu chưa, hiện màn hình chọn ngôn ngữ.
5. Sau khi chọn ngôn ngữ, bot lưu vào database.
6. Bot kiểm tra điều kiện tham gia nhóm.
7. Nếu chưa tham gia, hiện hướng dẫn theo ngôn ngữ đã chọn.
8. Khách tham gia nhóm.
9. Khách bấm kiểm tra hoặc `/start`.
10. Bot xác nhận đã tham gia.
11. Bot mở menu chính.

Yêu cầu:

- Không được đưa khách vào menu trước khi chọn ngôn ngữ.
- Thông báo bắt buộc tham gia nhóm phải theo ngôn ngữ khách đã chọn.
- Nếu bot không có quyền kiểm tra nhóm, xử lý theo cấu hình fail-open/fail-close.

## 6. Đa ngôn ngữ

Ngôn ngữ cần hỗ trợ:

- `vi`: Tiếng Việt.
- `en`: English.
- `zh`: 中文.

Phần cần dịch:

- Menu chính.
- Nút chức năng.
- Mua hàng.
- Danh mục.
- Sản phẩm.
- Giỏ/đơn.
- Ví.
- Nạp tiền.
- Thanh toán.
- VietQR.
- USDT BEP20/TRC20.
- QR.
- Lỗi thanh toán.
- Lỗi giao hàng.
- Thành công/thất bại.
- Hướng dẫn tham gia nhóm.
- Tài khoản.
- Referral.
- Hỗ trợ.
- Thông báo mute 1 ngày.

Yêu cầu kỹ thuật:

- Dùng key i18n, không hardcode text trong handler.
- Nếu thiếu bản dịch, fallback về tiếng Việt.
- Message có biến động như `{amount}`, `{product_name}`, `{order_code}` phải render đúng.

## 7. Menu và icon Telegram

Chức năng cần có:

- Menu chính dạng reply keyboard.
- Menu phụ dạng inline keyboard.
- Cấu hình icon menu từ admin.
- Hỗ trợ emoji thường.
- Hỗ trợ Telegram custom emoji ID.
- Kiểm tra custom emoji ID bằng Telegram API.
- Preview icon trên admin.
- Bot tự load icon mới sau khi admin lưu.

Các icon cần cấu hình:

- Mua hàng.
- Ví.
- Đơn hàng.
- Tài khoản.
- Sản phẩm.
- Hỗ trợ.
- Giới thiệu.
- API.
- Ẩn menu.
- Admin panel.
- Menu.
- Danh mục.
- Quay lại.
- Nạp tiền.
- Thanh toán ngân hàng.
- Thanh toán USDT.
- Kiểm tra thanh toán.
- Hủy.
- Ngôn ngữ.
- Các icon danh mục/sản phẩm.

## 8. Danh mục

Chức năng:

- Tạo danh mục.
- Sửa danh mục.
- Ẩn/hiện danh mục.
- Xóa mềm danh mục.
- Sắp xếp danh mục.
- Gắn icon emoji.
- Gắn custom emoji ID.
- Gắn mô tả.
- Gắn ảnh nếu cần.
- Đếm số sản phẩm đang bán.
- Hiển thị danh mục trên bot theo thứ tự.
- Cache danh mục để bot nhanh.

## 9. Sản phẩm

Chức năng:

- Tạo sản phẩm.
- Sửa sản phẩm.
- Ẩn/hiện sản phẩm.
- Tự tạo mã sản phẩm.
- Mã sản phẩm không trùng.
- Tên sản phẩm.
- Mô tả sản phẩm.
- Ghi chú nội bộ/ghi chú giao hàng.
- Giá bán.
- Giá vốn.
- Tiền tệ.
- Danh mục.
- Delivery mode.
- Payload giao hàng.
- Ảnh Telegram file ID.
- Ảnh URL.
- Icon emoji.
- Custom emoji ID.
- Min quantity.
- Max quantity.
- Số bán ảo.
- Ngưỡng cảnh báo tồn kho.
- Tự tắt khi hết hàng.
- Tự ẩn khi hết hàng.
- Tìm kiếm sản phẩm.
- Lọc theo danh mục.
- Lọc theo trạng thái.
- Lọc theo delivery mode.
- Sắp xếp theo tên, giá, ngày tạo.

## 10. Kho hàng

Chức năng:

- Nhập stock từng dòng.
- Nhập nhiều dòng.
- Nhập từ file.
- Gắn stock vào sản phẩm.
- Xem tồn chưa bán.
- Xem stock đã bán.
- Đánh dấu stock đã bán khi giao hàng.
- Không cấp trùng stock.
- Tự bật lại sản phẩm khi nhập thêm hàng nếu cấu hình.
- Cảnh báo tồn thấp.
- Tự tắt/ẩn sản phẩm khi hết hàng.

## 11. Delivery mode

Python rewrite cần giữ 3 kiểu giao hàng:

`STOCK_LINES`:

- Lấy đúng số dòng stock chưa bán.
- Lock/transaction để tránh cấp trùng.
- Đánh dấu `is_sold=true`.
- Gắn `order_id`.
- Lưu `sold_at`.
- Gửi nội dung cho khách.

`TEXT`:

- Gửi payload text cố định.
- Phù hợp key chung, hướng dẫn, link.

`FILE`:

- Gửi file theo payload.
- Retry khi Telegram lỗi mạng.
- Ghi lỗi nếu file không gửi được.
- Không làm bot crash.

## 12. Đơn hàng

Model order cần có:

- ID database.
- Mã đơn ngắn hiển thị.
- Telegram user ID.
- Chat ID.
- Product ID.
- Quantity.
- Amount gốc.
- Discount.
- Final amount.
- Currency.
- Display currency.
- Display USD.
- Payment method.
- Payment reference.
- Crypto network.
- Crypto amount.
- Crypto address.
- Crypto token.
- Crypto USD/VND rate.
- Delivery reference.
- Delivery content.
- Delivery error.
- Delivery retry blocked at.
- Cancel reason.
- Created at.
- Updated at.

Trạng thái:

- `PENDING`.
- `PAID`.
- `DELIVERED`.
- `CANCELED`.

Yêu cầu:

- Bot và admin phải hiển thị cùng một mã đơn ngắn.
- ID database chỉ dùng cho kỹ thuật.
- Đơn hết hạn phải tự hủy.
- Đơn đã thanh toán không được hủy tự động.
- Đơn giao lỗi giữ `PAID` để retry.

## 13. Mua hàng bằng ví

Luồng:

1. Khách chọn sản phẩm.
2. Khách chọn số lượng.
3. Hệ thống tính giá.
4. Hệ thống áp VIP/coupon/quantity discount.
5. Tạo order `PENDING`.
6. Khách chọn ví.
7. Kiểm tra số dư.
8. Nếu đủ, trừ ví.
9. Tạo transaction `PURCHASE`.
10. Order chuyển `PAID`.
11. Giao hàng.
12. Order chuyển `DELIVERED`.

Yêu cầu:

- Trừ ví và cập nhật order phải atomic.
- Không được trừ ví hai lần.
- Nếu giao hàng lỗi, không hoàn tự động nếu chưa có logic riêng.
- Admin có thể giao lại hoặc hoàn tiền.

## 14. Nạp ví VND bằng VietQR

Chức năng:

- Khách chọn nạp ví.
- Chọn ngân hàng/VietQR.
- Nhập số tiền VND.
- Kiểm tra số tiền tối thiểu.
- Tạo lệnh nạp.
- Tạo nội dung chuyển khoản riêng.
- Tạo QR VietQR.
- Gửi QR trong bot.
- Bank poller tự xác nhận.
- Cộng ví.
- Tạo transaction `DEPOSIT`.
- Thông báo khách.

Yêu cầu:

- Không cộng ví trùng.
- Nội dung chuyển khoản phải đủ unique.
- Nếu khách chuyển sai, admin đối soát thủ công.

## 15. Thanh toán đơn VND bằng VietQR

Chức năng:

- Khách có thể thanh toán đơn bằng QR ngân hàng trực tiếp.
- Không cần nạp ví trước.
- QR phải có đúng số tiền.
- Nội dung chuyển khoản phải chứa mã đơn/reference.
- Bank poller xác nhận.
- Order chuyển `PAID`.
- Giao hàng tự động.

Yêu cầu:

- Đơn QR có thời hạn.
- Quá hạn thì hủy.
- Nếu tiền đến sau khi đơn hết hạn, admin xử lý thủ công.

## 16. Nạp ví bằng USDT BEP20/TRC20

Chức năng:

- Khách chọn nạp USDT.
- Chọn mạng BEP20 hoặc TRC20.
- Nhập số USD/USDT muốn nạp.
- Bot hiển thị số USDT cần chuyển.
- Bot hiển thị quy đổi theo ngôn ngữ.
- Bot hiển thị địa chỉ ví nhận.
- Bot tạo QR USDT.
- Bot gửi QR trong Telegram.
- Crypto poller kiểm tra blockchain.
- Nếu nhận đúng, cộng ví.
- Tạo transaction `DEPOSIT`.

Yêu cầu:

- BEP20 dùng BNB Smart Chain.
- TRC20 dùng Tron.
- Chỉ nhận USDT.
- Không nhận nhầm BNB/TRX/native coin.
- Không nhận nhầm network.
- Không xử lý trùng hash.
- Có thời hạn lệnh nạp.

## 17. Thanh toán đơn bằng USDT

Chức năng:

- Khách mua sản phẩm bằng USD/USDT.
- Bot tạo order `PENDING`.
- Bot tính số USDT cần chuyển.
- Bot tạo QR theo network.
- Crypto poller xác nhận giao dịch.
- Order chuyển `PAID`.
- Giao hàng tự động.

Yêu cầu:

- Số USDT cần chuyển phải rõ.
- Địa chỉ ví phải đúng network.
- Nếu chuyển từ Binance, khách phải chọn đúng mạng.
- Có nút kiểm tra đã chuyển.
- Có thông báo hết hạn.

## 18. Tỷ giá USD/USDT

Chức năng:

- USD/USDT là tiền chính.
- Tự cập nhật tỷ giá USDT/VND.
- Có fallback rate trong `.env`.
- Có chu kỳ update.
- Có CNY rate để hiển thị tương đương cho khách Trung.

Yêu cầu hiển thị:

- Tiếng Việt: `1 USDT tương đương khoảng xx.xxxđ`.
- English: `1 USDT is approximately xx,xxx VND`.
- 中文: hiển thị USD chính và CNY/VND tham khảo.

Python service cần có:

- `exchange_rate.py`.
- Cache rate.
- Fallback khi API lỗi.
- Log khi cập nhật rate.

## 19. QR thanh toán

Chức năng:

- Tạo QR VietQR.
- Tạo QR USDT BEP20.
- Tạo QR USDT TRC20.
- Gửi QR dạng photo.
- Nếu gửi photo lỗi, gửi document/file.
- Retry khi Telegram lỗi tạm.
- Caption QR phải đúng ngôn ngữ.

Yêu cầu:

- QR phải mở được trên Telegram.
- Caption nêu rõ mạng, số tiền, địa chỉ, thời hạn.
- QR không được bị thiếu ở màn thanh toán.

## 20. Bank polling

Chức năng:

- Chạy định kỳ.
- Gọi API lịch sử MB Bank.
- Timeout rõ ràng.
- Không làm crash app khi API lỗi.
- Match nạp ví.
- Match thanh toán đơn.
- Chống xử lý trùng giao dịch.
- Log lỗi.
- Hủy order/lệnh nạp hết hạn.

Python implementation:

- Dùng task scheduler.
- Dùng `httpx.AsyncClient`.
- Dùng lock để tránh chạy 2 poller cùng lúc.
- Lưu processed transaction reference.

## 21. Crypto polling

Chức năng:

- Chạy định kỳ.
- Kiểm tra BEP20 qua BscScan.
- Kiểm tra TRC20 qua TronGrid.
- Chỉ bật network có cấu hình.
- Match địa chỉ nhận.
- Match token USDT.
- Match số lượng.
- Chống xử lý trùng hash.
- Xác nhận nạp ví.
- Xác nhận thanh toán đơn.
- Hủy lệnh hết hạn.

Python implementation:

- `services/crypto_poller.py`.
- `payments/crypto.py`.
- Có parser riêng cho BEP20.
- Có parser riêng cho TRC20.
- Có decimal chính xác, không dùng float cho tiền nếu có thể.

## 22. Ví nội bộ

Chức năng:

- Tạo ví cho user.
- Xem số dư.
- Cộng tiền.
- Trừ tiền.
- Nạp VND.
- Nạp USDT.
- Mua hàng bằng ví.
- Hoàn tiền.
- Thu hồi tiền đã hoàn.
- Lịch sử giao dịch.

Yêu cầu kỹ thuật:

- Dùng transaction DB khi thay đổi số dư.
- Không cho số dư âm trừ khi admin cố tình cho phép.
- Mỗi giao dịch phải có reference/mô tả.
- Thu hồi hoàn tiền phải chống trùng.

## 23. Hoàn tiền và thu hồi hoàn tiền

Chức năng hoàn tiền:

- Admin chọn đơn.
- Hệ thống xác định user và số tiền.
- Cộng tiền về ví.
- Tạo transaction `REFUND`.
- Ghi audit log.

Chức năng thu hồi:

- Admin chọn giao dịch refund.
- Hệ thống kiểm tra refund chưa bị thu hồi.
- Trừ lại ví user.
- Tạo transaction `REFUND_REVERSAL`.
- Ghi reference tới refund gốc.
- Ghi audit log.

Yêu cầu:

- Không thu hồi hai lần.
- Nếu ví không đủ tiền, báo lỗi rõ.
- Admin thấy trạng thái đã thu hồi.

## 24. Giao hàng tự động

Chức năng:

- Giao sau khi order `PAID`.
- Hỗ trợ `TEXT`.
- Hỗ trợ `STOCK_LINES`.
- Hỗ trợ `FILE`.
- Retry khi Telegram lỗi mạng.
- Ghi lỗi vào order.
- Nếu thành công, order `DELIVERED`.
- Nếu lỗi tạm, order giữ `PAID`.

Python implementation:

- Service `delivery.py`.
- Hàm `deliver_order(order_id)`.
- Retry helper dùng exponential backoff.
- Detect lỗi vĩnh viễn Telegram.

## 25. Delivery recovery

Chức năng:

- Chạy định kỳ.
- Tìm order `PAID` chưa giao.
- Thử giao lại theo batch.
- Có backoff.
- Có max age.
- Chặn retry tự động nếu lỗi vĩnh viễn.

Lỗi vĩnh viễn:

- `chat not found`.
- `bot was blocked by the user`.
- Chat ID không hợp lệ.

## 26. Thông báo đơn

Chức năng:

- Thông báo lên channel.
- Thông báo trong bot nếu cấu hình.
- Bật/tắt thông báo channel.
- Bật/tắt thông báo bot.
- User có thể tắt thông báo 1 ngày.
- Admin chỉnh thông báo từng user.
- Tên khách phải được ẩn.
- Link mua hàng phải vào đúng sản phẩm.

Yêu cầu:

- Không lộ username đầy đủ.
- Không lộ Telegram ID.
- Mask tên như `ngu***`.
- Nếu user không có tên, dùng tên mặc định đã ẩn.

## 27. VIP

Chức năng:

- Cấu hình cấp VIP.
- Tên cấp.
- Mức chi tiêu tối thiểu.
- Phần trăm giảm giá.
- Bonus referral.
- Quyền lợi.
- Tự nâng VIP theo tổng chi tiêu.
- Áp giá VIP khi mua.

## 28. Referral

Chức năng:

- Mỗi user có mã giới thiệu.
- Gắn user mới vào người giới thiệu.
- Tính hoa hồng khi đơn thành công.
- Lưu trạng thái hoa hồng.
- Admin xem dữ liệu referral.

## 29. Coupon

Chức năng:

- Tạo coupon.
- Sửa coupon.
- Bật/tắt coupon.
- Giảm theo phần trăm.
- Giảm theo số tiền.
- Giới hạn số lần dùng.
- Giới hạn đơn tối thiểu.
- Giới hạn giảm tối đa.
- Coupon chỉ cho VIP.
- Hết hạn theo ngày.
- Đếm lượt dùng.

## 30. Giảm giá số lượng

Chức năng:

- Tạo rule giảm giá theo số lượng.
- Áp dụng khi mua nhiều.
- Quản lý trong admin.
- Kết hợp với VIP/coupon theo thứ tự rõ ràng.

## 31. Web admin cần giữ

Các trang cần có:

- Đăng nhập.
- Dashboard.
- Đơn hàng.
- Giao dịch/Nạp tiền.
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
- Lịch sử gửi tin.
- Cài đặt chung.
- Thanh toán.
- Theo dõi ngân hàng.
- SePay Debug.
- Database viewer.
- Icon settings.

## 32. Dashboard admin

Dashboard cần hiển thị:

- Doanh thu hôm nay.
- Số đơn hôm nay.
- User mới hôm nay.
- Sản phẩm đang bán.
- Tổng user.
- Doanh thu toàn thời gian.
- Số đơn toàn thời gian.
- Đơn đang chờ.
- Doanh thu 30 ngày.
- Biểu đồ doanh thu.
- Top sản phẩm bán chạy.
- Cảnh báo tồn kho thấp.
- Đơn gần đây.
- Trạng thái bot.

## 33. Quản lý đơn admin

Chức năng:

- Danh sách đơn.
- Lọc trạng thái.
- Lọc ngày.
- Tìm mã đơn.
- Xem user.
- Xem sản phẩm.
- Xem số lượng.
- Xem tổng tiền.
- Xem phương thức thanh toán.
- Xem trạng thái giao hàng.
- Xem lỗi giao hàng.
- Giao lại.
- Hủy đơn.
- Hoàn tiền.
- Xem mã đơn ngắn và ID nội bộ.

## 34. Quản lý giao dịch admin

Chức năng:

- Xem giao dịch ví.
- Lọc loại giao dịch.
- Lọc ngày.
- Xem user.
- Xem số tiền.
- Xem mô tả.
- Xem reference.
- Thu hồi tiền đã hoàn.
- Chống thu hồi trùng.

## 35. Quản lý user admin

Chức năng:

- Danh sách user.
- Tìm user.
- Xem chi tiết.
- Xem số dư.
- Xem tổng chi tiêu.
- Xem VIP.
- Xem ngôn ngữ.
- Xem trạng thái thông báo.
- Cộng tiền.
- Trừ tiền.
- Khóa/mở user nếu có.
- Bật thông báo đơn.
- Tắt thông báo đơn.
- Tắt thông báo 24h.

## 36. Cấu hình thanh toán admin

Chức năng:

- Bật/tắt VietQR.
- Cấu hình bank.
- Bật/tắt USDT.
- Bật/tắt crypto poller.
- Cấu hình BEP20 address.
- Cấu hình TRC20 address.
- Cấu hình BscScan API key.
- Cấu hình TronGrid API key.
- Cấu hình thời hạn lệnh thanh toán.
- Cấu hình tỷ giá fallback.
- Cấu hình auto update rate.
- Test trạng thái cấu hình.

## 37. Cấu hình thông báo admin

Chức năng:

- Bật/tắt thông báo channel.
- Bật/tắt thông báo bot.
- Cấu hình channel nhận thông báo.
- Cấu hình template thông báo nếu cần.
- Cấu hình ẩn tên khách.
- Cấu hình link sản phẩm.

## 38. Cấu hình icon admin

Chức năng:

- Danh sách tất cả icon menu.
- Input emoji/custom emoji ID.
- Preview.
- Nút kiểm tra icon.
- Kết quả icon hợp lệ/lỗi.
- Lưu tất cả.
- Reset về mặc định nếu cần.

## 39. Broadcast

Chức năng:

- Gửi tin hàng loạt.
- Gửi theo nhóm user nếu có lọc.
- Gửi VIP.
- Hẹn giờ gửi.
- Lịch sử gửi.
- Số gửi thành công.
- Số gửi lỗi.
- Log user lỗi.

## 40. Reseller/API

Chức năng:

- Tạo API key.
- Sửa key.
- Tắt key.
- Xem danh sách key.
- Xem đơn reseller.
- Tài liệu API.
- Endpoint lấy catalog.
- Endpoint tạo đơn.
- Endpoint kiểm tra đơn nếu có.
- Rate limit API.
- Log request nếu cần.

## 41. Web storefront

Chức năng:

- Hiển thị shop public.
- Load catalog từ API Python.
- Hiển thị danh mục.
- Hiển thị sản phẩm.
- Link mở bot.
- Deep link đúng sản phẩm.
- Responsive mobile.

## 42. API backend cần có

Nhóm public:

- `GET /health`.
- `GET /api/shop/catalog`.
- `GET /shop`.
- `POST /webhook/ipn`.
- `POST /telegram/webhook` nếu dùng webhook.

Nhóm admin:

- Auth/login.
- Dashboard stats.
- Products CRUD.
- Categories CRUD.
- Stock import/list.
- Orders list/detail/actions.
- Users list/detail/actions.
- Wallet transactions.
- Refund reversal.
- Coupons CRUD.
- Quantity discounts CRUD.
- Broadcast.
- Scheduled broadcast.
- Payment settings.
- Bank monitor.
- Crypto settings.
- Icon settings.
- Icon check.
- Seller API keys.
- Database viewer.
- Export CSV.
- Audit logs.

## 43. Database models cần có

Models tối thiểu:

- User.
- Category.
- Product.
- StockItem.
- Order.
- Wallet.
- WalletTransaction.
- Coupon.
- Referral.
- VipLevel.
- Setting.
- AuditLog.
- BackupLog.
- Broadcast.
- ScheduledBroadcast.
- Complaint.
- SellerApiKey.
- ResellerOrder nếu tách riêng.
- ProcessedPayment hoặc PaymentEvent để chống xử lý trùng.

## 44. Migration dữ liệu từ Node.js sang Python

Cần kiểm tra hệ thống hiện tại đang dùng DB nào thật:

- Nếu MongoDB: viết script đọc collection cũ và map sang model Python.
- Nếu PostgreSQL: giữ schema hoặc tạo migration Alembic tương thích.
- Nếu đang dùng adapter giả lập Prisma trên Mongo, cần đọc kỹ `src/lib/prisma.js`.

Dữ liệu cần giữ:

- User.
- Số dư ví.
- Lịch sử ví.
- Sản phẩm.
- Danh mục.
- Stock chưa bán.
- Stock đã bán.
- Đơn hàng.
- Coupon.
- VIP.
- Referral.
- Settings.
- Icon custom emoji.
- Audit log nếu cần.

Nguyên tắc migrate:

- Backup trước khi migrate.
- Chạy migrate thử trên database copy.
- So sánh số lượng record trước/sau.
- So sánh tổng số dư ví.
- So sánh số đơn delivered/paid/pending.
- Không xóa data cũ trước khi production chạy ổn.

## 45. Bảo mật

Yêu cầu:

- Không hardcode token.
- Không log token đầy đủ.
- Admin API cần auth.
- Password admin cần hash nếu viết mới.
- API reseller cần key riêng.
- IPN cần secret.
- Rate limit endpoint nhạy cảm.
- Validate input bằng Pydantic.
- Không cho user thường gọi API admin.
- Không lộ Telegram ID trên channel công khai.

## 46. Logging

Log cần có:

- Server started.
- Bot started.
- DB connected.
- Bank polling started.
- Crypto polling started.
- Exchange rate updated.
- Payment matched.
- Order delivered.
- Delivery failed.
- Recovery retry.
- Recovery blocked.
- Admin action.
- Broadcast result.

Yêu cầu:

- Redact token.
- Log đủ order code để tra cứu.
- Log lỗi payment không được làm crash process.

## 47. Test bắt buộc khi rewrite

Unit test:

- Format tiền.
- Mã đơn.
- Mask tên khách.
- Deep link sản phẩm.
- Icon custom emoji ID.
- Tính tiền USD/VND.
- Tính coupon.
- Tính VIP.
- Tính quantity discount.
- Thu hồi hoàn tiền.
- Chống xử lý trùng payment.

Integration test:

- Tạo user.
- Tạo order.
- Mua bằng ví.
- Nạp VND.
- Nạp USDT.
- Giao `TEXT`.
- Giao `STOCK_LINES`.
- Giao `FILE`.
- Delivery recovery.
- Admin refund.
- Admin refund reversal.

Manual test:

- Bot `/start`.
- 3 ngôn ngữ.
- Nhóm bắt buộc.
- QR ngân hàng.
- QR USDT.
- Channel notification.
- User mute 24h.
- Icon check.
- Web admin full flow.

## 48. Cấu hình `.env` Python đề xuất

```env
APP_ENV=production
PORT=3001

BOT_TOKEN=
ADMIN_IDS=
BOT_MODE=polling
WEBHOOK_ENABLED=false
WEBHOOK_URL=

DATABASE_URL=
MONGODB_URI=
MONGODB_DB=

ADMIN_SECRET=
ADMIN_USERNAME=
ADMIN_PASSWORD_HASH=

REQUIRE_GROUP_JOIN=true
REQUIRED_GROUP=
REQUIRED_GROUP_URL=
GROUP_GATE_FAILOPEN=false
GROUP_GATE_ADMIN_BYPASS=false

ORDER_NOTIFY_CHANNEL=
ORDER_NOTIFY_CHANNEL_ENABLED=true
ORDER_NOTIFY_BOT_ENABLED=true
SUPPORT_CHANNEL_URL=

BANK_ENABLED=true
BANK_CODE=MB
BANK_NAME=
BANK_ACCOUNT=
BANK_ACCOUNT_NAME=
MBBANK_API_TOKEN=
MBBANK_HISTORY_BASE=

CRYPTO_PAY_ENABLED=true
CRYPTO_POLL_ENABLED=true
CRYPTO_POLL_INTERVAL_SECONDS=15
CRYPTO_EXPIRE_MINUTES=20
BEP20_USDT_ADDRESS=
TRC20_USDT_ADDRESS=
BSCSCAN_API_KEY=
TRONGRID_API_KEY=

CRYPTO_USD_VND_RATE_AUTO=true
CRYPTO_USD_VND_RATE=26500
CRYPTO_USD_VND_RATE_UPDATE_SECONDS=300
CRYPTO_USD_CNY_RATE=7.25

TELEGRAM_SEND_RETRY_ATTEMPTS=6
TELEGRAM_DOCUMENT_RETRY_ATTEMPTS=2
DELIVERY_RECOVERY_INTERVAL_SECONDS=60
DELIVERY_RECOVERY_BATCH_SIZE=10
DELIVERY_RECOVERY_MAX_AGE_HOURS=168

BACKUP_DIR=./backups
MAX_BACKUPS=10
EXPORT_DIR=./exports
```

## 49. Thứ tự rewrite khuyến nghị

Giai đoạn 1: Nền móng

- Dựng FastAPI.
- Dựng DB models.
- Dựng config.
- Dựng auth admin.
- Dựng health check.

Giai đoạn 2: Bot cơ bản

- Start bot.
- User model.
- Chọn ngôn ngữ.
- Nhóm bắt buộc.
- Menu chính.

Giai đoạn 3: Catalog

- Danh mục.
- Sản phẩm.
- Stock.
- Hiển thị sản phẩm trên bot.
- API catalog cho web shop.

Giai đoạn 4: Đơn hàng và ví

- Tạo order.
- Wallet.
- Mua bằng ví.
- Delivery `TEXT`.
- Delivery `STOCK_LINES`.

Giai đoạn 5: Thanh toán VND

- VietQR.
- Bank history.
- Bank poller.
- Nạp ví VND.
- Thanh toán đơn VND.

Giai đoạn 6: Thanh toán USDT

- Tỷ giá.
- QR USDT.
- BEP20 poller.
- TRC20 poller.
- Nạp ví USDT.
- Thanh toán đơn USDT.

Giai đoạn 7: Admin đầy đủ

- Products.
- Categories.
- Orders.
- Transactions.
- Users.
- Refund.
- Refund reversal.
- Payment settings.
- Icons.
- Notifications.

Giai đoạn 8: Recovery và vận hành

- Delivery recovery.
- Backup.
- Export.
- Audit log.
- Broadcast.
- Scheduled broadcast.
- Reseller API.

Giai đoạn 9: Migration và chạy thật

- Migrate data.
- Test staging.
- Chạy song song read-only nếu cần.
- Cutover production.
- Theo dõi log.

## 50. Tiêu chí hoàn thành rewrite

Rewrite chỉ được xem là xong khi:

- Bot chạy ổn định trên VPS.
- Admin web đăng nhập và quản lý được.
- User cũ còn số dư đúng.
- Sản phẩm/danh mục/stock còn đúng.
- Mua bằng ví thành công.
- Nạp VND tự cộng.
- Thanh toán VND tự giao.
- Nạp BEP20 tự cộng.
- Thanh toán BEP20 tự giao.
- QR hiện trong bot.
- 3 ngôn ngữ hoạt động.
- Nhóm bắt buộc hoạt động.
- Channel notification ẩn tên.
- Link sản phẩm chính xác.
- Delivery recovery hoạt động.
- Thu hồi hoàn tiền hoạt động.
- Icon custom emoji kiểm tra và lưu được.
- Test tự động pass.
- Có log đủ để debug.
- Không còn lỗi lặp vô hạn với đơn cũ không giao được.

