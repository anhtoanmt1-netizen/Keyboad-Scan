# Scan Keyboard

Bàn phím Android thử nghiệm có nút mở camera để quét QR và mã vạch, sau đó gửi nội dung vào ô nhập liệu đang được chọn.

## Yêu cầu

- Android Studio
- JDK 17 (Android Studio thường cung cấp sẵn JBR)
- Điện thoại Android 6.0 trở lên
- Camera
- Android 15 / API 35 SDK được cài trong SDK Manager

## Mở dự án

1. Tải repository về máy hoặc chọn **Code > Download ZIP** trên GitHub.
2. Giải nén.
3. Mở Android Studio > Open > chọn thư mục `ScanKeyboard`.
4. Chờ Gradle Sync hoàn tất.
5. Kết nối điện thoại, bật Developer options và USB debugging.
6. Nhấn Run để cài ứng dụng.

## Bật bàn phím

1. Mở ứng dụng Scan Keyboard trên điện thoại.
2. Nhấn **Bật Scan Keyboard**.
3. Trong cài đặt Android, bật Scan Keyboard.
4. Quay lại ứng dụng, nhấn **Chọn Scan Keyboard**.
5. Chọn Scan Keyboard trong danh sách.
6. Mở Chrome, chạm vào ô nhập mã hàng hóa.
7. Nhấn nút **QUÉT MÃ** trên bàn phím.
8. Cấp quyền camera khi được hỏi.

## Cách hoạt động

- CameraX hiển thị camera sau.
- ML Kit nhận diện QR và các định dạng barcode phổ biến.
- Khi nhận được mã, ứng dụng gọi `InputConnection.commitText()`.
- Sau đó gửi phím Enter xuống ô nhập hiện tại.
- Camera tiếp tục chạy để quét mã tiếp theo.

## Lưu ý quan trọng khi thử nghiệm

Đây là bản MVP để kiểm tra luồng IME + camera trên thiết bị thực tế. Android hoặc một số ứng dụng có thể thay đổi/hủy InputConnection khi Activity camera mở lên. Nếu website không nhận mã sau khi camera mở, cần chuyển sang kiến trúc scanner dạng cửa sổ/luồng hiển thị tương thích IME hoặc một cơ chế bàn phím giữ kết nối editor. Không thể đảm bảo Enter sẽ kích hoạt đúng logic của mọi website.

Một số trang web có thể yêu cầu Enter dạng editor action thay vì raw key event. Khi kiểm thử, hãy thử trên ô nhập hàng thật và ghi lại hành vi.

## Quyền riêng tư

- Ứng dụng chỉ yêu cầu quyền CAMERA.
- Mã được nhận diện trên thiết bị bằng ML Kit.
- Bản này không gửi mã quét lên máy chủ.
- Không nhập mật khẩu hoặc thông tin nhạy cảm vào ứng dụng thử nghiệm.

## Cấu trúc

- `MainActivity.kt`: hướng dẫn bật và chọn bàn phím.
- `ScanKeyboardService.kt`: Android IME, nút quét và gửi mã.
- `ScannerActivity.kt`: CameraX + ML Kit.
- `res/xml/method.xml`: khai báo input method.
- `AndroidManifest.xml`: khai báo quyền và service.
