/*
  OPEN ATTENDANCE - RFID PERSONEL KART OKUYUCU
  Surum 2.0  (Wi-Fi ile bilgisayarsiz calisan terminal + USB uyumlulugu)

  CALISMA SEKILLERI
    USB modu  : Wi-Fi bilgileri girilmemisse. Surum 1.1 ile ayni: kart UID'sini bilgisayara gonderir,
                kaydi bilgisayardaki "Kart Okutma" sayfasi yapar.
    Wi-Fi modu: Admin sayfasindaki "Kart Okuyucu Cihazi" bolumunden Wi-Fi + cihaz hesabi girilince.
                Cihaz Firebase'e kendisi baglanir, giris/cikisi kendisi yazar. Internet yoksa okutmayi
                hafizaya (LittleFS, elektrik kesilse de kalir, en cok 500 okutma) kaydeder ve baglanti
                gelince sirayla gonderir (source:'offline', scanAt = okutma ani).

  SERI PROTOKOL (115200 baud) - 1.1 ile geriye uyumlu
    Cihaz -> PC :  READY            okuyucu hazir
                   UID:A1B2C3D4     okutulan kartin UID'si (buyuk harf, ayracsiz)
                   ERROR:...        donanim hatasi (RC522 bulunamadi)
                   MODE:WIFI|USB    calisma sekli. Wi-Fi modunda her UID satirindan once de gonderilir;
                                    PC "Kart Okutma" sayfasi bunu gorunce okutmayi kendisi KAYDETMEZ.
                   STATUS:fw=2.1;mode=..;wifi=off|connecting|ok|setup;net=online|offline|auth|denied|noaccount;
                          queue=N;failed=N;ssid=..;acct=..;clock=ok|unset;time=..   (metinler %XX kodlu)
                   CFG:OK / CFG:ERR:<alan>   kurulum komutunun sonucu
                   FAIL:<epoch>;<uid>;<neden> ... FAIL:END   gonderilemeyen okutmalar
    PC -> Cihaz :  O / E            islem basarili / hata (yesil / kirmizi ekran)
                   {6869...}        ekran mesaji: UTF-8 metnin kucuk harf onaltilik hali (tur \x1f satir1 \x1f ...)
                   [LLLLCCCCCCCC...] komut cercevesi (2.0), kucuk harf onaltilik: 2 bayt uzunluk + 4 bayt CRC32
                                    (IEEE) + UTF-8 "komut \x1f anahtar=deger \x1f ...". Uzunluk/CRC tutmayan, tek sayida
                                    onaltilik, bilinmeyen komut/alan, eksik ayrac veya tekrar eden alan -> CFG:ERR:frame,
                                    hicbir ayar uygulanmaz (src/device-config.js parseDeviceFrame ayni kurali uygular).
                                    Komutlar: cfg (ssid, wpass, email, fpass, ap, key, project), status, failed,
                                    failclear, forget, assign (Kart Atama modu 15 sn), setup (kurulum agini ac),
                                    time (utc: bilgisayar saati; yalniz NTP ile ayarlanmamissa kullanilir).
                                    Wi-Fi sifresi ve hesap sifresi cihazdan hicbir komutla geri okunamaz.
  Diger karakterler yok sayilir. Turkce buyuk harfler (C G I O S U noktali/cengelli) ekranda cizilir.

  YEDEK KURULUM AGI
    Kayitli Wi-Fi'ye 2 dakika baglanilamazsa veya BOOT dugmesi 5 sn basili tutulursa cihaz
    "PersonelTakip-Kurulum" agini (WPA2) acar. Kendiliginden acilan kurulum aginda kayitli Wi-Fi 30 sn'de bir
    yeniden denenir, baglaninca kurulum agi hemen kapanir; en cok 10 dk acik kalir (sonra Wi-Fi yeniden denenir,
    gerekirse tekrar acilir). BOOT ile acilan kurulum agi sayfa 10 dk kullanilmazsa veya 30 dk sonunda kapanir. Telefonla bu aga baglanip acilan sayfadan (http://192.168.4.1)
    yeni Wi-Fi secilir. Kurulum agi sifresi Admin sayfasindan belirlenir; hic belirlenmediyse ilk acilista
    rastgele uretilir ve YALNIZ kurulum modunda cihaz ekraninda gosterilir. Bu sayfa sifreleri gostermez ve
    cihaz hesabini degistiremez (yalniz USB ile). Kurulum modundayken de kart okutulur (hafizaya alinir).
    BOOT'a kisa basmak kurulum modundan cikar.

  SAAT
    Oncelik NTP'dedir. NTP gelmezse (ör. UDP 123 kapali) sabitlenmis TLS ile konusulan Google sunucularinin
    (firestore/identitytoolkit/securetoken) HTTP "Date" basligi kullanilir; USB ile bagliyken Admin sayfasi
    bilgisayar saatini gonderebilir (time komutu). Saat bunlardan biriyle ayarlanana kadar okutma kaydedilmez.

  Parcalar ve pinler (ESP32 kart yazilari) - 1.1 ile ayni:
    SPI ortak : D18=SCK (TFT SCL + RC522 SCK), D23=MOSI (TFT SDA + RC522 MOSI), D19=MISO (RC522)
    TFT 1.8"  : CS=D33, DC=D26, RST=D32, VDD=3V3, BLK=3V3     (ST7735S 128x160)
    RC522     : SDA=D25, RST=D27, 3.3V=3V3, IRQ bos
    DS3231    : SDA=D21, SCL=D22, VCC=3V3   (Turkiye saati UTC+3 tutar; internet varken NTP ile ayarlanir)
    BUZZER    : D16 -> 1k -> NPN baz (aktif buzzer, HIGH = ses)
    BOOT      : D0 (kart uzerindeki BOOT dugmesi)

  Derleme: Arduino IDE / arduino-cli, kart "ESP32 Dev Module", varsayilan bolumleme (Default 4MB with spiffs).
    arduino-cli compile --fqbn esp32:esp32:esp32 firmware/kart-okuyucu      (esp32 cekirdek 3.3.12: ~1.21 MB, %92)
    Ileride sigmazsa: --fqbn esp32:esp32:esp32:PartitionScheme=min_spiffs  (1.9 MB uygulama, 190 KB LittleFS)
  Ek kutuphane gerekmez (WiFi, WebServer, DNSServer, Preferences, HTTPClient, WiFiClientSecure, LittleFS cekirdekle gelir).

  WOKWI_SIM 0 : gercek cihaz (DS3231 + aktif buzzer)   <- karta yuklerken 0 kalmali
  WOKWI_SIM 1 : Wokwi simulasyonu (DS1307 + tone)
*/
#define WOKWI_SIM 0
#define FW_VERSION "2.1"

// Ekran renkleri ters gorunurse (kirmizi yerine mavi) INITR_GREENTAB veya INITR_REDTAB deneyin.
#define TFT_TAB INITR_BLACKTAB

#include <SPI.h>
#include <Wire.h>
#include <MFRC522.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7735.h>
#include <RTClib.h>
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <LittleFS.h>
#include <esp_sntp.h>
#include <sys/time.h>
#include <time.h>

constexpr uint8_t PIN_SCK = 18, PIN_MISO = 19, PIN_MOSI = 23;
constexpr uint8_t TFT_CS = 33, TFT_DC = 26, TFT_RST = 32;
constexpr uint8_t RFID_SS = 25, RFID_RST = 27;
constexpr uint8_t RTC_SDA = 21, RTC_SCL = 22;
constexpr uint8_t BUZZER_PIN = 16;
constexpr uint8_t BOOT_BUTTON = 0;

constexpr unsigned long REPEAT_MS = 1500;       // ayni kart bu sure icinde tekrar gonderilmez
constexpr unsigned long RESULT_SHOW_MS = 2000;  // basarili/hata ekrani suresi
constexpr unsigned long CARD_WAIT_MS = 5000;    // programdan cevap gelmezse bekleme ekranina donus
constexpr unsigned long READER_CHECK_MS = 3000; // RC522 saglik kontrolu

constexpr int W = 160, H = 128;
constexpr int BODY_Y = 32, CLOCK_Y = 110;

// Renkler (RGB565)
constexpr uint16_t C_BLACK = 0x0000, C_WHITE = 0xFFFF, C_RED = 0xE8E4, C_DARK = 0x31A6;
constexpr uint16_t C_LIGHT = 0xC618;
constexpr uint16_t C_GREEN = 0x2DC6, C_BLUE = 0x2B5F, C_YELLOW = 0xFEA0, C_GREY = 0x8410, C_CYAN = 0x5EBF;

MFRC522 rfid(RFID_SS, RFID_RST);
Adafruit_ST7735 tft(TFT_CS, TFT_DC, TFT_RST);
#if WOKWI_SIM
RTC_DS1307 rtc;
#else
RTC_DS3231 rtc;
#endif

// Generic public-project header; no company logo is embedded.

// =====================================================================================
// Turler ve ortak durum (Arduino otomatik prototip uretir; tum turler ilk fonksiyondan once tanimli olmali)
// =====================================================================================
enum Screen { SCR_BOOT, SCR_READY, SCR_CARD, SCR_OK, SCR_ERR, SCR_HWERR, SCR_MSG, SCR_SETUP };
enum WifiState : uint8_t { WS_OFF, WS_CONNECTING, WS_OK, WS_SETUP };
enum NetState : uint8_t { NET_OFFLINE, NET_ONLINE, NET_AUTH, NET_DENIED, NET_NOACCOUNT };
enum Outcome { OUT_OK, OUT_OLD, OUT_READ_DENIED, OUT_DENIED, OUT_BAD, OUT_UNAUTH, OUT_RETRY, OUT_NET, OUT_MOVED, OUT_EDITED };
enum TimeSource : uint8_t { TS_NONE, TS_RTC, TS_NTP, TS_HTTP, TS_USB };
constexpr unsigned long MSG_SHOW_MS = 3500;     // giris/cikis mesaji ekranda kalma suresi
constexpr unsigned long MSG_SWALLOW_MS = 1500;  // mesajdan hemen sonra gelen O/E eski cihazlar icindir
constexpr unsigned long WIFI_FAIL_MS = 120000;  // bu sure baglanamazsa kurulum agi acilir
constexpr unsigned long SETUP_IDLE_MS = 600000; // kurulum sayfasi 10 dk kullanilmazsa tekrar Wi-Fi denenir
constexpr unsigned long SETUP_AUTO_MAX_MS = 600000;    // kendiliginden acilan kurulum agi en cok 10 dk
constexpr unsigned long SETUP_MANUAL_MAX_MS = 1800000; // BOOT/USB ile acilan kurulum agi en cok 30 dk
constexpr unsigned long SETUP_STA_RETRY_MS = 30000;    // kurulum agi acikken kayitli Wi-Fi bu aralikla denenir
constexpr unsigned long TIME_PROBE_MS = 60000;         // saat ayarsizken Google sunucu saati bu aralikla sorulur
constexpr uint32_t MIN_VALID_UTC = 1735689600UL;       // 2025-01-01: bundan eski saat gecersiz sayilir
constexpr uint32_t MAX_VALID_UTC = 4102444800UL;       // 2100-01-01
constexpr unsigned long BOOT_HOLD_MS = 5000;    // BOOT 5 sn basili: kurulum agi
constexpr unsigned long ASSIGN_HOLD_MS = 15000; // Kart Atama sayfasi bu surede bir "assign" gonderir
constexpr unsigned long PENDING_WAIT_MS = 5000; // cevrimici okutmanin sonucu en cok bu kadar beklenir
constexpr uint16_t QUEUE_MAX = 500;             // hafizada bekleyebilecek en cok okutma
constexpr uint16_t QUEUE_FILE_MAX = 600;        // dosya bu kayit sayisina ulasinca sikistirilir
constexpr uint16_t FAILED_MAX = 200;            // gonderilemeyen okutma listesi (en yenileri)
constexpr uint32_t TR_OFFSET = 3 * 3600;        // Turkiye saati UTC+3, yaz saati yok
constexpr uint32_t OFFLINE_AFTER_S = 90;        // bundan eski okutma cevrimdisi olarak (scanAt ile) gonderilir
constexpr uint32_t MAX_REPLAY_S = 7UL * 86400UL - 600UL; // kurallar 7 gunden eskisini kabul etmez
constexpr int REPEAT_MINUTES = 15;              // Kart Okutma ile ayni 15 dakika kurali
const char *SETUP_SSID = "PersonelTakip-Kurulum";

struct TrGlyph { char base; uint8_t accent; };   // accent: 0 yok, 1 iki nokta, 2 tek nokta, 3 kisa cizgi (G), 4 cengel
// Kalici okutma kaydi (LittleFS /queue.bin, 32 bayt). Bicim surumu magic baytindadir:
//   0xA5 (2.0 on surum): id rastgele, ilerleme NVS "qhead" (dosya indeksi) -> acilista 0xA6'ya donusturulur.
//   0xA6 (v3): id = artan sira numarasi (seq). Ilerleme NVS "qdone" = son islenmis (gonderilmis ya da
//              basarisiz listesine alinmis) seq; qPeek bunu ve daha kucugunu atlar. Sikistirma NVS'e yazmaz,
//              bu yuzden hangi adimda elektrik kesilirse kesilsin kayit kaybolmaz ve tekrar gonderilmez.
struct QRec { uint8_t magic; uint8_t flags; uint8_t uidLen; uint8_t pad; uint32_t id; uint32_t epoch; char uid[20]; };
static_assert(sizeof(QRec) == 32, "QRec 32 bayt olmali");
constexpr uint8_t QMAGIC_V2 = 0xA5;
constexpr uint8_t QMAGIC = 0xA6;
// Ag gorevinden ana donguye sonuc.
struct NetResult { uint32_t id; char uid[21]; char action[9]; char name[48]; char start[6]; char end[6]; char reason[8]; char last[4]; bool offline; };
struct Decision { String action, start, end, reason, last; };
struct Config { String ssid, wpass, email, fpass, apPass, apiKey, project; bool apGenerated = false; };
struct NameItem { char uid[21]; char name[44]; };
struct LocalState { char uid[21]; uint32_t day; int16_t lastMin; char state; };   // state: 'i' iceride, 'o' cikti
struct Pending { bool active; bool waiting; uint32_t id; char uid[21]; char guess; char hhmm[6]; unsigned long at; };

String msgKind, msgLines[3];                     // son ekran mesaji
unsigned long lastMsgAt = 0;
bool messageReceived = false;
Screen screen = SCR_BOOT;
unsigned long screenAt = 0, lastClockAt = 0, lastCheckAt = 0, lastReadAt = 0;
String lastUid;
bool readerOk = false, rtcOk = false;

Preferences prefs;
Config cfg;                                      // ana dongu sahibi; ag gorevi cfgMutex ile kopyalar
SemaphoreHandle_t cfgMutex, qMutex, nameMutex;
QueueHandle_t resultQ;
volatile uint32_t cfgVersion = 1;
volatile WifiState wifiState = WS_OFF;
volatile NetState netState = NET_NOACCOUNT;
volatile bool ntpSynced = false, ntpPending = false, rtcTrusted = false, fsOk = false;
volatile TimeSource timeSource = TS_NONE;
volatile bool httpTimePending = false;           // ag gorevi Google "Date" basligindan saat buldu; ana dongu uygular
volatile uint32_t httpTimeUtc = 0; volatile unsigned long httpTimeAtMs = 0, lastHttpTimeMs = 0;
volatile uint16_t failedCount = 0;
volatile unsigned long wifiOkSince = 0;
uint32_t qHead = 0, qTotal = 0, qDone = 0, qNextSeq = 1;   // qMutex ile; qHead yalniz RAM'de (hizlandirma)
// Tum sureler millis() farkiyla (now - baslangic >= sure) olculur; 49 gunluk millis() tasmasinda da dogru calisir.
unsigned long wsSince = 0, assignAt = 0, portalActivity = 0, portalSaveAt = 0, bootDownAt = 0, lastRtcToSys = 0, lastNtpAt = 0;
unsigned long setupSince = 0, setupRetryAt = 0;
bool bootHandled = false, bootDown = false, assignActive = false, portalSavePending = false, setupManual = false;
uint8_t cfgSlot = 255;                           // ayarlarin gecerli NVS yuvasi (kcfg0/kcfg1); 255 = eski tek alanli kayit
Pending pending = {};
NameItem names[150]; uint8_t nameCount = 0, nameNext = 0;
LocalState states[64]; uint8_t stateNext = 0;
WebServer server(80);
DNSServer dns;

// Google API'leri (firestore / identitytoolkit / securetoken .googleapis.com) icin sabitlenmis kok sertifikalar,
// https://pki.goog/repo/certs/ adresinden. SHA-256: GTS R1 D9:47:43:2A..., GTS R4 34:9D:FA:40..., GlobalSign R1 EB:D4:10:40...
// Google kok sertifikasini degistirirse yeni yazilim gerekir (GTS kokleri 2036'ya kadar gecerli).
const char ROOT_CA[] PROGMEM =
// GTS Root R1
"-----BEGIN CERTIFICATE-----\n"
"MIIFVzCCAz+gAwIBAgINAgPlk28xsBNJiGuiFzANBgkqhkiG9w0BAQwFADBHMQsw\n"
"CQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEU\n"
"MBIGA1UEAxMLR1RTIFJvb3QgUjEwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAw\n"
"MDAwWjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZp\n"
"Y2VzIExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjEwggIiMA0GCSqGSIb3DQEBAQUA\n"
"A4ICDwAwggIKAoICAQC2EQKLHuOhd5s73L+UPreVp0A8of2C+X0yBoJx9vaMf/vo\n"
"27xqLpeXo4xL+Sv2sfnOhB2x+cWX3u+58qPpvBKJXqeqUqv4IyfLpLGcY9vXmX7w\n"
"Cl7raKb0xlpHDU0QM+NOsROjyBhsS+z8CZDfnWQpJSMHobTSPS5g4M/SCYe7zUjw\n"
"TcLCeoiKu7rPWRnWr4+wB7CeMfGCwcDfLqZtbBkOtdh+JhpFAz2weaSUKK0Pfybl\n"
"qAj+lug8aJRT7oM6iCsVlgmy4HqMLnXWnOunVmSPlk9orj2XwoSPwLxAwAtcvfaH\n"
"szVsrBhQf4TgTM2S0yDpM7xSma8ytSmzJSq0SPly4cpk9+aCEI3oncKKiPo4Zor8\n"
"Y/kB+Xj9e1x3+naH+uzfsQ55lVe0vSbv1gHR6xYKu44LtcXFilWr06zqkUspzBmk\n"
"MiVOKvFlRNACzqrOSbTqn3yDsEB750Orp2yjj32JgfpMpf/VjsPOS+C12LOORc92\n"
"wO1AK/1TD7Cn1TsNsYqiA94xrcx36m97PtbfkSIS5r762DL8EGMUUXLeXdYWk70p\n"
"aDPvOmbsB4om3xPXV2V4J95eSRQAogB/mqghtqmxlbCluQ0WEdrHbEg8QOB+DVrN\n"
"VjzRlwW5y0vtOUucxD/SVRNuJLDWcfr0wbrM7Rv1/oFB2ACYPTrIrnqYNxgFlQID\n"
"AQABo0IwQDAOBgNVHQ8BAf8EBAMCAYYwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4E\n"
"FgQU5K8rJnEaK0gnhS9SZizv8IkTcT4wDQYJKoZIhvcNAQEMBQADggIBAJ+qQibb\n"
"C5u+/x6Wki4+omVKapi6Ist9wTrYggoGxval3sBOh2Z5ofmmWJyq+bXmYOfg6LEe\n"
"QkEzCzc9zolwFcq1JKjPa7XSQCGYzyI0zzvFIoTgxQ6KfF2I5DUkzps+GlQebtuy\n"
"h6f88/qBVRRiClmpIgUxPoLW7ttXNLwzldMXG+gnoot7TiYaelpkttGsN/H9oPM4\n"
"7HLwEXWdyzRSjeZ2axfG34arJ45JK3VmgRAhpuo+9K4l/3wV3s6MJT/KYnAK9y8J\n"
"ZgfIPxz88NtFMN9iiMG1D53Dn0reWVlHxYciNuaCp+0KueIHoI17eko8cdLiA6Ef\n"
"MgfdG+RCzgwARWGAtQsgWSl4vflVy2PFPEz0tv/bal8xa5meLMFrUKTX5hgUvYU/\n"
"Z6tGn6D/Qqc6f1zLXbBwHSs09dR2CQzreExZBfMzQsNhFRAbd03OIozUhfJFfbdT\n"
"6u9AWpQKXCBfTkBdYiJ23//OYb2MI3jSNwLgjt7RETeJ9r/tSQdirpLsQBqvFAnZ\n"
"0E6yove+7u7Y/9waLd64NnHi/Hm3lCXRSHNboTXns5lndcEZOitHTtNCjv0xyBZm\n"
"2tIMPNuzjsmhDYAPexZ3FL//2wmUspO8IFgV6dtxQ/PeEMMA3KgqlbbC1j+Qa3bb\n"
"bP6MvPJwNQzcmRk13NfIRmPVNnGuV/u3gm3c\n"
"-----END CERTIFICATE-----\n"
// GTS Root R2
"-----BEGIN CERTIFICATE-----\n"
"MIIFVzCCAz+gAwIBAgINAgPlrsWNBCUaqxElqjANBgkqhkiG9w0BAQwFADBHMQsw\n"
"CQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEU\n"
"MBIGA1UEAxMLR1RTIFJvb3QgUjIwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAw\n"
"MDAwWjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZp\n"
"Y2VzIExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjIwggIiMA0GCSqGSIb3DQEBAQUA\n"
"A4ICDwAwggIKAoICAQDO3v2m++zsFDQ8BwZabFn3GTXd98GdVarTzTukk3LvCvpt\n"
"nfbwhYBboUhSnznFt+4orO/LdmgUud+tAWyZH8QiHZ/+cnfgLFuv5AS/T3KgGjSY\n"
"6Dlo7JUle3ah5mm5hRm9iYz+re026nO8/4Piy33B0s5Ks40FnotJk9/BW9BuXvAu\n"
"MC6C/Pq8tBcKSOWIm8Wba96wyrQD8Nr0kLhlZPdcTK3ofmZemde4wj7I0BOdre7k\n"
"RXuJVfeKH2JShBKzwkCX44ofR5GmdFrS+LFjKBC4swm4VndAoiaYecb+3yXuPuWg\n"
"f9RhD1FLPD+M2uFwdNjCaKH5wQzpoeJ/u1U8dgbuak7MkogwTZq9TwtImoS1mKPV\n"
"+3PBV2HdKFZ1E66HjucMUQkQdYhMvI35ezzUIkgfKtzra7tEscszcTJGr61K8Yzo\n"
"dDqs5xoic4DSMPclQsciOzsSrZYuxsN2B6ogtzVJV+mSSeh2FnIxZyuWfoqjx5RW\n"
"Ir9qS34BIbIjMt/kmkRtWVtd9QCgHJvGeJeNkP+byKq0rxFROV7Z+2et1VsRnTKa\n"
"G73VululycslaVNVJ1zgyjbLiGH7HrfQy+4W+9OmTN6SpdTi3/UGVN4unUu0kzCq\n"
"gc7dGtxRcw1PcOnlthYhGXmy5okLdWTK1au8CcEYof/UVKGFPP0UJAOyh9OktwID\n"
"AQABo0IwQDAOBgNVHQ8BAf8EBAMCAYYwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4E\n"
"FgQUu//KjiOfT5nK2+JopqUVJxce2Q4wDQYJKoZIhvcNAQEMBQADggIBAB/Kzt3H\n"
"vqGf2SdMC9wXmBFqiN495nFWcrKeGk6c1SuYJF2ba3uwM4IJvd8lRuqYnrYb/oM8\n"
"0mJhwQTtzuDFycgTE1XnqGOtjHsB/ncw4c5omwX4Eu55MaBBRTUoCnGkJE+M3DyC\n"
"B19m3H0Q/gxhswWV7uGugQ+o+MePTagjAiZrHYNSVc61LwDKgEDg4XSsYPWHgJ2u\n"
"NmSRXbBoGOqKYcl3qJfEycel/FVL8/B/uWU9J2jQzGv6U53hkRrJXRqWbTKH7QMg\n"
"yALOWr7Z6v2yTcQvG99fevX4i8buMTolUVVnjWQye+mew4K6Ki3pHrTgSAai/Gev\n"
"HyICc/sgCq+dVEuhzf9gR7A/Xe8bVr2XIZYtCtFenTgCR2y59PYjJbigapordwj6\n"
"xLEokCZYCDzifqrXPW+6MYgKBesntaFJ7qBFVHvmJ2WZICGoo7z7GJa7Um8M7YNR\n"
"TOlZ4iBgxcJlkoKM8xAfDoqXvneCbT+PHV28SSe9zE8P4c52hgQjxcCMElv924Sg\n"
"JPFI/2R80L5cFtHvma3AH/vLrrw4IgYmZNralw4/KBVEqE8AyvCazM90arQ+POuV\n"
"7LXTWtiBmelDGDfrs7vRWGJB82bSj6p4lVQgw1oudCvV0b4YacCs1aTPObpRhANl\n"
"6WLAYv7YTVWW4tAR+kg0Eeye7QUd5MjWHYbL\n"
"-----END CERTIFICATE-----\n"
// GTS Root R3
"-----BEGIN CERTIFICATE-----\n"
"MIICCTCCAY6gAwIBAgINAgPluILrIPglJ209ZjAKBggqhkjOPQQDAzBHMQswCQYD\n"
"VQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEUMBIG\n"
"A1UEAxMLR1RTIFJvb3QgUjMwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAwMDAw\n"
"WjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2Vz\n"
"IExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjMwdjAQBgcqhkjOPQIBBgUrgQQAIgNi\n"
"AAQfTzOHMymKoYTey8chWEGJ6ladK0uFxh1MJ7x/JlFyb+Kf1qPKzEUURout736G\n"
"jOyxfi//qXGdGIRFBEFVbivqJn+7kAHjSxm65FSWRQmx1WyRRK2EE46ajA2ADDL2\n"
"4CejQjBAMA4GA1UdDwEB/wQEAwIBhjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQW\n"
"BBTB8Sa6oC2uhYHP0/EqEr24Cmf9vDAKBggqhkjOPQQDAwNpADBmAjEA9uEglRR7\n"
"VKOQFhG/hMjqb2sXnh5GmCCbn9MN2azTL818+FsuVbu/3ZL3pAzcMeGiAjEA/Jdm\n"
"ZuVDFhOD3cffL74UOO0BzrEXGhF16b0DjyZ+hOXJYKaV11RZt+cRLInUue4X\n"
"-----END CERTIFICATE-----\n"
// GTS Root R4
"-----BEGIN CERTIFICATE-----\n"
"MIICCTCCAY6gAwIBAgINAgPlwGjvYxqccpBQUjAKBggqhkjOPQQDAzBHMQswCQYD\n"
"VQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEUMBIG\n"
"A1UEAxMLR1RTIFJvb3QgUjQwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAwMDAw\n"
"WjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2Vz\n"
"IExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjQwdjAQBgcqhkjOPQIBBgUrgQQAIgNi\n"
"AATzdHOnaItgrkO4NcWBMHtLSZ37wWHO5t5GvWvVYRg1rkDdc/eJkTBa6zzuhXyi\n"
"QHY7qca4R9gq55KRanPpsXI5nymfopjTX15YhmUPoYRlBtHci8nHc8iMai/lxKvR\n"
"HYqjQjBAMA4GA1UdDwEB/wQEAwIBhjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQW\n"
"BBSATNbrdP9JNqPV2Py1PsVq8JQdjDAKBggqhkjOPQQDAwNpADBmAjEA6ED/g94D\n"
"9J+uHXqnLrmvT/aDHQ4thQEd0dlq7A/Cr8deVl5c1RxYIigL9zC2L7F8AjEA8GE8\n"
"p/SgguMh1YQdc4acLa/KNJvxn7kjNuK8YAOdgLOaVsjh4rsUecrNIdSUtUlD\n"
"-----END CERTIFICATE-----\n"
// GlobalSign Root CA (R1)
"-----BEGIN CERTIFICATE-----\n"
"MIIDdTCCAl2gAwIBAgILBAAAAAABFUtaw5QwDQYJKoZIhvcNAQEFBQAwVzELMAkG\n"
"A1UEBhMCQkUxGTAXBgNVBAoTEEdsb2JhbFNpZ24gbnYtc2ExEDAOBgNVBAsTB1Jv\n"
"b3QgQ0ExGzAZBgNVBAMTEkdsb2JhbFNpZ24gUm9vdCBDQTAeFw05ODA5MDExMjAw\n"
"MDBaFw0yODAxMjgxMjAwMDBaMFcxCzAJBgNVBAYTAkJFMRkwFwYDVQQKExBHbG9i\n"
"YWxTaWduIG52LXNhMRAwDgYDVQQLEwdSb290IENBMRswGQYDVQQDExJHbG9iYWxT\n"
"aWduIFJvb3QgQ0EwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDaDuaZ\n"
"jc6j40+Kfvvxi4Mla+pIH/EqsLmVEQS98GPR4mdmzxzdzxtIK+6NiY6arymAZavp\n"
"xy0Sy6scTHAHoT0KMM0VjU/43dSMUBUc71DuxC73/OlS8pF94G3VNTCOXkNz8kHp\n"
"1Wrjsok6Vjk4bwY8iGlbKk3Fp1S4bInMm/k8yuX9ifUSPJJ4ltbcdG6TRGHRjcdG\n"
"snUOhugZitVtbNV4FpWi6cgKOOvyJBNPc1STE4U6G7weNLWLBYy5d4ux2x8gkasJ\n"
"U26Qzns3dLlwR5EiUWMWea6xrkEmCMgZK9FGqkjWZCrXgzT/LCrBbBlDSgeF59N8\n"
"9iFo7+ryUp9/k5DPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNVHRMBAf8E\n"
"BTADAQH/MB0GA1UdDgQWBBRge2YaRQ2XyolQL30EzTSo//z9SzANBgkqhkiG9w0B\n"
"AQUFAAOCAQEA1nPnfE920I2/7LqivjTFKDK1fPxsnCwrvQmeU79rXqoRSLblCKOz\n"
"yj1hTdNGCbM+w6DjY1Ub8rrvrTnhQ7k4o+YviiY776BQVvnGCv04zcQLcFGUl5gE\n"
"38NflNUVyRRBnMRddWQVDf9VMOyGj/8N7yy5Y0b2qvzfvGn9LhJIZJrglfCm7ymP\n"
"AbEVtQwdpf5pLGkkeB6zpxxxYu7KyJesF12KwvhHhm4qxFYxldBniYUr+WymXUad\n"
"DKqC5JlR3XC321Y9YeRq4VzW9v493kHMB65jUr9TU/Qr6cf9tveCX4XSQRjbgbME\n"
"HMUfpIBvFSDJ3gyICh3WZlXi/EjJKSZp4A==\n"
"-----END CERTIFICATE-----\n"
// GlobalSign ECC Root CA - R4
"-----BEGIN CERTIFICATE-----\n"
"MIIB3DCCAYOgAwIBAgINAgPlfvU/k/2lCSGypjAKBggqhkjOPQQDAjBQMSQwIgYD\n"
"VQQLExtHbG9iYWxTaWduIEVDQyBSb290IENBIC0gUjQxEzARBgNVBAoTCkdsb2Jh\n"
"bFNpZ24xEzARBgNVBAMTCkdsb2JhbFNpZ24wHhcNMTIxMTEzMDAwMDAwWhcNMzgw\n"
"MTE5MDMxNDA3WjBQMSQwIgYDVQQLExtHbG9iYWxTaWduIEVDQyBSb290IENBIC0g\n"
"UjQxEzARBgNVBAoTCkdsb2JhbFNpZ24xEzARBgNVBAMTCkdsb2JhbFNpZ24wWTAT\n"
"BgcqhkjOPQIBBggqhkjOPQMBBwNCAAS4xnnTj2wlDp8uORkcA6SumuU5BwkWymOx\n"
"uYb4ilfBV85C+nOh92VC/x7BALJucw7/xyHlGKSq2XE/qNS5zowdo0IwQDAOBgNV\n"
"HQ8BAf8EBAMCAYYwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4EFgQUVLB7rUW44kB/\n"
"+wpu+74zyTyjhNUwCgYIKoZIzj0EAwIDRwAwRAIgIk90crlgr/HmnKAWBVBfw147\n"
"bmF0774BxL4YSFlhgjICICadVGNA3jdgUM/I2O2dgq43mLyjj0xMqTQrbO/7lZsm\n"
"-----END CERTIFICATE-----\n";


// ---------------- Buzzer (bloklamayan) ----------------
struct Beep { uint16_t onMs, offMs, freq; };
Beep pattern[4]; uint8_t patLen = 0, patIdx = 0; bool beepOn = false; unsigned long beepAt = 0;

void buzzerWrite(bool on, uint16_t freq) {
#if WOKWI_SIM
  if (on) tone(BUZZER_PIN, freq); else noTone(BUZZER_PIN);
#else
  (void)freq;
  digitalWrite(BUZZER_PIN, on ? HIGH : LOW);
#endif
}
void playPattern(const Beep *p, uint8_t n) {
  for (uint8_t i = 0; i < n; i++) pattern[i] = p[i];
  patLen = n; patIdx = 0; beepOn = true; beepAt = millis();
  buzzerWrite(true, pattern[0].freq);
}
void buzzerTask() {
  if (patIdx >= patLen) return;
  unsigned long t = millis() - beepAt;
  if (beepOn && t >= pattern[patIdx].onMs) { buzzerWrite(false, 0); beepOn = false; beepAt = millis(); }
  else if (!beepOn && t >= pattern[patIdx].offMs) {
    if (++patIdx < patLen) { buzzerWrite(true, pattern[patIdx].freq); beepOn = true; beepAt = millis(); }
  }
}
const Beep BEEP_SCAN[] = {{60, 0, 2700}};
const Beep BEEP_OK[] = {{80, 60, 2700}, {80, 0, 3200}};
const Beep BEEP_ERR[] = {{250, 120, 650}, {250, 0, 650}};
const Beep BEEP_INFO[] = {{120, 90, 1800}, {120, 0, 1800}};
const Beep BEEP_HW[] = {{400, 200, 500}, {400, 200, 500}, {400, 0, 500}};

// ---------------- RC522 ----------------
bool checkReader() {
  byte v = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  return v != 0x00 && v != 0xFF;
}
String uidHex(const MFRC522::Uid &uid) {
  String s;
  for (byte i = 0; i < uid.size; i++) { if (uid.uidByte[i] < 0x10) s += '0'; s += String(uid.uidByte[i], HEX); }
  s.toUpperCase();
  return s;
}

// ---------------- Turkce yazi ----------------
// Ekranin hazir yazi tipinde C, G, I, O, S, U'nun Turkce bicimleri yok. Harf cizilir, noktasi/cengeli piksel olarak eklenir.
// Program metni buyuk harfe cevirip gonderir; burada yalniz buyuk harfler gerekir.
TrGlyph trGlyph(const String &s, unsigned &i) {
  uint8_t c = s[i];
  if (c < 0x80) return { char(c), 0 };
  uint8_t d = (i + 1 < s.length()) ? uint8_t(s[i + 1]) : 0;
  if (c == 0xC3 || c == 0xC4 || c == 0xC5) i++;
  else { while (i + 1 < s.length() && (uint8_t(s[i + 1]) & 0xC0) == 0x80) i++; return { '?', 0 }; }
  if (c == 0xC3 && d == 0x87) return { 'C', 4 };   // Ç
  if (c == 0xC3 && d == 0x96) return { 'O', 1 };   // Ö
  if (c == 0xC3 && d == 0x9C) return { 'U', 1 };   // Ü
  if (c == 0xC4 && d == 0x9E) return { 'G', 3 };   // Ğ
  if (c == 0xC4 && d == 0xB0) return { 'I', 2 };   // İ
  if (c == 0xC5 && d == 0x9E) return { 'S', 4 };   // Ş
  return { '?', 0 };
}
int trLength(const String &s) {
  int n = 0;
  for (unsigned i = 0; i < s.length(); i++) { trGlyph(s, i); n++; }
  return n;
}
void drawTr(const String &s, int x, int y, uint8_t size, uint16_t color) {
  int u = size;
  for (unsigned i = 0; i < s.length(); i++) {
    TrGlyph g = trGlyph(s, i);
    tft.drawChar(x, y, g.base, color, color, size);
    switch (g.accent) {
      case 1: tft.fillRect(x + 1 * u, y - 2 * u, u, u, color); tft.fillRect(x + 3 * u, y - 2 * u, u, u, color); break;
      case 2: tft.fillRect(x + 2 * u, y - 2 * u, u, u, color); break;
      case 3: tft.fillRect(x, y - 3 * u, u, u, color); tft.fillRect(x + 4 * u, y - 3 * u, u, u, color); tft.fillRect(x + u, y - 2 * u, 3 * u, u, color); break;
      case 4: tft.fillRect(x + 2 * u, y + 7 * u, u, u, color); tft.fillRect(x + 1 * u, y + 8 * u, u, u, color); break;
    }
    x += 6 * size;
  }
}
// Ortalar; size 2'de sigmazsa size 1 kullanir.
void centerTr(const String &s, int y, uint8_t size, uint16_t color) {
  int n = trLength(s);
  if (size > 1 && n * 6 * size > W) size = 1;
  int x = (W - n * 6 * size) / 2; if (x < 0) x = 0;
  drawTr(s, x, y, size, color);
}
// Uzun adi iki satira boler (bosluktan). Sigmazsa kucuk yaziyla yazar.
void drawName(const String &name) {
  const int perLine = W / 12;  // size 2: 13 karakter
  int n = trLength(name);
  if (n <= perLine) { centerTr(name, 62, 2, C_WHITE); return; }
  int cut = -1;
  for (int i = name.length() - 1; i > 0; i--) if (name[i] == ' ' && trLength(name.substring(0, i)) <= perLine) { cut = i; break; }
  if (cut > 0 && trLength(name.substring(cut + 1)) <= perLine) {
    centerTr(name.substring(0, cut), 58, 2, C_WHITE);
    centerTr(name.substring(cut + 1), 81, 2, C_WHITE);
  } else {
    centerTr(name, 66, 1, C_WHITE);
  }
}
// Sunucudan gelen adi ekranin gosterebilecegi Turkce buyuk harflere cevirir (program tarafindaki readerText ile ayni).
String readerText(const String &s) {
  String out;
  for (unsigned i = 0; i < s.length() && out.length() < 60; i++) {
    uint8_t c = s[i];
    if (c < 0x80) {
      if (c == 'i') out += "\xC4\xB0";
      else if (c >= 'a' && c <= 'z') out += char(c - 32);
      else if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || strchr(" .,:;'()/+-", c)) out += char(c);
      else if (c < 0x20) out += ' ';
      continue;
    }
    uint8_t d = i + 1 < s.length() ? uint8_t(s[i + 1]) : 0;
    const char *map = nullptr;
    if (c == 0xC3) {
      if (d == 0xA7 || d == 0x87) map = "\xC3\x87";        // ç Ç
      else if (d == 0xB6 || d == 0x96) map = "\xC3\x96";   // ö Ö
      else if (d == 0xBC || d == 0x9C) map = "\xC3\x9C";   // ü Ü
      else if (d == 0xA2 || d == 0x82) map = "A";          // â
      else if (d == 0xAE || d == 0x8E) map = "\xC4\xB0";   // î
      else if (d == 0xBB || d == 0x9B) map = "U";          // û
    } else if (c == 0xC4) {
      if (d == 0x9F || d == 0x9E) map = "\xC4\x9E";        // ğ Ğ
      else if (d == 0xB1) map = "I";                       // ı
      else if (d == 0xB0) map = "\xC4\xB0";                // İ
    } else if (c == 0xC5) {
      if (d == 0x9F || d == 0x9E) map = "\xC5\x9E";        // ş Ş
    }
    while (i + 1 < s.length() && (uint8_t(s[i + 1]) & 0xC0) == 0x80) i++;
    if (map) out += map;
  }
  out.trim();
  return out;
}

// ---------------- Zaman ----------------
// Sistem saati acilista DS3231'den, internet varken NTP'den ayarlanir. UTC saniye dondurur; bilinmiyorsa 0.
uint32_t nowUtc() {
  time_t t = time(nullptr);
  if (t > 1700000000) return uint32_t(t);
  if (rtcOk) return rtc.now().unixtime() - TR_OFFSET;
  return 0;
}
volatile bool sysTimeTrusted = false;            // bu acilista NTP / Google Date / USB ile ayarlandi
bool clockTrusted() { return ntpSynced || sysTimeTrusted || (rtcOk && rtcTrusted); }
bool plausibleUtc(uint32_t utc) { return utc >= MIN_VALID_UTC && utc < MAX_VALID_UTC; }
// 1970-01-01'den gun sayisi (proleptik Gregoryen), H. Hinnant days_from_civil.
int32_t daysFromCivil(int y, unsigned m, unsigned d) {
  y -= m <= 2;
  const int era = (y >= 0 ? y : y - 399) / 400;
  const unsigned yoe = unsigned(y - era * 400);
  const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + int32_t(doe) - 719468;
}
uint32_t utcFrom(int y, int mo, int d, int h, int mi, int s) {
  if (y < 2000 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > 31 || h < 0 || h > 23 || mi < 0 || mi > 59 || s < 0 || s > 60) return 0;
  return uint32_t(daysFromCivil(y, mo, d)) * 86400UL + h * 3600UL + mi * 60UL + s;
}
// Firestore zaman damgasi "2026-11-10T13:29:38.123456Z" -> UTC saniye; ceil: kesirli saniye yukari yuvarlanir.
uint32_t parseRfc3339(const String &v, bool ceil = false) {
  int y, mo, d, h, mi, s;
  if (v.length() < 20 || sscanf(v.c_str(), "%4d-%2d-%2dT%2d:%2d:%2d", &y, &mo, &d, &h, &mi, &s) != 6) return 0;
  uint32_t t = utcFrom(y, mo, d, h, mi, s);
  bool frac = false;
  if (v[19] == '.') for (unsigned i = 20; i < v.length() && isdigit((unsigned char)v[i]); i++) if (v[i] != '0') frac = true;
  return t && ceil && frac ? t + 1 : t;
}
// HTTP Date basligi (RFC 7231 IMF-fixdate): "Tue, 10 Nov 2026 13:29:38 GMT" -> UTC saniye; gecersizse 0.
uint32_t parseHttpDate(const String &v) {
  static const char *MONTHS = "JanFebMarAprMayJunJulAugSepOctNovDec";
  char mon[4] = {0}, zone[4] = {0}; int d, y, h, mi, s;
  if (sscanf(v.c_str(), "%*3s, %2d %3s %4d %2d:%2d:%2d %3s", &d, mon, &y, &h, &mi, &s, zone) != 7 || strcmp(zone, "GMT")) return 0;
  const char *at = strstr(MONTHS, mon);
  if (!at || (at - MONTHS) % 3) return 0;
  uint32_t t = utcFrom(y, int(at - MONTHS) / 3 + 1, d, h, mi, s);
  return plausibleUtc(t) ? t : 0;
}
void setSystemTime(uint32_t utc) { struct timeval tv = { time_t(utc), 0 }; settimeofday(&tv, nullptr); }
void onNtpSync(struct timeval *) { ntpPending = true; }
void trDateTime(uint32_t utc, char *date, char *hhmm) {
  DateTime local(utc + TR_OFFSET);
  if (date) snprintf(date, 11, "%04d-%02d-%02d", local.year(), local.month(), local.day());
  if (hhmm) snprintf(hhmm, 6, "%02d:%02d", local.hour(), local.minute());
}
uint32_t trDayNumber(uint32_t utc) { DateTime l(utc + TR_OFFSET); return uint32_t(l.year()) * 10000 + l.month() * 100 + l.day(); }
int trMinute(uint32_t utc) { DateTime l(utc + TR_OFFSET); return l.hour() * 60 + l.minute(); }
int toMinutes(const String &t) { return t.length() >= 5 ? t.substring(0, 2).toInt() * 60 + t.substring(3, 5).toInt() : 0; }

// ---------------- Ekran ----------------
void centerText(const String &t, int y, uint8_t size, uint16_t color) {
  tft.setTextSize(size); tft.setTextColor(color);
  int x = (W - int(t.length()) * 6 * size) / 2; if (x < 0) x = 0;
  tft.setCursor(x, y); tft.print(t);
}
void drawLogoBar(uint16_t stateColor) {
  tft.fillRect(0, 0, W, 28, C_BLACK);
  tft.setTextColor(C_WHITE, C_BLACK);
  tft.setTextSize(1);
  tft.setCursor(24, 10);
  tft.print("PERSONEL TAKIP");
  tft.fillRect(0, 28, W, 4, stateColor);
}
void clearBody() { tft.fillRect(0, BODY_Y, W, CLOCK_Y - BODY_Y, C_BLACK); }
bool wifiConfigured() { return cfg.ssid.length() > 0 && cfg.email.length() > 0 && cfg.fpass.length() > 0 && cfg.apiKey.length() > 0 && cfg.project.length() > 0; }
uint16_t queuePending();
// Saat cubugunun sagindaki Wi-Fi isareti: yesil cevrimici, sari baglaniyor/hesap sorunu, kirmizi baglanti yok, mavi kurulum.
void drawNetIcon() {
  if (wifiState == WS_OFF) return;
  uint16_t color = wifiState == WS_SETUP ? C_CYAN
    : wifiState != WS_OK ? C_RED
    : netState == NET_ONLINE ? C_GREEN : netState == NET_OFFLINE ? C_RED : C_YELLOW;
  int x = 150, y = CLOCK_Y + 12;
  tft.fillRect(x, y - 2, 2, 2, color);
  tft.fillRect(x + 3, y - 4, 2, 4, color);
  tft.fillRect(x + 6, y - 6, 2, 6, color);
  tft.fillRect(x + 9, y - 9, 2, 9, color);
}
void drawClock(bool force = false) {
  static int lastSec = -1;
  if (!rtcOk) {
    if (force) { tft.fillRect(0, CLOCK_Y, W, H - CLOCK_Y, C_DARK); centerText("SAAT MODULU YOK", CLOCK_Y + 5, 1, C_YELLOW); drawNetIcon(); }
    return;
  }
  DateTime n = rtc.now();
  if (!force && n.second() == lastSec) return;
  lastSec = n.second();
  char b[24];
  snprintf(b, sizeof(b), "%02d.%02d.%04d   %02d:%02d:%02d", n.day(), n.month(), n.year(), n.hour(), n.minute(), n.second());
  tft.fillRect(0, CLOCK_Y, W, H - CLOCK_Y, C_DARK);
  if (wifiState == WS_OFF) centerText(b, CLOCK_Y + 5, 1, C_WHITE);
  else { tft.setTextSize(1); tft.setTextColor(C_WHITE); tft.setCursor(8, CLOCK_Y + 5); tft.print(b); drawNetIcon(); }
}
// Bekleme ekranindaki durum satiri (Wi-Fi modunda).
String statusLine(uint16_t &color) {
  uint16_t q = queuePending();
  if (wifiState == WS_OFF) { color = C_GREY; return "OKUYUCU HAZIR"; }
  if (wifiState == WS_OK && netState == NET_ONLINE) {
    color = q ? C_YELLOW : C_GREEN;
    return q ? "GÖNDERİLİYOR: " + String(q) : "ÇEVRİMİÇİ";
  }
  if (wifiState == WS_OK && netState == NET_AUTH) { color = C_YELLOW; return "HESAP HATASI - " + String(q) + " BEKLİYOR"; }
  if (wifiState == WS_OK && netState == NET_DENIED) { color = C_RED; return "YETKİ YOK - " + String(q) + " BEKLİYOR"; }
  if (wifiState == WS_OK && netState == NET_NOACCOUNT) { color = C_YELLOW; return "CİHAZ HESABI YOK"; }
  color = C_RED;
  return q ? "ÇEVRİMDIŞI - " + String(q) + " BEKLİYOR" : "ÇEVRİMDIŞI - KAYIT SAKLANIR";
}
void drawStatusLine() {
  uint16_t color; String text = statusLine(color);
  tft.fillRect(0, 90, W, 14, C_BLACK);
  if (wifiState == WS_OFF) {
    tft.fillCircle(20, 96, 3, C_GREEN);
    tft.setTextSize(1); tft.setTextColor(C_GREY); tft.setCursor(28, 93); tft.print("Okuyucu hazir");
  } else centerTr(text, 93, 1, color);
}
void show(Screen s, const String &info = "") {
  screen = s; screenAt = millis();
  switch (s) {
    case SCR_BOOT:
      tft.fillScreen(C_BLACK); drawLogoBar(C_RED); clearBody();
      centerText("PERSONEL TAKIP", 46, 1, C_WHITE);
      centerText("KART OKUYUCU " FW_VERSION, 60, 1, C_WHITE);
      centerText("SISTEM ACILIYOR...", 84, 1, C_YELLOW);
      break;
    case SCR_READY:
      drawLogoBar(C_GREEN); clearBody();
      centerText("KARTINIZI", 44, 2, C_WHITE);
      centerText("OKUTUN", 66, 2, C_WHITE);
      drawStatusLine();
      break;
    case SCR_CARD:
      drawLogoBar(C_BLUE); clearBody();
      centerText("KART OKUNDU", 40, 1, C_CYAN);
      centerText(info, 56, info.length() <= 12 ? 2 : 1, C_YELLOW);
      centerText("Kontrol ediliyor...", 88, 1, C_GREY);
      break;
    case SCR_OK:
      drawLogoBar(C_GREEN); clearBody();
      tft.fillCircle(80, 60, 18, C_GREEN);
      tft.drawLine(71, 60, 77, 67, C_WHITE); tft.drawLine(71, 61, 77, 68, C_WHITE);
      tft.drawLine(77, 67, 90, 52, C_WHITE); tft.drawLine(77, 68, 90, 53, C_WHITE);
      centerText("ISLEM BASARILI", 90, 1, C_GREEN);
      break;
    case SCR_ERR:
      drawLogoBar(C_RED); clearBody();
      tft.fillCircle(80, 60, 18, C_RED);
      tft.drawLine(72, 52, 88, 68, C_WHITE); tft.drawLine(73, 52, 89, 68, C_WHITE);
      tft.drawLine(88, 52, 72, 68, C_WHITE); tft.drawLine(89, 52, 73, 68, C_WHITE);
      centerText("ISLEM REDDEDILDI", 90, 1, C_RED);
      break;
    case SCR_MSG: {
      uint16_t color = msgKind == "in" || msgKind == "ok" ? C_GREEN : msgKind == "out" ? C_BLUE : msgKind == "info" ? C_YELLOW : C_RED;
      drawLogoBar(color); clearBody();
      centerTr(msgLines[0], 38, 2, color);
      drawName(msgLines[1]);
      centerTr(msgLines[2], 101, 1, C_LIGHT);
      break;
    }
    case SCR_HWERR:
      drawLogoBar(C_RED); clearBody();
      centerText("DONANIM HATASI", 40, 1, C_RED);
      centerText(info, 56, 2, C_YELLOW);
      centerText("Kablolari kontrol edin", 88, 1, C_WHITE);
      break;
    case SCR_SETUP:
      drawLogoBar(C_CYAN); clearBody();
      centerTr("KURULUM MODU", 36, 1, C_CYAN);
      centerTr("TELEFONDAN BU AĞA BAĞLANIN:", 50, 1, C_WHITE);
      centerText(SETUP_SSID, 62, 1, C_YELLOW);
      if (cfg.apGenerated) { centerTr("ŞİFRE:", 76, 1, C_WHITE); centerText(cfg.apPass, 86, 1, C_YELLOW); }
      else { centerTr("ŞİFRE: ADMİN BELİRLEDİ", 80, 1, C_WHITE); }
      centerText("http://192.168.4.1", 98, 1, C_LIGHT);
      break;
  }
  drawClock(true);
}
// Cihazin kendi sonucu: ayni gorunum (tur + 3 satir) PC mesajlariyla ortak.
void showMessage(const String &kind, const String &l0, const String &l1, const String &l2) {
  msgKind = kind; msgLines[0] = l0; msgLines[1] = l1; msgLines[2] = l2;
  show(SCR_MSG);
  if (kind == "in" || kind == "out" || kind == "ok") playPattern(BEEP_OK, 2);
  else if (kind == "info") playPattern(BEEP_INFO, 2);
  else playPattern(BEEP_ERR, 2);
}
Screen idleScreen() { return wifiState == WS_SETUP ? SCR_SETUP : SCR_READY; }

// ---------------- Ayarlar (NVS) ----------------
String randomSetupPassword() {
  const char *chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // karisan harfler (0/O, 1/I) yok
  String out;
  for (int i = 0; i < 10; i++) out += chars[esp_random() % 32];
  return out;
}
// Ayarlar iki NVS yuvasindan (kcfg0 / kcfg1) birinde tutulur. Yeni ayar bos yuvaya eksiksiz yazilir, en son
// "kart" alanindaki tek baytlik gosterge (cslot) cevrilir: elektrik kesilse de ya eski ya yeni ayar gecerli kalir.
const char *CFG_KEYS[] = { "ssid", "wpass", "email", "fpass", "key", "project", "ap", "apgen" };
void readConfigFrom(Preferences &p, Config &c) {
  c.ssid = p.getString("ssid", ""); c.wpass = p.getString("wpass", "");
  c.email = p.getString("email", ""); c.fpass = p.getString("fpass", "");
  c.apiKey = p.getString("key", ""); c.project = p.getString("project", "");
  c.apPass = p.getString("ap", ""); c.apGenerated = p.getBool("apgen", false);
}
bool putIfSet(Preferences &p, const char *key, const String &value) { return value.length() == 0 || p.putString(key, value) == value.length(); }
bool saveConfigAtomic(const Config &next) {
  uint8_t target = cfgSlot == 0 ? 1 : 0;
  Preferences slot;
  if (!slot.begin(target ? "kcfg1" : "kcfg0", false)) return false;
  bool ok = slot.clear()
    && putIfSet(slot, "ssid", next.ssid) && putIfSet(slot, "wpass", next.wpass) && putIfSet(slot, "email", next.email)
    && putIfSet(slot, "fpass", next.fpass) && putIfSet(slot, "key", next.apiKey) && putIfSet(slot, "project", next.project)
    && putIfSet(slot, "ap", next.apPass) && slot.putBool("apgen", next.apGenerated) && slot.putBool("ok", true);
  slot.end();
  if (!ok || prefs.putUChar("cslot", target) != 1) return false;
  cfgSlot = target;
  for (const char *k : CFG_KEYS) prefs.remove(k);   // eski tek alanli kayit (sifreler dahil) temizlenir
  return true;
}
void loadConfig() {
  prefs.begin("kart", false);
  cfgSlot = prefs.getUChar("cslot", 255);
  if (cfgSlot <= 1) {
    Preferences slot;
    if (slot.begin(cfgSlot ? "kcfg1" : "kcfg0", true) && slot.getBool("ok", false)) readConfigFrom(slot, cfg);
    slot.end();
  } else readConfigFrom(prefs, cfg);
  // Kurulum agi sifresi hic belirlenmediyse ilk acilista rastgele uretilir; yalniz kurulum modunda ekranda gorunur.
  if (cfg.apPass.length() < 8) { cfg.apPass = randomSetupPassword(); cfg.apGenerated = true; saveConfigAtomic(cfg); }
  rtcTrusted = prefs.getBool("rtcok", false);
  if (rtcTrusted) timeSource = TS_RTC;
  qDone = prefs.getUInt("qdone", 0);
}

// ---------------- Kalici okutma kuyrugu (LittleFS) ----------------
bool qValid(const QRec &r) { return r.magic == QMAGIC && r.uidLen > 0 && r.uidLen <= 20; }
bool qSaveDone(uint32_t seq) { return prefs.putUInt("qdone", seq) == sizeof(uint32_t); }
// Ilk okunan kart sahibi, kuyruk kaydi sonuclanana kadar NVS'te seq ile birlikte tutulur.
// Boylece retry/backoff ve elektrik kesintisi sonrasi eski okutma yeni kart sahibine yonlenmez.
String qOwnerLoad(uint32_t seq) {
  xSemaphoreTake(qMutex, portMAX_DELAY);
  String value = prefs.getString("qowner", "");
  xSemaphoreGive(qMutex);
  String prefix = String(seq) + "|";
  return value.startsWith(prefix) ? value.substring(prefix.length()) : String();
}
bool qOwnerSave(uint32_t seq, const String &owner) {
  if (!owner.length()) return false;
  String value = String(seq) + "|" + owner;
  xSemaphoreTake(qMutex, portMAX_DELAY);
  String current = prefs.getString("qowner", "");
  bool ok = current == value || prefs.putString("qowner", value) == value.length();
  xSemaphoreGive(qMutex);
  return ok;
}
// Gecici kuyruk dosyasi tam ve dogru yazildiysa eski dosyanin yerine konur. Herhangi bir yazma hatasinda
// eski kuyruk korunur. Silme sonrasi adlandirma basarisiz olursa tmp kalir; acilistaki qInit onu geri alir,
// bu sirada yeni kayit eklenip tmp'nin silinmemesi icin dosya sistemi yeniden baslatmaya kadar kapatilir.
bool qReplaceQueue(uint32_t expectedRecords) {
  File check = LittleFS.open("/queue.tmp", "r");
  size_t size = check ? check.size() : SIZE_MAX;
  if (check) check.close();
  if (size != expectedRecords * sizeof(QRec)) { LittleFS.remove("/queue.tmp"); return false; }
  if (LittleFS.exists("/queue.bin") && !LittleFS.remove("/queue.bin")) { LittleFS.remove("/queue.tmp"); return false; }
  if (!LittleFS.rename("/queue.tmp", "/queue.bin") && !LittleFS.rename("/queue.tmp", "/queue.bin")) { fsOk = false; return false; }
  return true;
}
// Islenmemis (seq > qDone) tam kayitlar yeni dosyaya alinir. NVS'e yazmaz: tmp yazilirken ya da degistirilirken
// elektrik kesilirse acilista ya eski dosya (tmp silinir) ya yeni dosya (tmp adlandirilir) kullanilir.
bool qCompact() {
  File in = LittleFS.open("/queue.bin", "r");
  File out = LittleFS.open("/queue.tmp", "w");
  if (!in || !out) { if (in) in.close(); if (out) out.close(); LittleFS.remove("/queue.tmp"); return false; }
  QRec r; uint32_t n = 0; bool ok = true;
  while (in.read((uint8_t *)&r, sizeof(r)) == sizeof(r)) {
    if (!qValid(r) || r.id <= qDone) continue;
    if (out.write((const uint8_t *)&r, sizeof(r)) != sizeof(r)) { ok = false; break; }
    n++;
  }
  in.close(); out.flush(); out.close();
  if (!ok) { LittleFS.remove("/queue.tmp"); return false; }
  if (!qReplaceQueue(n)) return false;
  qTotal = n; qHead = 0;
  return true;
}
// 2.0 on surum kuyrugu (magic 0xA5, ilerleme "qhead" indeksi) v3 bicimine (seq) donusturulur.
// Basarisiz donusumde eski dosya ve qhead korunur; karisik bicim olusmasin diye yeni kayit kabul edilmez.
bool qMigrateV2() {
  File in = LittleFS.open("/queue.bin", "r");
  if (!in) { prefs.remove("qhead"); return true; }
  QRec r; bool v2 = false;
  while (in.read((uint8_t *)&r, sizeof(r)) == sizeof(r)) if (r.magic == QMAGIC_V2) { v2 = true; break; }
  if (!v2) { in.close(); prefs.remove("qhead"); return true; }
  uint32_t head = prefs.getUInt("qhead", 0), index = 0, seq = qDone, n = 0;
  bool ok = true;
  File out = LittleFS.open("/queue.tmp", "w");
  if (!out) { in.close(); return false; }
  in.seek(0);
  while (in.read((uint8_t *)&r, sizeof(r)) == sizeof(r)) {
    if (index++ < head || r.magic != QMAGIC_V2 || r.uidLen == 0 || r.uidLen > 20) continue;
    r.magic = QMAGIC; r.id = ++seq;
    if (out.write((const uint8_t *)&r, sizeof(r)) != sizeof(r)) { ok = false; break; }
    n++;
  }
  in.close(); out.flush(); out.close();
  if (!ok) { LittleFS.remove("/queue.tmp"); return false; }
  if (!qReplaceQueue(n)) return false;
  prefs.remove("qhead");
  return true;
}
void qInit() {
  if (!fsOk) return;
  // queue.bin yoksa tmp tek kopyadir; geri adlandirilamazsa yeni queue.bin onu golgelemesin diye yazma kapatilir.
  if (!LittleFS.exists("/queue.bin") && LittleFS.exists("/queue.tmp")) { if (!LittleFS.rename("/queue.tmp", "/queue.bin")) { fsOk = false; return; } }
  else if (LittleFS.exists("/queue.tmp")) LittleFS.remove("/queue.tmp");
  if (!qMigrateV2()) { fsOk = false; return; }
  File f = LittleFS.open("/queue.bin", "r");
  size_t size = f ? f.size() : 0;
  qTotal = size / sizeof(QRec); qHead = qTotal;
  uint32_t maxSeq = qDone, index = 0; QRec r;
  if (f) {
    while (f.read((uint8_t *)&r, sizeof(r)) == sizeof(r)) {
      if (qValid(r)) { if (r.id > maxSeq) maxSeq = r.id; if (r.id > qDone && qHead == qTotal) qHead = index; }
      index++;
    }
    f.close();
  }
  qNextSeq = maxSeq + 1;
  // Elektrik kesintisinde yarim yazilmis son kayit: tam kayitlar yeni dosyaya alinir, sonraki eklemeler hizali kalir.
  // Duzeltilemezse eklemeler hizasiz olmasin diye kuyruk yeniden baslatmaya kadar yazmaya kapatilir.
  if (size % sizeof(QRec) && !qCompact()) fsOk = false;
}
uint16_t queuePending() { return uint16_t(qTotal - qHead); }
// Kayda sira numarasi (r.id) burada verilir.
bool qPush(QRec &r) {
  bool ok = false;
  xSemaphoreTake(qMutex, portMAX_DELAY);
  if (fsOk && queuePending() < QUEUE_MAX) {
    if (qTotal >= QUEUE_FILE_MAX && qHead > 0) qCompact();   // basarisizsa eski dosya korunur
  }
  if (fsOk && queuePending() < QUEUE_MAX) {
    r.magic = QMAGIC; r.id = qNextSeq;
    File f = LittleFS.open("/queue.bin", "a");
    size_t size = 0;
    if (f) { ok = f.write((const uint8_t *)&r, sizeof(r)) == sizeof(r); size = f.size(); f.close(); }
    if (ok) { qTotal++; qNextSeq++; }
    else if (size % sizeof(QRec) && !qCompact()) fsOk = false;   // hizalanamayan kuyruga yazma durdurulur
  }
  xSemaphoreGive(qMutex);
  return ok;
}
bool qPeek(QRec &r) {
  bool ok = false;
  xSemaphoreTake(qMutex, portMAX_DELAY);
  while (fsOk && qHead < qTotal) {
    File f = LittleFS.open("/queue.bin", "r");
    if (!f) break;
    // Okuma/konumlama hatasi gecici olabilir: kayit atlanmaz, sonraki denemede yeniden okunur.
    bool readOk = f.seek(qHead * sizeof(QRec)) && f.read((uint8_t *)&r, sizeof(r)) == sizeof(r);
    f.close();
    if (!readOk) { ok = false; break; }
    ok = true;
    if (qValid(r) && r.id > qDone) break;
    ok = false; qHead++;   // bozuk ya da zaten islenmis kayit atlanir
  }
  xSemaphoreGive(qMutex);
  return ok;
}
// Kayit gonderildi ya da basarisiz listesine alindi: once ilerleme (qdone) kalici yazilir.
bool qPop(uint32_t seq) {
  xSemaphoreTake(qMutex, portMAX_DELAY);
  if (seq > qDone && !qSaveDone(seq)) { xSemaphoreGive(qMutex); return false; }
  if (seq > qDone) qDone = seq;
  if (prefs.getString("qowner", "").startsWith(String(seq) + "|")) prefs.remove("qowner");
  if (qHead < qTotal) qHead++;
  // Dosya silinemezse sayaclar sifirlanmaz: yeni kayitlar dosyanin gercek sonuna eklenip dogru okunur.
  if (qHead >= qTotal && LittleFS.remove("/queue.bin")) { qHead = 0; qTotal = 0; }
  xSemaphoreGive(qMutex);
  return true;
}
// Gonderilemeyen okutma: kuyrugu tikamasin diye ayri listeye alinir (Admin sayfasinda gorunur).
// Rotasyon sirasinda kalan failed.tmp, failed.txt yoksa tek kopyadir: once geri adlandirilir, asla "w" ile acilmaz.
bool failedRecover() {
  if (LittleFS.exists("/failed.txt") || !LittleFS.exists("/failed.tmp")) return true;
  return LittleFS.rename("/failed.tmp", "/failed.txt");
}
void countFailed() {
  failedRecover();
  uint16_t n = 0;
  File f = LittleFS.open("/failed.txt", "r");
  if (f) { while (f.available()) if (f.read() == '\n') n++; f.close(); }
  failedCount = n;
}
// Basarisiz kayit kalici yazilamazsa false doner; cagiran kuyruk ilerlemesini (qdone) ilerletmez.
bool addFailed(const QRec &r, const char *reason) {
  xSemaphoreTake(qMutex, portMAX_DELAY);
  if (!failedRecover()) { xSemaphoreGive(qMutex); return false; }
  if (failedCount >= FAILED_MAX) {   // en eski kayitlar silinir
    File in = LittleFS.open("/failed.txt", "r"), out = LittleFS.open("/failed.tmp", "w");
    uint16_t skip = failedCount - FAILED_MAX + 1, n = 0;
    bool rotated = in && out;
    if (rotated) {
      while (in.available()) {
        String line = in.readStringUntil('\n');
        if (skip) { skip--; continue; }
        if (out.print(line) != line.length() || out.print('\n') != 1) { rotated = false; break; }
        n++;
      }
    }
    if (in) in.close();
    if (out) { out.flush(); out.close(); }
    // Eski liste ancak yeni liste tam yazildiysa degistirilir; aksi halde eski kayitlar korunur.
    if (rotated && LittleFS.remove("/failed.txt") && LittleFS.rename("/failed.tmp", "/failed.txt")) failedCount = n;
    else if (!LittleFS.exists("/failed.txt") && LittleFS.exists("/failed.tmp")) {
      if (!LittleFS.rename("/failed.tmp", "/failed.txt")) { xSemaphoreGive(qMutex); return false; }
      failedCount = n;
    } else LittleFS.remove("/failed.tmp");
  }
  File f = LittleFS.open("/failed.txt", "a");
  bool ok = false;
  if (f) {
    char uid[21] = {0}; memcpy(uid, r.uid, r.uidLen);
    char line[64];
    int len = snprintf(line, sizeof(line), "%lu;%s;%s\n", (unsigned long)r.epoch, uid, reason);
    ok = len > 0 && len < (int)sizeof(line) && f.write((const uint8_t *)line, len) == (size_t)len;
    f.flush(); f.close();
    if (ok) failedCount = failedCount + 1;
  }
  xSemaphoreGive(qMutex);
  return ok;
}

// ---------------- Ad onbellegi ve yerel durum ----------------
// Internet yokken ekranda ad gostermek icin daha once cevrimici okutulan kartlarin adi saklanir.
void loadNames() {
  File f = LittleFS.open("/names.txt", "r");
  if (!f) return;
  while (f.available() && nameCount < 150) {
    String line = f.readStringUntil('\n');
    int tab = line.indexOf('\t');
    if (tab <= 0 || tab > 20) continue;
    strlcpy(names[nameCount].uid, line.substring(0, tab).c_str(), 21);
    strlcpy(names[nameCount].name, line.substring(tab + 1).c_str(), 44);
    nameCount++;
  }
  f.close();
  nameNext = nameCount % 150;
}
String nameFor(const char *uid) {
  String out;
  xSemaphoreTake(nameMutex, portMAX_DELAY);
  for (uint8_t i = 0; i < nameCount; i++) if (!strcmp(names[i].uid, uid)) { out = names[i].name; break; }
  xSemaphoreGive(nameMutex);
  return out;
}
void learnName(const char *uid, const String &name) {
  if (!name.length()) return;
  xSemaphoreTake(nameMutex, portMAX_DELAY);
  int at = -1;
  for (uint8_t i = 0; i < nameCount; i++) if (!strcmp(names[i].uid, uid)) { at = i; break; }
  bool changed = at < 0 || strcmp(names[at].name, name.c_str());
  if (changed) {
    if (at < 0) { at = nameNext; nameNext = (nameNext + 1) % 150; if (nameCount < 150) nameCount++; }
    strlcpy(names[at].uid, uid, 21); strlcpy(names[at].name, name.c_str(), 44);
    File f = LittleFS.open("/names.txt", "w");
    if (f) { for (uint8_t i = 0; i < nameCount; i++) { f.print(names[i].uid); f.print('\t'); f.print(names[i].name); f.print('\n'); } f.close(); }
  }
  xSemaphoreGive(nameMutex);
}
LocalState *findState(const char *uid) {
  for (auto &s : states) if (s.uid[0] && !strcmp(s.uid, uid)) return &s;
  return nullptr;
}
LocalState *stateFor(const char *uid) {
  LocalState *s = findState(uid);
  if (s) return s;
  s = &states[stateNext]; stateNext = (stateNext + 1) % 64;
  memset(s, 0, sizeof(*s)); strlcpy(s->uid, uid, 21);
  return s;
}
void forgetState(const char *uid) { LocalState *s = findState(uid); if (s) memset(s, 0, sizeof(*s)); }

// ---------------- Kucuk JSON okuyucu (ek kutuphane olmadan) ----------------
int jsWs(const char *s, int i) { while (s[i] == ' ' || s[i] == '\n' || s[i] == '\r' || s[i] == '\t') i++; return i; }
int jsSkip(const char *s, int i) {
  i = jsWs(s, i);
  char c = s[i];
  if (c == '"') { i++; while (s[i] && s[i] != '"') { if (s[i] == '\\' && s[i + 1]) i++; i++; } return s[i] ? i + 1 : -1; }
  if (c == '{' || c == '[') {
    char close = c == '{' ? '}' : ']';
    i = jsWs(s, i + 1);
    if (s[i] == close) return i + 1;
    for (;;) {
      if (c == '{') { i = jsSkip(s, i); if (i < 0) return -1; i = jsWs(s, i); if (s[i] != ':') return -1; i++; }
      i = jsSkip(s, i); if (i < 0) return -1;
      i = jsWs(s, i);
      if (s[i] == ',') { i = jsWs(s, i + 1); continue; }
      return s[i] == close ? i + 1 : -1;
    }
  }
  if (!c) return -1;
  while (s[i] && !strchr(",}] \n\r\t", s[i])) i++;
  return i;
}
String jsString(const char *s, int i) {
  String out;
  i = jsWs(s, i);
  if (s[i] != '"') return out;
  for (i++; s[i] && s[i] != '"'; i++) {
    if (s[i] != '\\') { out += s[i]; continue; }
    char e = s[++i];
    if (e == 'n') out += '\n'; else if (e == 't') out += '\t'; else if (e == 'r') out += '\r';
    else if (e == 'u') {
      char hex[5] = { s[i + 1], s[i + 2], s[i + 3], s[i + 4], 0 };
      uint32_t cp = strtoul(hex, nullptr, 16); i += 4;
      if (cp >= 0xD800 && cp <= 0xDBFF && s[i + 1] == '\\' && s[i + 2] == 'u') {
        char lo[5] = { s[i + 3], s[i + 4], s[i + 5], s[i + 6], 0 };
        cp = 0x10000 + ((cp - 0xD800) << 10) + (strtoul(lo, nullptr, 16) - 0xDC00); i += 6;
      }
      if (cp < 0x80) out += char(cp);
      else if (cp < 0x800) { out += char(0xC0 | (cp >> 6)); out += char(0x80 | (cp & 0x3F)); }
      else if (cp < 0x10000) { out += char(0xE0 | (cp >> 12)); out += char(0x80 | ((cp >> 6) & 0x3F)); out += char(0x80 | (cp & 0x3F)); }
      else { out += char(0xF0 | (cp >> 18)); out += char(0x80 | ((cp >> 12) & 0x3F)); out += char(0x80 | ((cp >> 6) & 0x3F)); out += char(0x80 | (cp & 0x3F)); }
    } else out += e;
  }
  return out;
}
// Nesnedeki anahtarin degerinin konumu; yoksa -1.
int jsMember(const char *s, int obj, const char *key) {
  if (obj < 0) return -1;
  int i = jsWs(s, obj);
  if (s[i] != '{') return -1;
  i = jsWs(s, i + 1);
  while (s[i] == '"') {
    String k = jsString(s, i);
    i = jsSkip(s, i); if (i < 0) return -1;
    i = jsWs(s, i); if (s[i] != ':') return -1;
    int value = jsWs(s, i + 1);
    if (k == key) return value;
    i = jsSkip(s, value); if (i < 0) return -1;
    i = jsWs(s, i);
    if (s[i] == ',') i = jsWs(s, i + 1); else break;
  }
  return -1;
}
// Firestore belgesinden alan: tur "stringValue" veya "booleanValue".
String fsField(const char *s, int docObj, const char *key, const char *type = "stringValue") {
  int v = jsMember(s, jsMember(s, jsMember(s, docObj, "fields"), key), type);
  if (v < 0) return "";
  if (s[v] == '"') return jsString(s, v);
  int end = jsSkip(s, v);
  return end > v ? String(s + v).substring(0, end - v) : "";
}
String jsonEscape(const String &v) {
  String out;
  for (unsigned i = 0; i < v.length(); i++) {
    char c = v[i];
    if (c == '"' || c == '\\') { out += '\\'; out += c; }
    else if (uint8_t(c) < 0x20) { char b[8]; snprintf(b, sizeof(b), "\\u%04x", c); out += b; }
    else out += c;
  }
  return out;
}
String urlEncode(const String &v) {
  String out; char b[4];
  for (unsigned i = 0; i < v.length(); i++) {
    char c = v[i];
    if (isalnum((unsigned char)c) || c == '-' || c == '_' || c == '.' || c == '~') out += c;
    else { snprintf(b, sizeof(b), "%%%02X", (uint8_t)c); out += b; }
  }
  return out;
}

// ---------------- Firebase (REST, ag gorevi) ----------------
// Ag gorevi yalniz HTTPS isi yapar; ekran, I2C ve seri port ana dongudedir.
struct NetCtx {
  WiFiClientSecure client;
  HTTPClient http;
  String apiKey, project, email, fpass, idToken, refreshToken, base, prefix, host;
  uint32_t tokenUntil = 0, version = 0;
  unsigned long waitFrom = 0, waitMs = 0, backoff = 2000, probeAt = 0;   // bekleme: millis() - waitFrom >= waitMs
  bool probed = false;
  uint8_t conflicts = 0;
};
NetCtx *net = nullptr;
void netWait(unsigned long ms) { net->waitFrom = millis(); net->waitMs = ms; }
bool netReady() { return millis() - net->waitFrom >= net->waitMs; }
void netBackoff() { netWait(net->backoff); net->backoff = min(net->backoff * 2, 60000UL); }
// Sabitlenmis TLS ile gelen Google yanitinin Date basligi: NTP yoksa saat kaynagi olarak ana donguye bildirilir
// (ayarsiz saat hemen, ayarli saat 2 sn'den fazla saptiysa 10 dk'da bir duzeltilir). NTP her zaman onceliklidir.
void noteServerDate(const String &date) {
  if (ntpSynced || httpTimePending) return;
  uint32_t utc = parseHttpDate(date);
  if (!utc) return;
  uint32_t now = nowUtc();
  bool drift = !now || (utc > now ? utc - now : now - utc) > 2;
  if (!clockTrusted() || (drift && (lastHttpTimeMs == 0 || millis() - lastHttpTimeMs >= 600000UL))) {
    httpTimeUtc = utc; httpTimeAtMs = millis(); httpTimePending = true;
  }
}
const char *DATE_HEADER[] = { "Date" };

int httpPost(const String &url, const String &body, String &out, bool auth, const char *type = "application/json") {
  out = "";
  // HTTPClient acik baglantiyi sunucu adina bakmadan yeniden kullanir; baska sunucuya geciste baglanti kapatilir.
  int hostEnd = url.indexOf('/', 8);
  String host = url.substring(8, hostEnd < 0 ? url.length() : hostEnd);
  if (host != net->host) { net->client.stop(); net->host = host; }
  if (!net->http.begin(net->client, url)) return -1;
  net->http.setReuse(true);
  net->http.setTimeout(15000);
  net->http.setConnectTimeout(10000);
  net->http.addHeader("Content-Type", type);
  if (auth) net->http.addHeader("Authorization", "Bearer " + net->idToken);
  net->http.collectHeaders(DATE_HEADER, 1);
  int code = net->http.POST(body);
  if (code > 0) { out = net->http.getString(); noteServerDate(net->http.header("Date")); }
  net->http.end();
  if (code <= 0) { net->client.stop(); net->host = ""; }   // bozuk baglanti bir sonraki istekte yeniden kurulur
  return code;
}
// Saat ayarsizken kimlik/Firestore istegi yapilmadan once Google'a yalniz saat icin kucuk bir GET atilir.
void probeServerTime() {
  String host = "firestore.googleapis.com";
  if (host != net->host) { net->client.stop(); net->host = host; }
  if (!net->http.begin(net->client, "https://firestore.googleapis.com/")) return;
  net->http.setReuse(true);
  net->http.setTimeout(10000);
  net->http.setConnectTimeout(10000);
  net->http.collectHeaders(DATE_HEADER, 1);
  int code = net->http.GET();
  if (code > 0) { net->http.getString(); noteServerDate(net->http.header("Date")); }
  net->http.end();
  if (code <= 0) { net->client.stop(); net->host = ""; }
}
bool authErrorFatal(const String &body) {
  return body.indexOf("INVALID_LOGIN_CREDENTIALS") >= 0 || body.indexOf("INVALID_PASSWORD") >= 0 || body.indexOf("EMAIL_NOT_FOUND") >= 0
    || body.indexOf("USER_DISABLED") >= 0 || body.indexOf("INVALID_EMAIL") >= 0 || body.indexOf("TOO_MANY_ATTEMPTS") >= 0
    || body.indexOf("API_KEY_INVALID") >= 0 || body.indexOf("INVALID_REFRESH_TOKEN") >= 0 || body.indexOf("TOKEN_EXPIRED") >= 0;
}
// Kimlik: once yenileme anahtari (securetoken), olmazsa e-posta/sifre (identitytoolkit). 0 = basarili.
int ensureToken() {
  uint32_t now = nowUtc();
  if (net->idToken.length() && now + 300 < net->tokenUntil) return 0;
  String out; int code;
  if (net->refreshToken.length()) {
    code = httpPost("https://securetoken.googleapis.com/v1/token?key=" + net->apiKey, "grant_type=refresh_token&refresh_token=" + urlEncode(net->refreshToken), out, false, "application/x-www-form-urlencoded");
    if (code == 200) {
      const char *s = out.c_str();
      net->idToken = jsString(s, jsMember(s, 0, "id_token"));
      net->refreshToken = jsString(s, jsMember(s, 0, "refresh_token"));
      net->tokenUntil = now + jsString(s, jsMember(s, 0, "expires_in")).toInt();
      if (net->idToken.length()) return 0;
    }
    if (code <= 0 || code >= 500) return code <= 0 ? -1 : code;
    net->refreshToken = "";   // yenileme reddedildi: sifreyle yeniden giris
  }
  String body = "{\"email\":\"" + jsonEscape(net->email) + "\",\"password\":\"" + jsonEscape(net->fpass) + "\",\"returnSecureToken\":true}";
  code = httpPost("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + net->apiKey, body, out, false);
  body = "";
  if (code == 200) {
    const char *s = out.c_str();
    net->idToken = jsString(s, jsMember(s, 0, "idToken"));
    net->refreshToken = jsString(s, jsMember(s, 0, "refreshToken"));
    net->tokenUntil = now + jsString(s, jsMember(s, 0, "expiresIn")).toInt();
    return net->idToken.length() ? 0 : 500;
  }
  if (code > 0 && code < 500 && authErrorFatal(out)) return 400;
  return code <= 0 ? -1 : code;
}
String fsStr(const char *k, const String &v) { return "\"" + String(k) + "\":{\"stringValue\":\"" + jsonEscape(v) + "\"}"; }

// Son processScan commit HTTP kodu (commit yapilmadiysa 0). Yalniz netTask gorevinden kullanilir.
int lastCommitCode = 0;
// Ayni kayitta commit 400/404 bu kadar cevrim tekrarlanirsa kayit basarisiz listesine alinir.
constexpr uint8_t BAD_COMMIT_CYCLES = 3;
Outcome httpOutcome(int code) {
  if (code == 401) return OUT_UNAUTH;
  if (code == 403) return OUT_DENIED;
  if (code == 400 || code == 404) return OUT_BAD;   // bu kayda ozgu hata: kuyrugu tikamasin
  if (code == 409 || code == 429 || code == 503 || code == 500) return OUT_RETRY;
  return OUT_NET;
}
// Program tarafindaki decideClock ile ayni karar (src/clock.js).
Decision decide(bool hasEntry, const String &status, const String &eStart, const String &eEnd, bool hasClock, const String &cStart, const String &nowHm) {
  Decision d;
  int now = toMinutes(nowHm);
  if (hasEntry) {
    if (status != "present") { d.action = "blocked"; d.reason = status; return d; }
    int since = now - toMinutes(eEnd);
    if (since < 0) { d.action = "blocked"; d.reason = "manual"; d.start = eStart; d.end = eEnd; return d; }
    if (since < REPEAT_MINUTES) { d.action = "repeat"; d.last = "out"; d.start = eStart; d.end = eEnd; return d; }
    d.action = "extend"; d.start = eStart; d.end = nowHm; return d;
  }
  if (hasClock) {
    int since = now - toMinutes(cStart);
    if (since <= 0 || since < REPEAT_MINUTES) { d.action = "repeat"; d.last = "in"; d.start = cStart; return d; }
    d.action = "out"; d.start = cStart; d.end = nowHm; return d;
  }
  d.action = "in"; d.start = nowHm; return d;
}
// Tek okutmayi Firestore'a yazar: batchGet(kart) + batchGet(ad, gun kaydi, acik giris) + atomik commit.
// Ayni istekler src/device-rest.js icinde emulatorde kurallarla test edilir.
Outcome processScan(const QRec &r, bool forceOffline, NetResult &res, bool &readStage, String &expectedOwner) {
  readStage = true;
  lastCommitCode = 0;
  // Onceki cevrimde sahibi gorulup NVS yazimi basarisiz olduysa once ayni sahibi kalici yaz.
  // Bu tamamlanmadan kart eslemesini yeniden okuyup baska bir sahibe yonelme.
  if (expectedOwner.length() && qOwnerLoad(r.id) != expectedOwner && !qOwnerSave(r.id, expectedOwner)) return OUT_RETRY;
  uint32_t now = nowUtc();
  String uid; for (uint8_t i = 0; i < r.uidLen; i++) uid += r.uid[i];
  memset(&res, 0, sizeof(res)); res.id = r.id; strlcpy(res.uid, uid.c_str(), sizeof(res.uid));
  if (now > r.epoch && now - r.epoch > MAX_REPLAY_S) return OUT_OLD;
  bool offline = forceOffline || (now > r.epoch && now - r.epoch > OFFLINE_AFTER_S);
  res.offline = offline;
  char date[11], hhmm[6]; trDateTime(r.epoch, date, hhmm);
  String out;
  // Firebase Auth ile canlı Firestore batchGet.newTransaction isteğini 403 reddeder.
  // Okumalar transactionsızdır; commit atomiktir ve sahiplik/elle düzeltme güvenliği Firestore kurallarında yeniden doğrulanır.
  int code = httpPost(net->base + ":batchGet", "{\"documents\":[\"" + net->prefix + "/cardUids/" + uid + "\"]}", out, true);
  if (code == 403) return OUT_READ_DENIED;
  if (code != 200) return httpOutcome(code);
  String employeeId, assignedAt; bool mapped = false;
  {
    const char *s = out.c_str();
    int i = jsWs(s, 0);
    if (s[i] != '[') return OUT_NET;
    i = jsWs(s, i + 1);
    while (s[i] == '{') {
      int f = jsMember(s, i, "found"); if (f >= 0) { mapped = true; employeeId = fsField(s, f, "employeeId"); assignedAt = fsField(s, f, "assignedAt", "timestampValue"); }
      i = jsSkip(s, i); if (i < 0) break;
      i = jsWs(s, i); if (s[i] == ',') i = jsWs(s, i + 1);
    }
  }
  readStage = false;
  if (!mapped || !employeeId.length()) { if (expectedOwner.length()) return OUT_MOVED; strlcpy(res.action, "unknown", sizeof(res.action)); return OUT_OK; }
  // Commit yarisi sonrasi yeniden okumada kart baska personele gecmisse eski okutmayi yeni sahibine yonlendirme.
  if (expectedOwner.length() && employeeId != expectedOwner) return OUT_MOVED;
  if (!expectedOwner.length()) { expectedOwner = employeeId; if (!qOwnerSave(r.id, employeeId)) return OUT_RETRY; }
  // Kart okutmadan sonra baskasina verildiyse (assignedAt > okutma ani) kayit yeni sahibine yazilmaz; kurallar da reddeder.
  uint32_t assignedUtc = parseRfc3339(assignedAt, true);
  if (offline && (!assignedUtc || r.epoch < assignedUtc)) return OUT_MOVED;
  String id = employeeId + "_" + date;
  code = httpPost(net->base + ":batchGet", "{\"documents\":[\"" + net->prefix + "/cardDirectory/" + employeeId + "\",\"" + net->prefix + "/entries/" + id
    + "\",\"" + net->prefix + "/clockIns/" + id + "\"]}", out, true);
  if (code != 200) return httpOutcome(code);
  bool hasPerson = false, active = false, hasEntry = false, hasClock = false;
  String name, endDate, status, eStart, eEnd, eCard, eSource, eEdited, cStart, cSource;
  {
    const char *s = out.c_str();
    int i = jsWs(s, 0);
    if (s[i] != '[') return OUT_NET;
    i = jsWs(s, i + 1);
    while (s[i] == '{') {
      int f = jsMember(s, i, "found");
      if (f >= 0) {
        String docName = jsString(s, jsMember(s, f, "name"));
        if (docName.indexOf("/cardDirectory/") >= 0) { hasPerson = true; name = fsField(s, f, "name"); active = fsField(s, f, "active", "booleanValue") == "true"; endDate = fsField(s, f, "endDate"); }
        else if (docName.indexOf("/entries/") >= 0) { hasEntry = true; status = fsField(s, f, "status"); eStart = fsField(s, f, "start"); eEnd = fsField(s, f, "end"); eCard = fsField(s, f, "cardUid"); eSource = fsField(s, f, "source"); eEdited = fsField(s, f, "editedAt", "timestampValue"); }
        else if (docName.indexOf("/clockIns/") >= 0) { hasClock = true; cStart = fsField(s, f, "start"); cSource = fsField(s, f, "source"); }
      }
      i = jsSkip(s, i); if (i < 0) break;
      i = jsWs(s, i); if (s[i] == ',') i = jsWs(s, i + 1);
    }
  }
  strlcpy(res.name, name.c_str(), sizeof(res.name));
  if (!hasPerson || !active || (endDate.length() && endDate <= String(date))) { strlcpy(res.action, "left", sizeof(res.action)); return OUT_OK; }
  Decision d = decide(hasEntry, status, eStart, eEnd, hasClock, cStart, hhmm);
  strlcpy(res.action, d.action.c_str(), sizeof(res.action)); strlcpy(res.start, d.start.c_str(), sizeof(res.start));
  strlcpy(res.end, d.end.c_str(), sizeof(res.end)); strlcpy(res.reason, d.reason.c_str(), sizeof(res.reason)); strlcpy(res.last, d.last.c_str(), sizeof(res.last));
  // Gun okutmadan sonra elle duzeltildiyse (editedAt >= okutma) ya da elle (kartsiz) girildiyse cevrimdisi okutma uzerine yazilmaz.
  if (offline && d.action == "extend") {
    uint32_t editedUtc = parseRfc3339(eEdited);
    if (eSource != "offline" || !eCard.length() || (editedUtc && r.epoch <= editedUtc)) return OUT_EDITED;
  }
  String marks;
  if (offline) {
    char iso[24]; DateTime u(r.epoch);
    snprintf(iso, sizeof(iso), "%04d-%02d-%02dT%02d:%02d:%02dZ", u.year(), u.month(), u.day(), u.hour(), u.minute(), u.second());
    marks = "," + fsStr("source", "offline") + ",\"scanAt\":{\"timestampValue\":\"" + iso + "\"}";
  }
  String writes;
  String clockName = net->prefix + "/clockIns/" + id, entryName = net->prefix + "/entries/" + id;
  if (d.action == "in") {
    writes = "{\"update\":{\"name\":\"" + clockName + "\",\"fields\":{" + fsStr("id", id) + "," + fsStr("employeeId", employeeId) + "," + fsStr("date", date) + ","
      + fsStr("cardUid", uid) + "," + fsStr("start", d.start) + marks + "}},\"updateTransforms\":[{\"fieldPath\":\"at\",\"setToServerValue\":\"REQUEST_TIME\"}],"
      "\"currentDocument\":{\"exists\":false}}";
  } else if (d.action == "out") {
    String inherit = !offline && cSource == "offline" ? "," + fsStr("source", "offline") : "";
    writes = "{\"update\":{\"name\":\"" + entryName + "\",\"fields\":{" + fsStr("id", id) + "," + fsStr("employeeId", employeeId) + "," + fsStr("date", date) + ","
      + fsStr("status", "present") + "," + fsStr("start", d.start) + "," + fsStr("end", d.end) + ",\"rate\":{\"nullValue\":null}," + fsStr("cardUid", uid) + marks + inherit
      + "}},\"currentDocument\":{\"exists\":false}},{\"delete\":\"" + clockName + "\"}";
  } else if (d.action == "extend") {
    writes = "{\"update\":{\"name\":\"" + entryName + "\",\"fields\":{" + fsStr("end", d.end) + "," + fsStr("cardUid", uid) + marks + "}},\"updateMask\":{\"fieldPaths\":[\"end\",\"cardUid\""
      + String(offline ? ",\"source\",\"scanAt\"" : "") + "]},\"currentDocument\":{\"exists\":true}}";
  }
  if (!writes.length()) return OUT_OK;
  code = httpPost(net->base + ":commit", "{\"writes\":[" + writes + "]}", out, true);
  lastCommitCode = code;
  if (code == 200) return OUT_OK;
  // Okuma ile commit arasinda belge degismis olabilir (409 ALREADY_EXISTS/ABORTED, 404 NOT_FOUND,
  // 400 FAILED_PRECONDITION): kuyruktan silme; yeniden oku ve karari yeniden hesapla.
  // 400/404 kalici da olabilir; netTask bunlari kayit basina sinirli sayida cevrimden sonra "bad" yapar.
  if (code == 400 || code == 404 || code == 409) return OUT_RETRY;
  return httpOutcome(code);
}
void sendResult(const NetResult &res) { xQueueSend(resultQ, &res, 0); }
void netTask(void *) {
  net = new NetCtx();
  net->client.setCACert(ROOT_CA);   // yalniz Google kok sertifikalari (GTS R1-R4, GlobalSign R1/R4) kabul edilir
  uint32_t retainedOwnerSeq = 0;
  String retainedOwner;
  uint32_t badCommitSeq = 0; uint8_t badCommitCycles = 0;
  uint32_t failedAddedSeq = 0;   // qPop basarisiz olursa ayni kayit failed listesine ikinci kez yazilmaz
  for (;;) {
    vTaskDelay(pdMS_TO_TICKS(40));
    if (net->version != cfgVersion) {   // ayar degisti: hesabi yeniden oku, oturumu sifirla
      retainedOwnerSeq = 0; retainedOwner = ""; badCommitSeq = 0; badCommitCycles = 0; failedAddedSeq = 0;
      xSemaphoreTake(cfgMutex, portMAX_DELAY);
      net->version = cfgVersion; net->apiKey = cfg.apiKey; net->project = cfg.project; net->email = cfg.email; net->fpass = cfg.fpass;
      xSemaphoreGive(cfgMutex);
      net->idToken = ""; net->refreshToken = ""; net->tokenUntil = 0; netWait(0); net->backoff = 2000;
      net->base = "https://firestore.googleapis.com/v1/projects/" + net->project + "/databases/(default)/documents";
      net->prefix = "projects/" + net->project + "/databases/(default)/documents";
    }
    if (!net->email.length() || !net->fpass.length() || !net->apiKey.length() || !net->project.length()) { netState = NET_NOACCOUNT; continue; }
    if (wifiState != WS_OK || WiFi.status() != WL_CONNECTED) { if (netState == NET_ONLINE) netState = NET_OFFLINE; net->probed = false; continue; }
    // NTP icin baglantidan sonra 30 sn taninir. Saat hala kesin degilse (NTP yok, DS3231 ayarsiz) gonderim beklenir ve
    // dakikada bir Google sunucusunun saati (Date basligi) sorulur.
    if (!ntpSynced && millis() - wifiOkSince < 30000) continue;
    if (!clockTrusted()) {
      if (!httpTimePending && (!net->probed || millis() - net->probeAt >= TIME_PROBE_MS)) { net->probed = true; net->probeAt = millis(); probeServerTime(); }
      continue;
    }
    if (!netReady()) continue;
    int auth = ensureToken();
    if (auth == 400) { netState = NET_AUTH; netWait(300000); continue; }   // yanlis sifre: 5 dk sonra tekrar
    if (auth != 0) { netState = NET_OFFLINE; netBackoff(); continue; }
    QRec r;
    if (!qPeek(r)) { if (netState != NET_DENIED || netReady()) netState = NET_ONLINE; vTaskDelay(pdMS_TO_TICKS(200)); continue; }
    NetResult res; bool readStage = true, forceOffline = false;
    String expectedOwner = retainedOwnerSeq == r.id ? retainedOwner : qOwnerLoad(r.id);
    retainedOwnerSeq = r.id; retainedOwner = expectedOwner;
    Outcome o = OUT_NET;
    // Transactionsiz REST okumalarinda commit oncesi durum degisebilir. En cok uc kez bastan oku ve karari yeniden hesapla.
    for (uint8_t attempt = 0; attempt < 3; attempt++) {
      o = processScan(r, forceOffline, res, readStage, expectedOwner);
      if (expectedOwner.length()) retainedOwner = expectedOwner;
      if (o == OUT_DENIED && !res.offline && !readStage) { forceOffline = true; vTaskDelay(pdMS_TO_TICKS(100)); continue; }
      if ((o == OUT_RETRY || (o == OUT_DENIED && !readStage)) && attempt < 2) { vTaskDelay(pdMS_TO_TICKS(100)); continue; }
      break;
    }
    // Commit 400/404 her cevrimde tekrarliyorsa kayda ozgu kalici hatadir: kuyrugu gunlerce tikamasin.
    if (o == OUT_RETRY && (lastCommitCode == 400 || lastCommitCode == 404)) {
      if (badCommitSeq != r.id) { badCommitSeq = r.id; badCommitCycles = 0; }
      if (++badCommitCycles >= BAD_COMMIT_CYCLES) o = OUT_BAD;
    }
    const char *failReason = nullptr;
    switch (o) {
      case OUT_OK:
        if (!strcmp(res.action, "in") || !strcmp(res.action, "out") || !strcmp(res.action, "extend") || !strcmp(res.action, "repeat") || !strcmp(res.action, "blocked") || !strcmp(res.action, "left"))
          learnName(res.uid, readerText(res.name));
        if (!qPop(r.id)) { netState = NET_OFFLINE; netBackoff(); break; }
        retainedOwnerSeq = 0; retainedOwner = ""; sendResult(res); netState = NET_ONLINE; net->backoff = 2000; net->conflicts = 0;
        break;
      case OUT_OLD: failReason = "old"; break;
      case OUT_BAD: failReason = "bad"; break;
      case OUT_MOVED: failReason = "moved"; break;     // kart okutmadan sonra baskasina gecmis
      case OUT_EDITED: failReason = "edited"; break;   // gun okutmadan sonra elle duzeltilmis
      case OUT_READ_DENIED:   // hesap kart sahibini bile okuyamiyor: kayitlar bekler, hesap yetkisi duzeltilmeli
        netState = NET_DENIED; netWait(60000);
        break;
      case OUT_DENIED:
        if (failedAddedSeq != r.id) {
          if (!addFailed(r, "denied")) { netState = NET_OFFLINE; netBackoff(); break; }
          failedAddedSeq = r.id;
        }
        if (!qPop(r.id)) { netState = NET_OFFLINE; netBackoff(); break; }
        retainedOwnerSeq = 0; retainedOwner = ""; strlcpy(res.action, "denied", sizeof(res.action)); sendResult(res); netState = NET_ONLINE;
        break;
      case OUT_UNAUTH:
        net->idToken = ""; net->tokenUntil = 0; netWait(500);
        break;
      case OUT_RETRY:
        if (++net->conflicts > 5) { net->conflicts = 0; netBackoff(); }
        else netWait(700);
        break;
      case OUT_NET:
        netState = NET_OFFLINE; netBackoff();
        break;
    }
    if (failReason) {
      if (failedAddedSeq != r.id) {
        if (!addFailed(r, failReason)) { netState = NET_OFFLINE; netBackoff(); continue; }
        failedAddedSeq = r.id;
      }
      if (!qPop(r.id)) { netState = NET_OFFLINE; netBackoff(); continue; }
      retainedOwnerSeq = 0; retainedOwner = ""; strlcpy(res.action, "failed", sizeof(res.action)); sendResult(res); if (o != OUT_OLD) netState = NET_ONLINE;
    }
  }
}

// ---------------- Wi-Fi ve yedek kurulum agi ----------------
void startStation() {
  dns.stop(); server.stop();
  if (!cfg.ssid.length()) { WiFi.disconnect(true); WiFi.mode(WIFI_OFF); wifiState = WS_OFF; return; }
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(cfg.ssid.c_str(), cfg.wpass.length() ? cfg.wpass.c_str() : nullptr);
  wifiState = WS_CONNECTING; wsSince = millis();
}
String htmlEscape(const String &v) {
  String out;
  for (unsigned i = 0; i < v.length(); i++) {
    char c = v[i];
    if (c == '&') out += "&amp;"; else if (c == '<') out += "&lt;"; else if (c == '>') out += "&gt;"; else if (c == '"') out += "&quot;"; else if (c == '\'') out += "&#39;"; else out += c;
  }
  return out;
}
const char PORTAL_STYLE[] PROGMEM = "<meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Açık Personel Takip Kart Okuyucu</title>"
  "<style>body{font-family:Arial,sans-serif;background:#f5f5f5;margin:0;color:#222}main{max-width:460px;margin:auto;padding:18px}"
  "h1{font-size:20px;margin:6px 0 4px}p{font-size:14px;line-height:1.5;color:#555}.card{background:#fff;border-radius:12px;padding:16px;box-shadow:0 2px 10px #0001;margin:14px 0}"
  "label{display:block;font-weight:bold;font-size:14px;margin:12px 0 6px}select,input{width:100%;box-sizing:border-box;font-size:16px;padding:12px;border:1px solid #ccc;border-radius:8px}"
  "button{width:100%;margin-top:16px;font-size:17px;font-weight:bold;padding:14px;border:0;border-radius:8px;background:#ed1c24;color:#fff}"
  ".row{display:flex;justify-content:space-between;font-size:14px;padding:5px 0;border-bottom:1px solid #eee}.ok{color:#167a43}.err{color:#b7171e}a{color:#b7171e}</style>";
void sendPortalPage(const String &body) {
  String page = "<!doctype html><html lang='tr'><head>" + String(FPSTR(PORTAL_STYLE)) + "</head><body><main><h1>Açık Personel Takip Kart Okuyucu</h1>" + body + "</main></body></html>";
  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "text/html; charset=utf-8", page);
}
void portalRoot() {
  portalActivity = millis();
  if (server.hasArg("yenile")) WiFi.scanNetworks(true);
  String body = "<p>Cihazın bağlanacağı Wi-Fi ağını seçin ve şifresini yazın. Kart okutma bu sırada da çalışır; okutmalar cihazda saklanır.</p><div class='card'>";
  body += "<div class='row'><span>Yazılım</span><b>" FW_VERSION "</b></div>";
  body += "<div class='row'><span>Kayıtlı ağ</span><b>" + (cfg.ssid.length() ? htmlEscape(cfg.ssid) : String("—")) + "</b></div>";
  body += "<div class='row'><span>Gönderilecek okutma</span><b>" + String(queuePending()) + "</b></div></div>";
  body += "<form class='card' method='post' action='/kaydet'><label for='ssid'>Wi-Fi ağı</label><select id='ssid' name='ssid'>";
  int n = WiFi.scanComplete();
  if (n > 0) {
    for (int i = 0; i < n && i < 25; i++) {
      String name = WiFi.SSID(i);
      if (!name.length()) continue;
      bool dup = false; for (int j = 0; j < i; j++) if (WiFi.SSID(j) == name) dup = true;
      if (dup) continue;
      body += "<option value='" + htmlEscape(name) + "'" + (name == cfg.ssid ? " selected" : "") + ">" + htmlEscape(name) + " (" + String(WiFi.RSSI(i)) + " dBm)</option>";
    }
  }
  body += "<option value=''>Diğer (aşağıya yazın)</option></select>";
  if (n == WIFI_SCAN_RUNNING) body += "<p>Ağlar aranıyor… Birkaç saniye sonra <a href='/'>sayfayı yenileyin</a>.</p>";
  else body += "<p><a href='/?yenile=1'>Ağları yeniden ara</a></p>";
  body += "<label for='ssid2'>Ağ listede yoksa adını yazın</label><input id='ssid2' name='ssid2' maxlength='32' autocomplete='off'>";
  body += "<label for='pass'>Wi-Fi şifresi</label><input id='pass' name='pass' type='password' maxlength='63' autocomplete='off' placeholder='Şifresiz ağ için boş bırakın'>";
  body += "<button type='submit'>Kaydet ve Bağlan</button></form>";
  body += "<p>Bu sayfa kayıtlı şifreleri göstermez. Cihaz hesabı yalnız Admin sayfasından USB ile değiştirilir.</p>";
  sendPortalPage(body);
}
bool printableAscii(const String &v) { for (unsigned i = 0; i < v.length(); i++) if (v[i] < 0x20 || v[i] > 0x7e) return false; return true; }
bool noControl(const String &v) { for (unsigned i = 0; i < v.length(); i++) if (uint8_t(v[i]) < 0x20 || v[i] == 0x7f) return false; return true; }
void portalSave() {
  portalActivity = millis();
  String ssid = server.arg("ssid2"); ssid.trim();
  if (!ssid.length()) ssid = server.arg("ssid");
  String pass = server.arg("pass");
  String error;
  if (!ssid.length() || ssid.length() > 32 || !noControl(ssid)) error = "Wi-Fi adı 1–32 karakter olmalı.";
  else if (pass.length() && (pass.length() < 8 || pass.length() > 63 || !printableAscii(pass))) error = "Wi-Fi şifresi 8–63 karakter olmalı ve Türkçe harf içermemeli.";
  if (error.length()) { sendPortalPage("<div class='card'><p class='err'>" + error + "</p><p><a href='/'>Geri dön</a></p></div>"); return; }
  xSemaphoreTake(cfgMutex, portMAX_DELAY);
  Config next = cfg; next.ssid = ssid; next.wpass = pass;
  bool ok = saveConfigAtomic(next);
  if (ok) { cfg = next; cfgVersion = cfgVersion + 1; }
  xSemaphoreGive(cfgMutex);
  pass = ""; next.wpass = ""; next.fpass = "";
  if (!ok) { sendPortalPage("<div class='card'><p class='err'>Kaydedilemedi (hafıza hatası). Tekrar deneyin.</p></div>"); return; }
  sendPortalPage("<div class='card'><p class='ok'><b>Kaydedildi.</b></p><p>Cihaz şimdi <b>" + htmlEscape(ssid) + "</b> ağına bağlanıyor. Bu sayfayı kapatabilirsiniz. "
    "Cihaz ekranında Wi-Fi işareti yeşil olunca kurulum tamamdır. Bağlanamazsa 2 dakika sonra kurulum ağı yeniden açılır.</p></div>");
  portalSaveAt = millis(); portalSavePending = true;   // sayfa telefona ulassin diye 2,5 sn sonra kurulum agi kapanir
}
void portalRedirect() { portalActivity = millis(); server.sendHeader("Location", "http://192.168.4.1/", true); server.send(302, "text/plain", ""); }
void beginSavedStation() { if (cfg.ssid.length()) WiFi.begin(cfg.ssid.c_str(), cfg.wpass.length() ? cfg.wpass.c_str() : nullptr); }
// manual: BOOT 5 sn ya da Admin sayfasindan acildi. Kendiliginden acilan kurulum agi kayitli Wi-Fi'yi denemeyi surdurur.
void startSetupAP(bool manual) {
  WiFi.disconnect(false);
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAPConfig(IPAddress(192, 168, 4, 1), IPAddress(192, 168, 4, 1), IPAddress(255, 255, 255, 0));
  WiFi.softAP(SETUP_SSID, cfg.apPass.c_str());
  dns.setErrorReplyCode(DNSReplyCode::NoError);
  dns.start(53, "*", IPAddress(192, 168, 4, 1));
  static bool routes = false;
  if (!routes) {
  routes = true;
  server.on("/", HTTP_GET, portalRoot);
  server.on("/kaydet", HTTP_POST, portalSave);
  server.on("/generate_204", portalRedirect); server.on("/gen_204", portalRedirect);
  server.on("/hotspot-detect.html", portalRedirect); server.on("/connecttest.txt", portalRedirect);
  server.on("/ncsi.txt", portalRedirect); server.on("/fwlink", portalRedirect);
  server.onNotFound(portalRedirect);
  }
  server.begin();
  WiFi.scanNetworks(true);
  setupManual = manual;
  wifiState = WS_SETUP; portalActivity = millis(); portalSavePending = false;
  setupSince = setupRetryAt = millis();
  if (!manual) beginSavedStation();
  show(SCR_SETUP);
  playPattern(BEEP_INFO, 2);
}
// Kurulum modundan cikis: kurulum agi kapanir, ekran (sifre dahil) bekleme ekranina doner.
void leaveSetup() { startStation(); show(SCR_READY); }
void wifiTask() {
  unsigned long now = millis();
  switch (wifiState) {
    case WS_OFF: break;
    case WS_CONNECTING:
      if (WiFi.status() == WL_CONNECTED) {
        wifiState = WS_OK; wifiOkSince = now;
        sntp_set_time_sync_notification_cb(onNtpSync);
        configTime(0, 0, "pool.ntp.org", "time.google.com");
        if (screen == SCR_READY) drawStatusLine();
      } else if (now - wsSince > WIFI_FAIL_MS) startSetupAP(false);
      break;
    case WS_OK:
      if (WiFi.status() != WL_CONNECTED) { wifiState = WS_CONNECTING; wsSince = now; if (screen == SCR_READY) drawStatusLine(); }
      break;
    case WS_SETUP: {
      dns.processNextRequest();
      server.handleClient();
      if (portalSavePending && now - portalSaveAt >= 2500) { portalSavePending = false; leaveSetup(); break; }
      // Kendiliginden acildiysa kayitli Wi-Fi geri gelince kurulum agi hemen kapanir (okutmalar beklemesin).
      if (!setupManual && cfg.ssid.length() && WiFi.status() == WL_CONNECTED) {
        dns.stop(); server.stop(); WiFi.softAPdisconnect(true); WiFi.mode(WIFI_STA);
        wifiState = WS_CONNECTING; wsSince = now;   // bir sonraki turda WS_OK + NTP
        show(SCR_READY);
        break;
      }
      if (!setupManual && cfg.ssid.length() && WiFi.status() != WL_CONNECTED && now - setupRetryAt >= SETUP_STA_RETRY_MS) {
        setupRetryAt = now; WiFi.disconnect(false); beginSavedStation();
      }
      // Bos kalma sayfa isteklerine gore olculur (telefonun aga bagli kalmasi yetmez); ayrica en uzun sure siniri vardir.
      bool idle = now - portalActivity >= SETUP_IDLE_MS;
      bool expired = now - setupSince >= (setupManual ? SETUP_MANUAL_MAX_MS : SETUP_AUTO_MAX_MS);
      if (expired || (idle && (setupManual || cfg.ssid.length()))) leaveSetup();
      break;
    }
  }
}

// ---------------- Durum satirlari (USB) ----------------
String pct(const String &v) {
  String out; char b[4];
  for (unsigned i = 0; i < v.length(); i++) {
    char c = v[i];
    if (isalnum((unsigned char)c) || c == '.' || c == '_' || c == '-') out += c;
    else { snprintf(b, sizeof(b), "%%%02X", (uint8_t)c); out += b; }
  }
  return out;
}
void printMode() { Serial.println(wifiConfigured() ? "MODE:WIFI" : "MODE:USB"); }
void printStatus() {
  const char *w = wifiState == WS_OFF ? "off" : wifiState == WS_CONNECTING ? "connecting" : wifiState == WS_OK ? "ok" : "setup";
  const char *n = netState == NET_ONLINE ? "online" : netState == NET_AUTH ? "auth" : netState == NET_DENIED ? "denied" : netState == NET_NOACCOUNT ? "noaccount" : "offline";
  char t[20] = "";
  if (rtcOk) { DateTime d = rtc.now(); snprintf(t, sizeof(t), "%04d-%02d-%02d %02d:%02d", d.year(), d.month(), d.day(), d.hour(), d.minute()); }
  const char *ts = !clockTrusted() ? "none" : timeSource == TS_NTP ? "ntp" : timeSource == TS_HTTP ? "http" : timeSource == TS_USB ? "usb" : "rtc";
  Serial.printf("STATUS:fw=%s;mode=%s;wifi=%s;net=%s;queue=%u;failed=%u;ssid=%s;acct=%s;clock=%s;time=%s;tsrc=%s\n", FW_VERSION, wifiConfigured() ? "wifi" : "usb", w, n,
    queuePending(), failedCount, pct(cfg.ssid).c_str(), pct(cfg.email).c_str(), clockTrusted() ? "ok" : "unset", pct(t).c_str(), ts);
  printMode();
}
void printFailed() {
  xSemaphoreTake(qMutex, portMAX_DELAY);
  File f = LittleFS.open("/failed.txt", "r");
  if (f) { while (f.available()) { String line = f.readStringUntil('\n'); line.trim(); if (line.length()) { Serial.print("FAIL:"); Serial.println(line); } } f.close(); }
  xSemaphoreGive(qMutex);
  Serial.println("FAIL:END");
}

// ---------------- Programdan gelen ekran mesaji ve komutlar ----------------
int hexValue(char c) { return c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : -1; }
String hexDecode(const String &hex) {
  String text;
  for (unsigned i = 0; i + 1 < hex.length(); i += 2) text += char(hexValue(hex[i]) * 16 + hexValue(hex[i + 1]));
  return text;
}
void handleMessage(const String &hex) {
  String text = hexDecode(hex);
  String parts[4]; int count = 0, from = 0;
  for (int i = 0; i <= (int)text.length() && count < 4; i++) {
    if (i == (int)text.length() || text[i] == '\x1f') { parts[count++] = text.substring(from, i); from = i + 1; }
  }
  if (count == 0) return;
  msgKind = parts[0];
  for (int i = 0; i < 3; i++) msgLines[i] = i + 1 < count ? parts[i + 1] : "";
  messageReceived = true;
  lastMsgAt = millis();
  pending.waiting = false;   // PC (ör. Kart Atama) ekrani yonetiyor; cihazin kendi sonucu ustune yazilmaz
  show(SCR_MSG);
  if (msgKind == "in" || msgKind == "out" || msgKind == "ok") playPattern(BEEP_OK, 2);
  else if (msgKind == "info") playPattern(BEEP_INFO, 2);
  else playPattern(BEEP_ERR, 2);
}
// Kurulum komutu: yalniz verilen alanlar degisir. Wi-Fi sifresi ve hesap sifresi hicbir zaman geri yazdirilmaz.
void handleConfig(String *keys, String *values, int count) {
  Config next = cfg;
  for (int i = 0; i < count; i++) {
    const String &k = keys[i]; const String &v = values[i];
    if (k == "ssid") { if (!v.length() || v.length() > 32 || !noControl(v)) { Serial.println("CFG:ERR:ssid"); return; } next.ssid = v; }
    else if (k == "wpass") { String p = v == "-" ? "" : v; if (p.length() && (p.length() < 8 || p.length() > 63 || !printableAscii(p))) { Serial.println("CFG:ERR:wpass"); return; } next.wpass = p; }
    else if (k == "email") { if (v.length() < 3 || v.length() > 100 || v.indexOf('@') < 1 || !printableAscii(v)) { Serial.println("CFG:ERR:email"); return; } next.email = v; }
    else if (k == "fpass") { if (v.length() < 6 || v.length() > 128 || !noControl(v)) { Serial.println("CFG:ERR:fpass"); return; } next.fpass = v; }
    else if (k == "ap") { if (v.length() < 8 || v.length() > 63 || !printableAscii(v)) { Serial.println("CFG:ERR:ap"); return; } next.apPass = v; next.apGenerated = false; }
    else if (k == "key") { bool ok = v.length() >= 20 && v.length() <= 64; for (unsigned j = 0; ok && j < v.length(); j++) ok = isalnum((unsigned char)v[j]) || v[j] == '-' || v[j] == '_'; if (!ok) { Serial.println("CFG:ERR:key"); return; } next.apiKey = v; }
    else if (k == "project") { bool ok = v.length() >= 4 && v.length() <= 40; for (unsigned j = 0; ok && j < v.length(); j++) ok = islower((unsigned char)v[j]) || isdigit((unsigned char)v[j]) || v[j] == '-'; if (!ok) { Serial.println("CFG:ERR:project"); return; } next.project = v; }
  }
  if (next.ssid.length() && (!next.email.length() || !next.fpass.length())) { Serial.println("CFG:ERR:account"); return; }
  // Tum alanlar dogrulandi; ayar tek seferde (iki yuvali NVS) kaydedilir, yarim kalirsa eski ayar gecerli kalir.
  xSemaphoreTake(cfgMutex, portMAX_DELAY);
  bool ok = saveConfigAtomic(next);
  if (ok) { cfg = next; cfgVersion = cfgVersion + 1; }
  xSemaphoreGive(cfgMutex);
  for (int i = 0; i < count; i++) values[i] = "";
  next.wpass = ""; next.fpass = "";
  if (!ok) { Serial.println("CFG:ERR:storage"); return; }
  Serial.println("CFG:OK");
  startStation();
  show(idleScreen());
  printStatus();
}
// IEEE CRC32 (zlib ile ayni; src/device-config.js crc32).
uint32_t crc32Bytes(const uint8_t *data, size_t n) {
  uint32_t c = 0xFFFFFFFFUL;
  for (size_t i = 0; i < n; i++) { c ^= data[i]; for (int k = 0; k < 8; k++) c = (c >> 1) ^ (0xEDB88320UL & (0UL - (c & 1UL))); }
  return ~c;
}
void frameError() { Serial.println("CFG:ERR:frame"); }
constexpr size_t FRAME_TEXT_MAX = 900;
// Komutun kabul ettigi alanlar (src/device-config.js DEVICE_COMMAND_FIELDS ile ayni).
bool frameKeyAllowed(const String &command, const String &key) {
  if (command == "cfg") return key == "ssid" || key == "wpass" || key == "email" || key == "fpass" || key == "ap" || key == "key" || key == "project";
  if (command == "time") return key == "utc";
  return false;
}
bool frameCommandKnown(const String &c) {
  return c == "cfg" || c == "status" || c == "failed" || c == "failclear" || c == "forget" || c == "assign" || c == "setup" || c == "time";
}
// Bilgisayarin saati (USB). NTP her zaman onceliklidir: NTP ile ayarlanmissa reddedilir.
void handleTime(const String &value) {
  bool digits = value.length() == 10;
  for (unsigned i = 0; digits && i < value.length(); i++) digits = isdigit((unsigned char)value[i]);
  uint32_t utc = digits ? strtoul(value.c_str(), nullptr, 10) : 0;
  if (ntpSynced) { Serial.println("CFG:ERR:time"); return; }
  if (!plausibleUtc(utc)) { Serial.println("CFG:ERR:time"); return; }
  setSystemTime(utc); lastRtcToSys = millis();
  if (rtcOk) { rtc.adjust(DateTime(utc + TR_OFFSET)); if (!rtcTrusted) { rtcTrusted = true; prefs.putBool("rtcok", true); } }
  sysTimeTrusted = true; timeSource = TS_USB;
  Serial.println("CFG:OK");
  drawClock(true);
  printStatus();
}
void handleFrame(const String &hex) {
  // Cerceve: 2 bayt uzunluk + 4 bayt CRC32 + metin. Hicbir sey dogrulanmadan uygulanmaz.
  static uint8_t buf[FRAME_TEXT_MAX + 6];
  size_t n = hex.length() / 2;
  if (hex.length() % 2 || n < 6 || n > sizeof(buf)) { frameError(); return; }
  for (size_t i = 0; i < n; i++) {
    int hi = hexValue(hex[2 * i]), lo = hexValue(hex[2 * i + 1]);
    if (hi < 0 || lo < 0) { frameError(); return; }
    buf[i] = uint8_t(hi * 16 + lo);
  }
  size_t len = (size_t(buf[0]) << 8) | buf[1];
  uint32_t crc = (uint32_t(buf[2]) << 24) | (uint32_t(buf[3]) << 16) | (uint32_t(buf[4]) << 8) | buf[5];
  if (len != n - 6 || crc != crc32Bytes(buf + 6, len)) { frameError(); return; }
  String text; text.reserve(len);
  for (size_t i = 0; i < len; i++) { if (!buf[6 + i]) { frameError(); return; } text += char(buf[6 + i]); }
  memset(buf, 0, sizeof(buf));
  String keys[8], values[8]; int count = 0;
  int from = text.indexOf('\x1f');
  String command = from < 0 ? text : text.substring(0, from);
  bool bad = !frameCommandKnown(command);
  while (!bad && from >= 0) {
    int next = text.indexOf('\x1f', from + 1);
    String item = text.substring(from + 1, next < 0 ? text.length() : next);
    int eq = item.indexOf('=');
    if (count >= 8 || eq <= 0 || eq == int(item.length()) - 1) { bad = true; break; }
    String key = item.substring(0, eq);
    if (!frameKeyAllowed(command, key)) { bad = true; break; }
    for (int i = 0; i < count; i++) if (keys[i] == key) bad = true;
    keys[count] = key; values[count] = item.substring(eq + 1); count++;
    from = next;
  }
  text = "";
  if (bad) { for (int i = 0; i < count; i++) values[i] = ""; frameError(); return; }
  if (command == "cfg") handleConfig(keys, values, count);
  else if (command == "time") { if (count == 1) handleTime(values[0]); else frameError(); }
  else if (command == "status") printStatus();
  else if (command == "failed") printFailed();
  else if (command == "failclear") { xSemaphoreTake(qMutex, portMAX_DELAY); LittleFS.remove("/failed.txt"); LittleFS.remove("/failed.tmp"); failedCount = 0; xSemaphoreGive(qMutex); printStatus(); }
  else if (command == "forget") {
    xSemaphoreTake(cfgMutex, portMAX_DELAY);
    Config next = cfg; next.ssid = ""; next.wpass = ""; next.email = ""; next.fpass = "";
    bool ok = saveConfigAtomic(next);
    if (ok) { cfg = next; cfgVersion = cfgVersion + 1; }
    xSemaphoreGive(cfgMutex);
    if (!ok) { Serial.println("CFG:ERR:storage"); return; }
    Serial.println("CFG:OK");
    startStation();
    show(SCR_READY);
    printStatus();
  }
  else if (command == "assign") { assignActive = true; assignAt = millis(); }   // Kart Atama: 15 sn (her istekte yenilenir)
  else if (command == "setup") startSetupAP(true);
}

// ---------------- Okutma (Wi-Fi modu) ----------------
String displayName(const char *uid) { String n = nameFor(uid); return n.length() ? n : String("KART ") + uid; }
void showSaved() {
  String detail = String(pending.guess == 'i' ? "GİRİŞ " : "ÇIKIŞ ") + pending.hhmm + " - GÖNDERİLECEK";
  showMessage("info", "KAYDEDİLDİ", displayName(pending.uid), detail);
}
void showResult(const NetResult &r) {
  String name = r.name[0] ? readerText(r.name) : displayName(r.uid);
  String a = r.action;
  if (a == "in") showMessage("in", "GİRİŞ", name, String(r.start) + "  İYİ ÇALIŞMALAR");
  else if (a == "out" || a == "extend") showMessage("out", "ÇIKIŞ", name, String(r.end) + "  İYİ AKŞAMLAR");
  else if (a == "repeat") showMessage("info", "ZATEN OKUTULDU", name, !strcmp(r.last, "out") ? String("ÇIKIŞ ") + r.end : String("GİRİŞ ") + r.start);
  else if (a == "blocked") showMessage("err", "KAYIT YAPILMADI", name, !strcmp(r.reason, "leave") ? "BUGÜN İZİNLİ" : !strcmp(r.reason, "absent") ? "BUGÜN DEVAMSIZ" : "GÜN ELLE GİRİLMİŞ");
  else if (a == "unknown") showMessage("err", "TANIMSIZ KART", r.uid, "KART KİMSEYE VERİLMEMİŞ");
  else if (a == "left") showMessage("err", "KART GEÇERSİZ", name, "İŞTEN AYRILMIŞ");
  else if (a == "denied") showMessage("err", "YETKİ YOK", name, "KAYIT YAPILMADI");
  else showMessage("err", "KAYIT YAPILMADI", name, "YÖNETİCİYE HABER VERİN");
}
void applyResult(const NetResult &r) {
  String a = r.action;
  // Yerel durum yalniz az onceki (cevrimici) okutmanin kesin sonucuyla duzeltilir; eski kayitlar dokunmaz.
  if (!r.offline && (a == "in" || a == "out" || a == "extend")) {
    LocalState *s = stateFor(r.uid);
    s->state = a == "in" ? 'i' : 'o';
    s->lastMin = toMinutes(a == "in" ? String(r.start) : String(r.end));
    s->day = trDayNumber(nowUtc());
  } else if (a == "unknown" || a == "left" || a == "denied" || (a == "blocked" && !r.offline)) forgetState(r.uid);
  if (pending.active && pending.waiting && pending.id == r.id) { pending.waiting = false; pending.active = false; showResult(r); }
  else if (screen == SCR_READY) drawStatusLine();
}
void handleWifiScan(const String &uid) {
  if (assignActive && millis() - assignAt < ASSIGN_HOLD_MS) { show(SCR_CARD, uid); playPattern(BEEP_SCAN, 1); return; }   // Kart Atama: kaydi PC yapar
  if (!clockTrusted()) { showMessage("err", "SAAT AYARSIZ", displayName(uid.c_str()), "KAYIT YAPILMADI"); return; }
  uint32_t epoch = nowUtc();
  uint32_t day = trDayNumber(epoch); int minute = trMinute(epoch);
  LocalState *s = findState(uid.c_str());
  char hhmm[6]; trDateTime(epoch, nullptr, hhmm);
  if (s && s->day == day && minute >= s->lastMin && minute - s->lastMin < REPEAT_MINUTES) {
    char last[6]; snprintf(last, sizeof(last), "%02d:%02d", s->lastMin / 60, s->lastMin % 60);
    showMessage("info", "ZATEN OKUTULDU", displayName(uid.c_str()), String(s->state == 'i' ? "GİRİŞ " : "ÇIKIŞ ") + last);
    return;
  }
  QRec r = {}; r.magic = QMAGIC; r.uidLen = uid.length() > 20 ? 20 : uid.length(); r.epoch = epoch;   // r.id (seq) qPush verir
  memcpy(r.uid, uid.c_str(), r.uidLen);
  if (!qPush(r)) { showMessage("err", "HAFIZA DOLU", displayName(uid.c_str()), "KAYIT YAPILMADI"); return; }
  // Internet yokken giris/cikis kesin bilinemez: cihaz kendi son bildigine gore tahmin eder, sunucu karari esastir.
  char guess = s && s->day == day && (s->state == 'i' || s->state == 'o') ? 'o' : 'i';
  LocalState *st = stateFor(uid.c_str()); st->day = day; st->lastMin = minute; st->state = guess;
  pending = {}; pending.active = true; pending.id = r.id; strlcpy(pending.uid, uid.c_str(), sizeof(pending.uid));
  pending.guess = guess; strlcpy(pending.hhmm, hhmm, sizeof(pending.hhmm)); pending.at = millis();
  if (wifiState == WS_OK && netState == NET_ONLINE && queuePending() == 1) { pending.waiting = true; show(SCR_CARD, uid); playPattern(BEEP_SCAN, 1); }
  else { pending.active = false; showSaved(); }
}

// ---------------- Kurulum ----------------
void setup() {
  pinMode(BUZZER_PIN, OUTPUT); digitalWrite(BUZZER_PIN, LOW);   // acilista buzzer sessiz
  pinMode(TFT_CS, OUTPUT); digitalWrite(TFT_CS, HIGH);
  pinMode(RFID_SS, OUTPUT); digitalWrite(RFID_SS, HIGH);
  pinMode(BOOT_BUTTON, INPUT_PULLUP);

  Serial.setRxBufferSize(4096);   // kurulum cercevesi (~1,8 KB) ana dongu mesgulken de tasmasin; begin'den once olmali
  Serial.begin(115200);
  delay(200);
  cfgMutex = xSemaphoreCreateMutex(); qMutex = xSemaphoreCreateMutex(); nameMutex = xSemaphoreCreateMutex();
  resultQ = xQueueCreate(8, sizeof(NetResult));

  SPI.begin(PIN_SCK, PIN_MISO, PIN_MOSI);
  tft.initR(TFT_TAB);
  tft.setRotation(1);   // yatay 160x128
  show(SCR_BOOT);

  loadConfig();
  fsOk = LittleFS.begin(true);
  if (fsOk) { qInit(); countFailed(); loadNames(); }

  Wire.begin(RTC_SDA, RTC_SCL);
  rtcOk = rtc.begin();
#if !WOKWI_SIM
  if (rtcOk && rtc.lostPower()) {   // pil bitmis: ekran icin derleme saati, ama internetten ayarlanana kadar okutma kaydedilmez
    rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
    rtcTrusted = false; prefs.putBool("rtcok", false); timeSource = TS_NONE;
  }
#endif
  if (rtcOk) { setSystemTime(rtc.now().unixtime() - TR_OFFSET); lastRtcToSys = millis(); }

  rfid.PCD_Init();
  delay(100);
  readerOk = checkReader();
  delay(500);
  xTaskCreatePinnedToCore(netTask, "net", 16384, nullptr, 1, nullptr, 0);
  startStation();
  if (readerOk) {
    Serial.println("READY");
    show(SCR_READY);
    playPattern(BEEP_SCAN, 1);
  } else {
    Serial.println("ERROR:RC522 bulunamadi. Kablolari ve 3.3V baglantisini kontrol edin.");
    show(SCR_HWERR, "RC522 YOK");
    playPattern(BEEP_HW, 3);
  }
  printMode();
  lastCheckAt = millis();
}

// ---------------- Ana dongu ----------------
void loop() {
  buzzerTask();
  wifiTask();

  static bool inMsg = false, inFrame = false;
  static String msgHex;
  while (Serial.available()) {
    char c = Serial.read();
    if (inMsg || inFrame) {
      char close = inMsg ? '}' : ']';
      if (c == close) { bool frame = inFrame; inMsg = inFrame = false; if (frame) handleFrame(msgHex); else handleMessage(msgHex); msgHex = ""; }
      else if (hexValue(c) >= 0 && msgHex.length() < (inFrame ? 2000u : 600u)) msgHex += c;
      else { if (inFrame) frameError(); inMsg = inFrame = false; msgHex = ""; }   // bozuk mesaj atlanir; bozuk komut bildirilir
      continue;
    }
    if (c == '{') { inMsg = true; msgHex = ""; continue; }
    if (c == '[') { inFrame = true; msgHex = ""; continue; }
    if (messageReceived && (c == 'O' || c == 'E') && millis() - lastMsgAt < MSG_SWALLOW_MS) continue;
    if (c == 'O') { pending.waiting = false; show(SCR_OK); playPattern(BEEP_OK, 2); }
    else if (c == 'E') { pending.waiting = false; show(SCR_ERR); playPattern(BEEP_ERR, 2); }
  }

  unsigned long now = millis();
  // Ag gorevinin sonuclari
  NetResult res;
  while (xQueueReceive(resultQ, &res, 0) == pdTRUE) applyResult(res);
  if (pending.active && pending.waiting && now - pending.at > PENDING_WAIT_MS) { pending.waiting = false; pending.active = false; showSaved(); }

  // NTP ayarlandi: DS3231 Turkiye saatine ayarlanir.
  if (ntpPending) {
    ntpPending = false;
    time_t t = time(nullptr);
    if (plausibleUtc(uint32_t(t))) {
      if (rtcOk) rtc.adjust(DateTime(uint32_t(t) + TR_OFFSET));
      ntpSynced = true; lastNtpAt = now; timeSource = TS_NTP;
      if (!rtcTrusted) { rtcTrusted = true; prefs.putBool("rtcok", true); }
    }
  }
  // NTP yokken Google sunucusunun (sabitlenmis TLS) Date basligi: sistem saati ve DS3231 ayarlanir.
  if (httpTimePending) {
    if (!ntpSynced) {
      uint32_t utc = httpTimeUtc + (now - httpTimeAtMs) / 1000;
      setSystemTime(utc); lastRtcToSys = now; lastHttpTimeMs = now;
      if (rtcOk) { rtc.adjust(DateTime(utc + TR_OFFSET)); if (!rtcTrusted) { rtcTrusted = true; prefs.putBool("rtcok", true); } }
      sysTimeTrusted = true; timeSource = TS_HTTP;
    }
    httpTimePending = false;
  }
  if (assignActive && now - assignAt >= ASSIGN_HOLD_MS) assignActive = false;
  // Internet yokken (2 saattir NTP yok) sistem saati saatte bir DS3231'den duzeltilir: cevrimdisi okutmalar DS3231 saatini kullanir.
  if (rtcOk && rtcTrusted && now - lastRtcToSys > 3600000UL && (!ntpSynced || now - lastNtpAt > 7200000UL)) { lastRtcToSys = now; setSystemTime(rtc.now().unixtime() - TR_OFFSET); }

  // BOOT dugmesi: 5 sn basili kurulum agi; kurulum modunda kisa basis cikar.
  if (digitalRead(BOOT_BUTTON) == LOW) {
    if (!bootDown) { bootDown = true; bootDownAt = now; }
    if (!bootHandled && now - bootDownAt >= BOOT_HOLD_MS && wifiState != WS_SETUP) { bootHandled = true; startSetupAP(true); }
  } else if (bootDown) {
    if (!bootHandled && now - bootDownAt > 50 && now - bootDownAt < 2000 && wifiState == WS_SETUP) leaveSetup();
    bootDown = false; bootHandled = false;
  }

  if ((screen == SCR_OK || screen == SCR_ERR) && now - screenAt > RESULT_SHOW_MS) show(idleScreen());
  if (screen == SCR_MSG && now - screenAt > MSG_SHOW_MS) show(idleScreen());
  if (screen == SCR_CARD && now - screenAt > CARD_WAIT_MS && !pending.waiting) show(idleScreen());
  if (now - lastClockAt >= 250) {
    lastClockAt = now; drawClock();
    static String lastStatus; static uint8_t lastIcon = 255;
    uint16_t color; String st = statusLine(color);
    uint8_t icon = uint8_t(wifiState) * 8 + uint8_t(netState);
    if (screen == SCR_READY && (st != lastStatus || icon != lastIcon)) drawStatusLine();
    if (icon != lastIcon) drawClock(true);
    lastStatus = st; lastIcon = icon;
  }

  // RC522 saglik kontrolu: koparsa hata ver, geri gelirse READY gonder
  if (now - lastCheckAt >= READER_CHECK_MS) {
    lastCheckAt = now;
    bool ok = checkReader();
    if (!ok) { rfid.PCD_Init(); ok = checkReader(); }
    if (ok != readerOk) {
      readerOk = ok;
      if (ok) { Serial.println("READY"); show(idleScreen()); }
      else { Serial.println("ERROR:RC522 bulunamadi. Kablolari ve 3.3V baglantisini kontrol edin.");
             show(SCR_HWERR, "RC522 YOK"); playPattern(BEEP_HW, 3); }
    }
  }
  if (!readerOk) return;

  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return;
  String uid = uidHex(rfid.uid);
  if (uid != lastUid || now - lastReadAt > REPEAT_MS) {
    if (wifiConfigured()) {
      Serial.println("MODE:WIFI");   // PC Kart Okutma sayfasi bu okutmayi kaydetmez (cift kayit olmaz)
      Serial.print("UID:");
      Serial.println(uid);
      handleWifiScan(uid);
    } else {
      Serial.print("UID:");
      Serial.println(uid);
      show(SCR_CARD, uid);
      playPattern(BEEP_SCAN, 1);
    }
  }
  lastUid = uid; lastReadAt = now;
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
}
