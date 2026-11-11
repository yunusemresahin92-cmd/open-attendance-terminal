# Açık Personel Takip Terminali

**Türkçe** · [English](README.md)

**Electron + React**, **Firebase** ve isteğe bağlı **ESP32/RC522 Wi-Fi terminali** kullanan ücretsiz ve açık kaynak personel takip, puantaj ve maaş raporlama projesidir.

> Bu depo şirketten bağımsız temiz bir açık kaynak sürümdür. Canlı veritabanı, gerçek personel kaydı, Wi-Fi şifresi, servis hesabı, özel anahtar veya şirket logosu içermez.

## Özellikler

- Personel ve şirket yönetimi
- Günlük giriş-çıkış ve çalışma saatleri
- Maaş, mesai ve eksik saat hesapları
- XLSX raporları
- Firestore kurallarıyla uygulanan rol tabanlı yetkilendirme
- RFID kart envanteri, kart atama ve değiştirilemez kart geçmişi
- USB kart okuyucu modu
- Bilgisayarsız ESP32 Wi-Fi terminal modu
- Elektrik kesintisine dayanıklı çevrimdışı okutma kuyruğu
- İnternet gelince gecikmiş okutmaların güvenli gönderimi
- Firebase Emulator üzerinde sahte verili deneme ortamı
- Windows masaüstü uygulaması ve kurulabilir web/PWA arayüzü

## Donanım

İsteğe bağlı terminal:

- ESP32 Dev Module
- RC522 RFID okuyucu
- ST7735S 1,8 inç TFT
- DS3231 gerçek zaman saati
- İsteğe bağlı korumalı buzzer sürücü katı

Ayrıntılar: [`KURULUM.md`](KURULUM.md) ve [`firmware/kart-okuyucu/KURULUM.md`](firmware/kart-okuyucu/KURULUM.md).

## Hızlı başlangıç — yerel deneme

Gerekenler: Node.js 24.12+; Firebase Emulator testleri için Java 21.

```bash
npm install
npm run deneme
```

Deneme modu yalnız yerel Firebase emülatörlerine ve tamamen sahte personel/kart verilerine bağlanır. Canlı bir Firebase projesine dokunmaz.

## Kendi Firebase projenizle kullanma

1. `.env.example` dosyasını `.env.local` olarak kopyalayın.
2. Kendi Firebase **Web App** yapılandırmanızı girin.
3. Email/Password Authentication ve Firestore'u etkinleştirin.
4. `firestore.rules` dosyasını kendi projenize yayımlayın.
5. `npm run build` veya `npm run desktop` çalıştırın.

Service account JSON, özel anahtar, gerçek personel verisi veya cihaz şifrelerini repoya koymayın.

## Geliştirme ve test

```bash
npm install
npm test
npm run build
npm run test:rules
npm run dist:win
```

## Projenin durumu

Yazılım ve ESP32 firmware'i gerçek ortamda çalışan bir personel takip terminalinden doğmuş, kapsamlı birim, Firestore kuralı ve akış testleri içermektedir. Açık kaynak sürümü üretim deposundan bağımsız ve temiz bir Git geçmişiyle hazırlanmıştır.

Buzzer isteğe bağlı sonraki montaj aşamasıdır; okuyucunun temel çalışması buzzer olmadan devam eder.

## Güvenlik

[`SECURITY.md`](SECURITY.md) dosyasını okuyun. Firebase Web App kimlikleri özel şifre değildir; gerçek erişim Authentication ve Firestore kurallarıyla denetlenir. Firebase Admin bilgilerini masaüstü uygulamasına veya firmware'e koymayın.

## Lisans

Public masaüstü paketleri bir güncelleme sunucusuna bağlanmaz. Otomatik güncelleme varsayılan olarak kapalıdır; yalnız güvenilir bir sağlayıcıyla paketleme yapıldıktan sonra bakımcı tarafından `OPEN_ATTENDANCE_UPDATES=1` ile etkinleştirilebilir.

GNU GPL v3. Projeyi aynı lisans altında kullanabilir, inceleyebilir, değiştirebilir ve dağıtabilirsiniz. Ayrıntı için [`LICENSE`](LICENSE).

## Proje hikâyesi

Türkçe ve İngilizce proje geçmişi ile video hazırlama dosyaları [`docs/story`](docs/story) altındadır.
