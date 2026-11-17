# KONJONKTÜR

Yan ekranda sürekli açık durmak için tasarlanmış, **canlı dünya ve Orta Doğu durum ekranı**.
Tek pencerede: çok dilli haber akışı (otomatik Türkçe çeviri), haber yoğunluk haritası, İsrail siren uyarıları,
bölgedeki askeri uçaklar (ADS-B), depremler, piyasalar ve canlı haber kanalı.

- **Sıfır bağımlılık:** `npm install` yok; yalnızca Node.js 18+.
- **API anahtarı yok:** tüm kaynaklar herkese açık.
- **Simülasyon yok:** ekrandaki her veri gerçek bir kaynaktan gelir; bir kaynak düşerse alt satırda kırmızı görünür.

## Çalıştırma

```bash
node server.js
```

Tarayıcıda `http://localhost:8090` adresini açın.

Windows'ta `baslat.bat` dosyasına çift tıklarsanız sunucuyu başlatır ve Edge'i adres çubuğu olmayan bir uygulama penceresinde açar.
Bu pencereyi yan ekrana taşıyıp `F` tuşuyla tam ekran yapabilirsiniz.

## Ekranda neler var

| Bölüm | İçerik | Kaynak |
|---|---|---|
| Üst bar | İstanbul, Kudüs, Tahran, Riyad, Londra, Washington ve UTC saatleri | tarayıcı |
| Piyasa bandı | Brent, WTI, doğalgaz, altın, USD/TRY, EUR/TRY, BIST100, TA-35, S&P500, DXY, BTC | Yahoo Finance |
| Son dakika bandı | Son 20 dakikadaki kritik Orta Doğu başlıkları; siren varsa kırmızı yanıp söner | aşağıdaki haber kaynakları |
| Durum haritası | Başlıklardaki yer adlarından çıkarılan haber yoğunluğu (3/6/12/24 saat), askeri uçaklar, depremler, sirenler | — |
| Haber akışı | Orta Doğu / Tümü / Dünya / Türkiye / Telegram sekmeleri, arama, konuma göre filtre | RSS, Google News, Telegram |
| Canlı yayın | Al Jazeera, TRT World, TRT Haber, Al Arabiya, i24, France 24, DW, Sky | YouTube |
| Bölge nabzı | Ülke bazında son 6 saatteki haber sayısı ve önceki 6 saate göre eğilim; 24 saatlik hacim grafiği | — |

### Haber kaynakları
Al Jazeera, BBC (Orta Doğu ve Dünya), Guardian, Middle East Eye, France 24, Iran International, DW, Anadolu Ajansı, TRT Haber
ve Google News taramaları (İbranice, Farsça, Arapça, İngilizce, Türkçe).
Türkçe olmayan başlıklar otomatik olarak Türkçeye çevrilir. "Orijinal" kutusu işaretlenirse kaynak dildeki metin de gösterilir.

### Telegram
Herkese açık kanalların `t.me/s/<kanal>` web önizlemesinden okunur; hesap ya da API anahtarı gerekmez.
Bu kanallar doğrulanmamış, hızlı ve bazıları taraflı akışlardır. Bu yüzden ayrı etiketlenir ve son dakika bandını tetiklemez.

### Canlı veri servisleri
- **İsrail sirenleri:** [Tzeva Adom](https://www.tzevaadom.co.il) (aktif uyarılar 5 saniyede bir, geçmiş 90 saniyede bir)
- **Askeri uçaklar:** [adsb.lol](https://adsb.lol) `/v2/mil`. Yalnızca transponder yayını yapan uçaklar görünür; bölgedeki askeri trafiğin çoğu görünmez.
- **Depremler:** [USGS](https://earthquake.usgs.gov) son 24 saat, M2.5+

## Önem derecesi nasıl belirleniyor?
Başlık, beş dilde anahtar kelime listesiyle (`src/classify.js`) etiketlenir:
🔴 saldırı/nükleer · 🟠 askeri/insani · 🔵 diplomasi/ekonomi · ⚪ genel.
Bu kaba bir sezgisel sınıflandırmadır; haberin doğruluğunu değil, başlığın konusunu işaretler.

## Özelleştirme
Tüm kaynaklar, yenileme aralıkları, Telegram kanalları, piyasa sembolleri ve TV kanalları `config.js` dosyasındadır.
Yer adı sözlüğü (`src/gazetteer.js`) haritada hangi yerlerin tanınacağını belirler.

Kısayollar: `F` tam ekran, `/` arama. Üst sağdaki düğmeler: ses, masaüstü bildirimi, ekranı açık tut, tam ekran.

## Yapı

```
server.js            HTTP sunucusu + SSE canlı akış (/api/state, /api/stream)
config.js            kaynaklar ve ayarlar
src/hub.js           arka plan yoklayıcıları, haber zenginleştirme, yayın
src/sources/news.js  RSS + Telegram
src/sources/live.js  sirenler, ADS-B, deprem, piyasalar
src/translate.js     otomatik çeviri (önbellek: data/translations.json)
src/gazetteer.js     çok dilli yer adı → koordinat
src/classify.js      önem derecesi / konu etiketleri
public/              arayüz (Leaflet harita, saf JS)
```

Sunucu yalnızca `127.0.0.1` adresini dinler. Ağdaki başka bir cihazdan erişmek için `HOST=0.0.0.0 node server.js` komutunu kullanın.

## Lisans
MIT
