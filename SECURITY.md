# Güvenlik Politikası / Security Policy

## Türkçe

Güvenlik açığını herkese açık issue içinde gerçek kimlik bilgileriyle paylaşmayın. GitHub Security Advisory üzerinden özel bildirim kullanın.

Bu repoya şunları **asla eklemeyin**:

- Firebase service-account JSON veya özel anahtar
- Canlı personel/puantaj/maaş verisi
- Wi-Fi, cihaz hesabı veya kurulum ağı şifresi
- Gerçek kart UID listesi
- `.env.local` dosyası

Firebase Web App yapılandırması istemci tarafında kullanılan genel tanımlayıcılardır; yine de API anahtarını kullanılan API'lerle sınırlandırın. Yetkiyi istemci arayüzüne değil, `firestore.rules` kurallarına dayandırın.

## English

Do not report vulnerabilities with real credentials in a public issue. Use a private GitHub Security Advisory.

Never commit:

- Firebase service-account JSON or private keys
- Real employee, payroll or attendance data
- Wi-Fi, terminal-account or setup-network passwords
- Real card UID inventories
- `.env.local`

Firebase Web App configuration contains client-side identifiers; restrict the API key to the required APIs. Authorization must be enforced by `firestore.rules`, not only by the user interface.
