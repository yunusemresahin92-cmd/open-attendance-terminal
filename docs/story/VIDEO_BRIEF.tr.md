# Video Brief — Türkçe

## Amaç

Açık Personel Takip Terminali'nin hangi ihtiyaçtan çıktığını, hangi teknik sorunların çözüldüğünü ve gerçek donanımda çalışan son durumunu 2–3 dakikalık anlaşılır bir teknik tanıtım videosuyla anlatmak.

## Ana anlatı

1. **Sorun:** Personel giriş-çıkışını kartla kaydetmek, puantaj ve maaş raporunu tek sistemde yönetmek.
2. **İlk çözüm:** Electron + React arayüzü, Firebase ve USB RFID okuyucu.
3. **Gelişim:** Kart envanteri, yetkiler, raporlar, ekran ve gerçek zaman saati.
4. **Zor bölüm:** Bilgisayarsız Wi-Fi çalışması ve internet kesilince kayıt kaybetmemek.
5. **Mühendislik:** Kalıcı kuyruk, güvenli tekrar gönderim, kart yeniden atama ve elle düzeltme yarışları.
6. **Sonuç:** USB/Wi-Fi çalışan ESP32 terminali, web/masaüstü uygulaması ve test edilmiş Firestore kuralları.
7. **Açık kaynak:** Şirket verilerinden ayrılmış, ücretsiz GPL sürümü.
8. **Sonraki adım:** İsteğe bağlı buzzer montajı ve topluluk katkıları.

## Gösterilecek görüntüler

- Temiz demo verisiyle masaüstü uygulaması
- Personel, günlük saatler, kart atama ve rapor ekranları
- ESP32 açılış ekranı
- Kart okutma ve giriş/çıkış mesajı
- Wi-Fi durumu ve çevrimdışı kuyruk göstergesi
- İnternet kapalıyken okutma, bağlantı gelince kuyruğun sıfırlanması
- GitHub repo ana sayfası ve test sonucu

Gerçek personel adı, gerçek kart UID'si, Wi-Fi adı/şifresi, Firebase proje kimliği veya şirket logosu görüntülenmemelidir.

## Teknik stil

- 16:9, 1080p
- Sade koyu arka plan, mavi vurgu rengi
- Türkçe anlatım ve Türkçe altyazı
- Ekrandaki kritik teknik terimlere kısa İngilizce karşılık
- Abartısız, gerçek çalışan görüntülere dayalı anlatım

## Claude/Remotion görevi

`PROJECT_STORY.tr.md`, `ARCHITECTURE.md`, README ve sağlanan ekran kayıtlarını kullan. Kaynak görüntüleri değiştirme. Önce zaman kodlu storyboard ve seslendirme metni üret; onaydan sonra Remotion projesini oluştur. Demo verilerindeki adları ve kart numaralarını videoda okunamayacak şekilde maskele.
