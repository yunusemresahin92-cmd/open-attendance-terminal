# Kurulum — Açık Personel Takip Terminali

[English installation guide](docs/en/INSTALLATION.md)

## 1. Gereksinimler

- Node.js 24.12 veya üstü
- npm
- Firebase projesi
- Firestore Database
- Email/Password Authentication
- Kural testleri için Java 21
- Windows paketi oluşturmak için Windows x64

## 2. Yerel deneme ortamı

```bash
npm install
npm run deneme
```

Bu komut Firebase Authentication ve Firestore emülatörlerini başlatır, sahte personel/kart verilerini yükler ve uygulamayı `http://127.0.0.1:5174` üzerinde açar. Canlı Firebase projesine bağlanmaz.

Emülatör hesabı:

- E-posta: `demo@example.local`
- Şifre: `deneme123`

Bu bilgiler gerçek sistemde kullanılmamalıdır.

## 3. Kendi Firebase projenizi hazırlama

1. Firebase Console'da yeni bir proje oluşturun.
2. **Authentication → Sign-in method** altında Email/Password sağlayıcısını etkinleştirin.
3. Firestore Database oluşturun.
4. Firebase projesine bir Web App ekleyin.
5. `.env.example` dosyasını `.env.local` olarak kopyalayın.
6. Web App yapılandırmasını `.env.local` içindeki `VITE_FIREBASE_*` alanlarına girin.

`.env.local`, service-account JSON ve özel anahtarlar Git'e eklenmemelidir.

## 4. Test

```bash
npm test
npm run build
npm run test:rules
```

## 5. Firestore kurallarını ve web uygulamasını yayımlama

PowerShell:

```powershell
$env:FIREBASE_PROJECT_ID="kendi-proje-kimliginiz"
npx firebase-tools@15.35.0 login
npm run firebase:rules
npm run firebase:deploy
```

Git Bash:

```bash
export FIREBASE_PROJECT_ID='kendi-proje-kimliginiz'
npx firebase-tools@15.35.0 login
npm run firebase:rules
npm run firebase:deploy
```

## 6. İlk admin hesabı

1. Uygulamada **Hesap Oluştur** ile ilk kullanıcıyı kaydedin.
2. Firebase Console → Authentication → Users bölümünden UID değerini alın.
3. Firestore'daki `users/{UID}` belgesinde `admin` alanını boolean `true` yapın.
4. Bundan sonraki kullanıcı yetkilerini uygulamanın Admin sayfasından yönetin.

Kullanıcı arayüzündeki kontroller tek başına güvenlik sınırı değildir. Yetkiler `firestore.rules` tarafından uygulanır.

## 7. Masaüstü geliştirme ve paketleme

```bash
npm run desktop
npm run dist:win
```

Windows kurulum paketi `release/` klasörüne oluşturulur.

## 8. ESP32 RFID terminali

Donanım bağlantıları, USB protokolü, Wi-Fi kurulumu ve çevrimdışı kuyruk davranışı:

[`firmware/kart-okuyucu/KURULUM.md`](firmware/kart-okuyucu/KURULUM.md)

Buzzer isteğe bağlıdır. Aktif buzzer doğrudan ESP32 pininden sürülmemeli; transistör, dirençler ve ters paralel diyot kullanılmalıdır.

## 9. Üretim güvenliği

- Gerçek personel verisini örnek veya issue içine eklemeyin.
- Cihaz için yalnız **Kart Okutma** yetkisine sahip ayrı Firebase hesabı kullanın.
- API anahtarını gerekli Firebase API'leriyle sınırlandırın.
- Firebase Admin SDK kimlik bilgilerini uygulama veya firmware içine koymayın.
- Wi-Fi ve cihaz şifrelerini seri çıktı, ekran görüntüsü veya loglarda paylaşmayın.
