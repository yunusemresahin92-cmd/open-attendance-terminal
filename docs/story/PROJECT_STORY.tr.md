# Proje Hikâyesi

## Başlangıç

Proje, personelin RFID kartla giriş ve çıkış yaptığı, puantajın ve maaş raporlarının tek uygulamada yönetildiği bir sistem ihtiyacıyla başladı.

## Gelişim

1. Electron + React masaüstü arayüzü ve Firebase veri modeli kuruldu.
2. Personel, maaş geçmişi, mesai, eksik saat ve XLSX raporları eklendi.
3. Firestore kurallarıyla menü ve işlem bazlı yetkilendirme geliştirildi.
4. ESP32 + RC522 USB kart okuyucu masaüstü uygulamasına bağlandı.
5. Kart envanteri, atama, iade, kayıp kart ve değiştirilemez kart geçmişi eklendi.
6. Terminale ST7735S ekran ve DS3231 saat desteği eklendi.
7. ESP32, bilgisayara bağlı olmadan Wi-Fi üzerinden kayıt gönderebilir hâle getirildi.
8. İnternet kesintileri için elektrik kesilse bile korunan çevrimdışı kuyruk geliştirildi.
9. Kart iadesi, yeniden atama, elle puantaj düzeltmesi ve eşzamanlı yazım yarışları için fail-closed kontroller eklendi.
10. Gerçek cihaz üzerinde Wi-Fi, saat, Firebase bağlantısı ve boş kuyruk durumu doğrulandı.

## Son durum

- Masaüstü ve web uygulaması çalışıyor.
- ESP32 USB veya Wi-Fi modunda çalışıyor.
- Okutmalar internet yokken saklanıyor ve bağlantı gelince gönderiliyor.
- Test paketi birim testlerini, Firestore kurallarını ve gerçek akış benzetimlerini kapsıyor.
- Buzzer isteğe bağlıdır ve sonraki fiziksel montaj aşaması olarak bırakılmıştır.

## Açık kaynak sürümü

Canlı sistemden hiçbir şirket adı, personel verisi, kart UID'si, Firebase kimliği veya şifre taşınmadı. Kamuya açık sürüm sıfırdan oluşturulan temiz Git geçmişi, genel marka, örnek yapılandırma ve sahte emülatör verisi kullanır.
