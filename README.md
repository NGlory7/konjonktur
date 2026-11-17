# KONJONKTÜR

[![test](https://github.com/NGlory7/konjonktur/actions/workflows/test.yml/badge.svg)](https://github.com/NGlory7/konjonktur/actions/workflows/test.yml)

Yan ekranda sürekli açık durmak için tasarlanmış, **canlı dünya ve Orta Doğu durum ekranı**.
Tek pencerede: çok dilli haber akışı (otomatik Türkçe çeviri), haber yoğunluk haritası, İsrail siren uyarıları,
hava ve deniz trafiği, depremler, piyasalar, canlı haber kanalı ve **İsrail, İran ve Körfez ülkeleri için
trafik / hava / deniz anomali analizi**.

- **Sıfır bağımlılık:** `npm install` yok; yalnızca Node.js 22.5+ (yerleşik `node:sqlite` ve `WebSocket` için).
- **Anahtarlar:** haber, hava trafiği, siren, deprem ve piyasa verileri anahtarsız. Şehir trafiği için ücretsiz bir
  TomTom, gemi trafiği için ücretsiz bir aisstream.io anahtarı gerekir (`.env`).
- **Simülasyon yok:** ekrandaki her veri gerçek bir kaynaktan gelir; bir kaynak düşerse alt satırda kırmızı görünür.
- **Anomali kapsamı:** baz çizgisi ve anomali tespiti yalnızca İsrail, İran ve Körfez bölgelerinde yapılır.
  Diğer veriler (Türkiye dahil) haritada gösterilir ama anomali üretmez.

## Hava ve deniz trafiği

- **Hava (adsb.fi, anahtarsız):** İsrail, İran (3 bölge), Körfez batı/doğu ve Suudi Arabistan bölgeleri dakikada bir
  taranır; tüm uçaklar haritada (askeriler yeşil ve büyük). Bölge başına havadaki uçak ve askeri uçak sayısı 5 dakikada
  bir SQLite'a yazılır. Hava sahası kapanması gibi durumlar **negatif anomali** (▼) olarak görünür.
  *Kapsam notu:* İran üzerinde ADS-B alıcısı olmadığı için bu bölgeler "kapsam yok" gösterir ve anomali üretmez.
- **Deniz (aisstream.io):** Doğu Akdeniz (İsrail kıyısı), Akabe Körfezi, Kızıldeniz, Basra Körfezi, Hürmüz ve Umman
  Körfezi'ndeki AIS mesajları WebSocket ile canlı alınır. Gemiler tipine göre renklenir (tanker kırmızı, kargo mavi).
  Bölge başına gemi, tanker ve seyirdeki gemi sayısı 5 dakikada bir kaydedilir. Bağlantı 30 dakika açık kalmadan
  sayım kaydedilmez (eksik sayım sahte "boşalma" anomalisi üretmesin diye).
- Başarısız bir sorgu asla 0 olarak kaydedilmez; o turda o bölge atlanır.
- **Bölge ülkeleri her zaman haritada:** İsrail, İran, Suudi Arabistan, BAE, Katar, Kuveyt, Bahreyn ve Umman'da
  tescilli uçaklar (ICAO adres bloğuna göre) ve bu ülkelerin bayrağını taşıyan gemiler (MMSI'nin ülke koduna göre)
  dünyanın neresinde olursa olsun gösterilir; ülke rengi ve bayrağıyla ayrı bir katmanda ("Bölge ülkeleri").
  Uçaklar 15 dakikada bir **OpenSky**'den dünya genelinde bulunur (anonim kota), konumları 3 dakikada bir adsb.fi'den
  güncellenir; 3 dakikadan eski konumlar soluk çizilir. *Not:* tescil ve bayrak ülkesi, işletmeciyle aynı olmayabilir
  (kiralık uçak, kolaylık bayrağı). İran tescilli uçaklar ADS-B ağlarında neredeyse hiç görünmez.
- **Kalkış ve varış meydanı:** çağrı koduna göre **adsbdb.com**'dan alınır ve SQLite'ta 24 saat önbelleğe alınır.
  Bu *tarifeli* rotadır; uçağın konumu rotaya uymuyorsa "doğrulanamadı" yazar. Uçağa tıklayınca kalkış → uçak → varış
  çizgisi ve meydan adları haritaya çizilir. Gemilerde varış yeri, geminin AIS ile kendi bildirdiği hedeftir.

## Trafik analizi

Körfez şehirleri (Riyad, Cidde, Dubai, Abu Dabi, Doha, Kuveyt, Manama, Maskat) 15 dakikada bir
**TomTom Traffic Incidents API**'sinden yoklanır. *TomTom'un İsrail ve İran için yol verisi yok*; bu iki ülke şehir
trafiğinde ölçülemez, hava ve deniz trafiği ile izlenir. Her yoklamada şehir başına toplam sıkışıklık (km),
toplam gecikme (dk), yol kapanması ve kaza sayısı `data/konjonktur.db` (SQLite) dosyasına yazılır.

- **Baz çizgisi:** aynı şehrin *aynı yerel saat dilimindeki* (hafta içi / hafta sonu ayrı) son 28 günlük ölçümlerinin
  medyanı ve MAD'ı. Aykırı değerlerden etkilenmez; sabah ve akşam iş çıkışı yoğunluğu doğal olarak "normal" sayılır.
- **Anomali:** `z = (değer − medyan) / (1.4826 × MAD)`. |z| ≥ 3 olunca anomali açılır, |z| < 1.5 olunca kapanır.
  Başlangıç, bitiş, tepe değeri ve normal değer `traffic_anomalies` tablosunda saklanır. Beklenenden *çok sakin*
  trafik de (sokağa çıkma yasağı, grev, tatil) negatif anomali olarak yakalanır.
- **Olaylar:** her kapanma, kaza ve ağır sıkışıklık ilk ve son görülme zamanıyla `traffic_incidents` tablosunda tutulur;
  haritada çizgi olarak gösterilir. Bir şehre tıklayınca o şehirle eşleşen son haberler yanında listelenir.
- **Dürüstlük kuralı:** bir saat dilimi için 8 ölçüm birikmeden z hesaplanmaz; panelde "baz 3/8" gibi görünür.
  Yani anomali tespiti, ilk kurulumdan sonra birkaç gün içinde saat saat devreye girer.
- **Kapsam:** TomTom kalıcı yol çalışmalarını da "kapanma" sayar (ör. Riyad'da yüzlerce). Bu yüzden ham sayılara değil,
  aynı saatteki normal değere göre sapmaya bakılır.

Kurulum: `developer.tomtom.com` adresinden ücretsiz anahtar al, `.env.example` dosyasını `.env` olarak kopyala
ve `TOMTOM_KEY=` satırını doldur. Anahtarsız çalışırken trafik sekmesi bu talimatı gösterir.

Testler: `npm test` (anomali motoru için birim testleri, Node'un yerleşik test koşucusu).

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
- **Askeri uçaklar:** [adsb.fi](https://adsb.fi) `/v2/mil`. Yalnızca transponder yayını yapan uçaklar görünür; bölgedeki askeri trafiğin çoğu görünmez.
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
