# Kart Okuyucu / Personel Terminali Kurulumu (ESP32 + RC522 + 1.8" TFT)

Aynı cihaz iki işte kullanılır:
- **Kart Atama > Kart Listesi:** kartları toplu kaydetmek.
- **Kart Okutma:** personelin giriş-çıkış saatini kaydetmek. Ekranda personelin adı, GİRİŞ/ÇIKIŞ ve saat görünür.

Yazılım **2.0** ile cihaz iki şekilde çalışır:
- **USB modu** (Wi-Fi kurulmamışsa): eskisi gibi bilgisayara takılı çalışır, kaydı Kart Okutma sayfası yapar.
- **Wi-Fi modu** (Admin sayfasından kurulunca): bilgisayar gerekmez. Cihaz Wi-Fi'ye bağlanır ve giriş-çıkışı kendisi yazar.
  İnternet yoksa okutmaları hafızasında saklar ve bağlantı gelince gönderir. Kurulum için bölüm 7'ye bakın.

Ekransız eski okuyucular (yalnız RC522) da çalışmaya devam eder; ekran mesajlarını görmezden gelirler.

## 1. Gerekenler
- ESP32 geliştirme kartı (ESP32 Dev Module, 30 pin)
- RC522 kart okuyucu modülü (13.56 MHz MIFARE Classic 1K kartlar; 125 kHz kartlar okunmaz)
- 1.8" ST7735S TFT ekran (128×160)
- DS3231 saat modülü + pil (ekrandaki tarih/saat için)
- Aktif buzzer + NPN transistör (BC337/BC547/2N2222/S8050) + 1 kΩ + 10 kΩ + 1N4148 diyot
- **Veri aktarabilen** USB kablosu (bazı kablolar yalnız şarj eder)

## 2. Bağlantı (ESP32 kart yazılarıyla)
| Modül | Bağlantı |
|---|---|
| SPI ortak | D18 = SCK (TFT SCL + RC522 SCK), D23 = MOSI (TFT SDA + RC522 MOSI), D19 = MISO (yalnız RC522) |
| TFT | CS = D33, DC = D26, RST = D32, VDD = 3V3, BLK = 3V3, GND = GND |
| RC522 | SDA (SS) = D25, RST = D27, 3.3V = 3V3, GND = GND, IRQ boş |
| DS3231 | SDA = D21, SCL = D22, VCC = 3V3, GND = GND |
| Buzzer | D16 → 1 kΩ → transistör B; 10 kΩ B–GND; E → GND; C → buzzer (−); buzzer (+) → VIN (5V); diyot buzzer'a ters paralel (çizgili uç +5V) |

> ⚠️ RC522 ve TFT **yalnız 3V3**'e bağlanır; 5V modülü bozar. USB takılıyken 5V adaptörü takmayın.

## 3. Yazılımı yükleme
**Kolay yol:** ESP32'yi USB ile bilgisayara takın ve Hermes'e "ESP32'yi taktım" yazın; yazılım bu bilgisayardan yüklenir.

**Arduino IDE ile kendiniz yüklemek isterseniz:**
1. Arduino IDE'yi kurun (arduino.cc).
2. Dosya > Tercihler > "Ek Kart Yöneticisi URL'leri" alanına şunu ekleyin:
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
3. Araçlar > Kart > Kart Yöneticisi'nde **esp32** (Espressif) paketini kurun.
4. Kütüphane Yöneticisi'nde şunları kurun: **MFRC522** (GithubCommunity, 1.4.x), **Adafruit GFX Library**, **Adafruit ST7735 and ST7789 Library**, **RTClib** (Adafruit).
5. `firmware/kart-okuyucu/kart-okuyucu.ino` dosyasını açın. Başındaki `#define WOKWI_SIM 0` satırı **0** kalmalı.
   Wi-Fi, web sayfası, hafıza ve güvenli bağlantı kütüphaneleri ESP32 paketiyle gelir; ek kütüphane gerekmez.
6. Araçlar > Kart: **ESP32 Dev Module**, Araçlar > Partition Scheme: **Default 4MB with spiffs** (varsayılan), Araçlar > Port: ESP32'nin COM portu.
   Komut satırı: `arduino-cli compile --fqbn esp32:esp32:esp32 firmware/kart-okuyucu` (2.0 yaklaşık 1,21 MB, alanın %92'si).
   İleride sığmazsa Partition Scheme **Minimal SPIFFS** seçilir (`esp32:esp32:esp32:PartitionScheme=min_spiffs`); bu seçim cihazdaki bekleyen okutmaları siler, önce hepsinin gönderildiğinden emin olun.
7. Yükle (→) düğmesine basın. "Connecting..." yazısında takılırsa ESP32 üzerindeki **BOOT** düğmesini basılı tutun.

Bilgisayar ESP32'yi görmüyorsa önce kabloyu değiştirin; yine görünmezse kart üzerindeki USB çipine göre
**CP210x** veya **CH340** sürücüsünü kurun.

İlk yüklemede saat modülünün saati, programın derlendiği bilgisayarın saatine ayarlanır; pil takılıysa korunur.
USB modunda giriş-çıkış kaydında cihazın saati **kullanılmaz**; kayıt sunucu saatiyle yapılır.
Wi-Fi modunda cihaz saati internete her bağlandığında otomatik (NTP, Türkiye saati) ayarlanır. İnternet yokken okutmanın saati
saat modülünden (DS3231) alınır. Saat modülünün pili bitmişse cihaz internete bağlanıp saati ayarlayana kadar okutma
kaydetmez ve ekranda **SAAT AYARSIZ** yazar.

## 4. Deneme
1. Arduino IDE'de Seri Monitörü **115200** hızında açın. `READY` görünmeli; ekranda logo ve "KARTINIZI OKUTUN" çıkar.
2. Bir kart okutun: `UID:A1B2C3D4` gibi bir satır çıkar ve buzzer kısa öter.
3. `ERROR:RC522 bulunamadi` yazıyorsa kabloları ve 3V3 bağlantısını kontrol edin.
4. **Seri Monitörü kapatın.** Açık kalırsa uygulama okuyucuya bağlanamaz.

Ekranda renkler ters görünüyorsa (kırmızı yerine mavi) dosyadaki `#define TFT_TAB INITR_BLACKTAB` satırını `INITR_GREENTAB` veya `INITR_REDTAB` yapın.

## 5. Uygulamada kullanım
**Kart kaydetme (Kart Atama > Kart Listesi)**
1. **Okuyucuya Bağlan** düğmesine basın. Tarayıcıda (Chrome/Edge) port seçme penceresi açılır; ESP32'yi seçin.
   Masaüstü uygulamasında ESP32 otomatik seçilir.
2. Kartları sırayla okutun. Her yeni kart sıradaki numarayla (001, 002, …) listeye eklenir; ekranda "KART 012 – LİSTEYE EKLENDİ" yazar.
3. Kart zaten kayıtlıysa ekranda kimde olduğu yazar ve buzzer iki kez uzun öter.
4. Kartların üstüne aynı numarayı yazan bir etiket yapıştırın; personele verirken listeden o numarayı seçersiniz.

**Giriş-çıkış (Kart Okutma)**
1. Kapıdaki bilgisayarda yalnız **Kart Okutma** yetkisi olan bir hesapla giriş yapın ve Kart Okutma sayfasını açık bırakın.
2. İlk okutma **giriş**, sonraki okutma **çıkış** olarak Günlük Saatler'e yazılır. Çıkıştan sonra tekrar okutulursa çıkış saati ileri alınır.
3. Aynı kişinin 15 dakika içindeki ikinci okutması sayılmaz (yanlışlıkla iki kez okutma).
4. İzinli/devamsız işaretli günler terminalden değiştirilmez. Çıkışı okutulmayan gün Günlük Saatler'de "Çıkış yok" olarak görünür ve elle tamamlanır.

## 6. Uygulama ile haberleşme (115200 baud)
| Yön | Mesaj | Anlamı |
|---|---|---|
| Cihaz → Uygulama | `READY` | Okuyucu hazır |
| Cihaz → Uygulama | `UID:A1B2C3D4` | Okutulan kart |
| Cihaz → Uygulama | `ERROR:RC522...` | Kart modülü bulunamadı |
| Uygulama → Cihaz | `O` / `E` | Başarılı / hata sesi |
| Uygulama → Cihaz | `{…}` | Ekran mesajı: tür + en fazla 3 satır, UTF-8 metnin küçük harf onaltılık hâli (`src/clock.js` → `encodeReaderMessage`). Eski okuyucular yok sayar. |
| Cihaz → Uygulama | `MODE:WIFI` / `MODE:USB` | Çalışma şekli (2.0). Wi-Fi modunda her `UID:` satırından önce de gelir; Kart Okutma sayfası bu durumda kaydetmez. |
| Cihaz → Uygulama | `STATUS:fw=2.0;mode=…;wifi=…;net=…;queue=…;failed=…;ssid=…;acct=…;clock=…;time=…` | Durum (2.0). Metinler `%XX` kodludur. Wi-Fi şifresi ve hesap şifresi hiçbir satırda yoktur. |
| Cihaz → Uygulama | `CFG:OK` / `CFG:ERR:<alan>` | Kurulum komutunun sonucu |
| Cihaz → Uygulama | `FAIL:<zaman>;<kart>;<neden>` … `FAIL:END` | Gönderilemeyen okutmalar (istenince) |
| Uygulama → Cihaz | `[…]` | Komut çerçevesi (2.0): `komut \x1f anahtar=değer …` metninin küçük harf onaltılık hâli (`src/device-config.js` → `encodeDeviceFrame`). Komutlar: `cfg`, `status`, `failed`, `failclear`, `forget`, `assign`, `setup`. Eski okuyucular yok sayar. |

## 7. Wi-Fi ile bilgisayarsız çalışma (yazılım 2.0)

### 7.1 Bir kez yapılacaklar
1. Cihaz için **ayrı bir hesap** açın: programın giriş ekranında yeni hesap oluşturun (ör. `terminal@example.com`).
2. Admin hesabıyla **Admin** sayfasında bu hesaba **yalnız Kart Okutma** yetkisini verip **Kaydet**'e basın. Başka yetki vermeyin.
3. Firestore kurallarının 0.4.0 sürümünü yayımlayın (ana `KURULUM.md` → "Firestore kurallarını yayımlama").

### 7.2 Admin sayfasından kurulum (asıl yol)
1. Cihazı USB kablosuyla bilgisayara takın. Kart Okutma sayfası açıksa başka bir sayfaya geçin (port aynı anda tek sayfada açılır).
2. **Admin** sayfasında aşağıdaki **Kart Okuyucu Cihazı** bölümünde **Cihaza Bağlan**'a basın (tarayıcıda ESP32'yi seçin).
3. Durum kutusu görünür: yazılım sürümü, Wi-Fi, internet, bekleyen okutma. "Cihaz durum bilgisi göndermiyor" yazıyorsa cihazda eski yazılım vardır; 2.0'ı yükleyin.
4. Doldurun:
   - **Wi-Fi adı** ve **Wi-Fi şifresi** (şifresiz ağ için boş bırakın),
   - **Cihaz hesabı e-posta** ve **şifresi** (7.1'deki hesap),
   - **Kurulum ağı şifresi**: yedek kurulum ağı için en az 8 karakterlik bir şifre belirleyin ve bir yere not edin.
5. **Cihaza Gönder**'e basın. "Bilgiler cihaza kaydedildi" yazar; birkaç saniye sonra durum **Bağlı / Çevrimiçi** olur.
6. Cihazı USB'den çıkarıp kapıya takın; yalnız 5V adaptör yeterlidir.

Şifreler yalnız USB kablosuyla cihaza gider. Programda, bulutta veya bilgisayarda saklanmaz; cihazdan da geri okunamaz.
Wi-Fi'yi değiştirmek için aynı formu yalnız Wi-Fi bilgileriyle gönderebilirsiniz (hesap alanları boş kalırsa cihazdaki hesap korunur).
**Wi-Fi Ayarlarını Sil** cihazı USB moduna döndürür; bekleyen okutmalar silinmez.

### 7.3 Yedek kurulum ağı (bilgisayar yokken, telefonla)
Cihaz kayıtlı Wi-Fi'ye **2 dakika** bağlanamazsa kendiliğinden, ya da ESP32 üzerindeki **BOOT** düğmesine **5 saniye** basılı tutunca kurulum moduna geçer.
Ekranda **KURULUM MODU** ve ağ adı **PersonelTakip-Kurulum** yazar.
1. Telefonun **Ayarlar → Wi-Fi** bölümünde **PersonelTakip-Kurulum** ağına bağlanın.
2. Şifre: Admin sayfasında belirlediğiniz **kurulum ağı şifresi**. Hiç belirlenmediyse cihaz ilk açılışta rastgele bir şifre üretmiştir; bu şifre yalnız kurulum modundayken cihaz ekranında görünür.
3. Telefon "İnternet yok" uyarısı verirse **bağlı kal** seçin. Kurulum sayfası genelde kendiliğinden açılır; açılmazsa tarayıcıda **http://192.168.4.1** yazın.
4. Listeden şirketin Wi-Fi ağını seçin (listede yoksa adını elle yazın), Wi-Fi şifresini girin ve **Kaydet ve Bağlan**'a basın.
5. Cihaz yeni ağa bağlanır; saat çubuğunun sağındaki Wi-Fi işareti **yeşil** olunca kurulum tamamdır. Telefonu normal Wi-Fi'nize geri bağlayın.

Kurulum sayfası kayıtlı şifreleri göstermez ve cihaz hesabını değiştiremez (yalnız Admin sayfasından USB ile).
Kurulum modunda da kart okutulabilir; okutmalar hafızaya alınır. 10 dakika kimse bağlanmazsa cihaz kayıtlı Wi-Fi'yi yeniden dener.
BOOT düğmesine kısa basmak kurulum modundan çıkar.

### 7.4 Ekran mesajları
| Ekranda | Anlamı |
|---|---|
| **GİRİŞ** / ad / saat – İYİ ÇALIŞMALAR | Giriş kaydedildi |
| **ÇIKIŞ** / ad / saat – İYİ AKŞAMLAR | Çıkış kaydedildi (sonraki okutmalar çıkışı ileri alır) |
| **ZATEN OKUTULDU** | 15 dakika içinde ikinci okutma; sayılmadı |
| **KAYDEDİLDİ** / ad / GİRİŞ 08:52 – GÖNDERİLECEK | İnternet yok: okutma hafızaya alındı, bağlantı gelince gönderilecek. Giriş/çıkış cihazın tahminidir; kesin kararı sistem verir |
| **HAFIZA DOLU** | 500 okutma bekliyor, yenisi kaydedilmedi. İnterneti kontrol edin |
| **SAAT AYARSIZ** | Saat modülü pili bitmiş/ayarsız; cihaz internete bağlanınca düzelir. Kayıt yapılmadı |
| **TANIMSIZ KART** | Kart kimseye verilmemiş |
| **KART GEÇERSİZ** – İŞTEN AYRILMIŞ | Personel ayrılmış; kayıt yapılmadı |
| **KAYIT YAPILMADI** – BUGÜN İZİNLİ / DEVAMSIZ / GÜN ELLE GİRİLMİŞ | O gün terminalden değiştirilemez |
| **YETKİ YOK** | Cihaz hesabının Kart Okutma yetkisi yok ya da kurallar okutmayı reddetti |
| Alt satır **ÇEVRİMİÇİ** | Bağlı, her şey yolunda |
| Alt satır **GÖNDERİLİYOR: 3** | Bekleyen okutmalar gönderiliyor |
| Alt satır **ÇEVRİMDIŞI – 3 BEKLİYOR** | İnternet yok; okutmalar saklanıyor |
| Alt satır **HESAP HATASI** | Cihaz hesabının e-posta/şifresi yanlış; Admin sayfasından yeniden gönderin |
| Alt satır **CİHAZ HESABI YOK** | Wi-Fi var ama cihaz hesabı girilmemiş |
| Saat çubuğunda Wi-Fi işareti | Yeşil: çevrimiçi · Sarı: hesap/yetki sorunu · Kırmızı: bağlantı yok · Mavi: kurulum modu |

### 7.5 Gönderilemeyen okutmalar
Sistemin reddettiği okutmalar (ör. 7 günden eski, kart başkasına geçmiş, gün elle girilmiş) kuyruğu tıkamaz; ayrı bir listeye alınır.
Admin sayfasında **Gönderilemeyenler** ile görünür. Gerekirse Günlük Saatler'den elle girin, sonra **Listeyi Temizle**.

### 7.6 Aynı anda USB'ye de takılıysa
Cihaz Wi-Fi modundayken bilgisayara takılı ve Kart Okutma sayfası açıksa sayfa kayıt yapmaz, "Cihaz Wi-Fi ile kendisi kaydediyor" yazar (çift kayıt olmaz).
**Kart Atama** sayfası açıkken cihaz okutulan kartı giriş/çıkış saymaz; kart ekleme her iki modda çalışır.

### 7.7 Güvenlik notları
- Cihaz yalnız Google'ın kök sertifikalarıyla (GTS Root R1–R4, GlobalSign) doğrulanan güvenli bağlantı kurar.
- Wi-Fi ve hesap şifreleri cihazın kendi hafızasında (NVS) şifrelenmeden durur. Cihazı fiziksel olarak ele geçiren biri bunları okuyabilir;
  bu yüzden cihaz hesabına **yalnız Kart Okutma** yetkisi verin. Cihaz kaybolursa Admin sayfasından hesabın yetkisini kaldırın ve Firebase Console → Authentication'dan hesabı devre dışı bırakın.
