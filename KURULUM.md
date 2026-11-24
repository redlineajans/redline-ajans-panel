# Red Line Ajans paneli — ilk kurulum

Bu klasör, gerçek giriş ve kayıt sistemi için başlangıç paketidir. Arayüz GitHub Pages'te yayınlanabilir; özel veriler Supabase veritabanında tutulur. Gerçek çalışan hesapları açmadan önce Supabase kurulumu ve erişim kuralları tamamlanmalıdır.

## Pakette neler var?

- `index.html`, `style.css`, `app.js`: giriş ve panel arayüzü.
- `supabase-config.js`: tarayıcıya konacak proje adresi ve **publishable** anahtar alanları.
- `supabase/schema.sql`: roller, ajanslar, platformlar, eski yayıncı kayıtları, finans, performans, dosya raporu arşivi ve çalışan ödeme tabloları ile erişim kuralları. Başvurular ve eski yayıncı verileri varsa uyumluluk için veritabanında kalır; panel menüsünde gösterilmez.
- `supabase/migrations/2026-11-16-weekly-assistant-performance.sql`: mevcut Supabase projesine haftalık alınan telefon numarası alanını ekler.
- `supabase/migrations/2026-11-16-role-specific-weekly-performance.sql`: mevcut projeye asistan ve danışman haftalık rapor alanlarını ekler.
- `supabase/migrations/2026-11-16-admin-only-delete-creators.sql`: yayıncı kayıtlarını yalnızca yöneticinin silebilmesini sağlar.
- `supabase/migrations/2026-11-16-employee-payment-table.sql`: yöneticiye özel çalışan ödeme tablosu ile personele yalnızca kendi ödeme durumunu gösteren güvenli işlevi ekler.
- `supabase/migrations/2026-11-16-employee-assistant-payment-group.sql`: kayıt asistanlarını tüm uygulamalardan bağımsız gruba alır; bu ödemelerin giderlerini genel kayıt olarak işler.
- `supabase/migrations/2026-11-17-profile-display-names.sql`: gerçek ad-soyaddan ayrı, yönetici tarafından düzenlenen panel görünen adlarını ekler.
- `supabase/migrations/2026-11-17-weekly-referral-entries.sql`: uygulama ve haftaya bağlı referans kayıtlarını, danışman uygulama yetkisine göre korunan erişim kurallarıyla ekler.
- `supabase/migrations/2026-11-17-pk-host-tracking.sql`: Sunucu rolü, özel PK afiş alanı ve uygulama yetkisine göre PK takibini ekler.
- `supabase/migrations/2026-11-25-room-assistant-operations.sql`: Oda Asistanı rolünü, uygulama bazlı rapor erişimini ve günlük yayıncı takibi / Baş Asistana yönlendirme kayıtlarını ekler.
- `supabase/functions/`: kullanıcı adıyla giriş, yönetici hesabı açma/kapatma ve ilk giriş parolası yenileme işlevleri.

## Kurulum sırası

1. Supabase'te yeni bir proje oluştur. Bölgeyi ajansa yakın seç; proje parolasını güvenli yerde sakla.
2. Supabase projesinde **SQL Editor**'ü aç, `supabase/schema.sql` dosyasının tamamını yapıştırıp çalıştır.
3. **Authentication → Settings** bölümünde herkese açık kayıt oluşturmayı kapat. Panelde kayıt ol butonu bulunmamalı; kullanıcıları yalnızca yönetici ekler.
4. **Authentication → Users → Add user** yoluyla ilk yönetici hesabını oluştur. Sonra o kullanıcının UID'sini kopyala.
5. SQL Editor'de aşağıdaki örneği kendi bilgilerinle düzenleyip çalıştır. Kullanıcı adı küçük harfle yazılmalı:

```sql
insert into public.profiles (id, username, email, full_name, role, active, must_change_password)
values ('AUTH_USER_UUID', 'redlineadmin', 'AJANS_EMAIL_ADRESI', 'Yönetici Adı', 'admin', true, false);
```

6. **Project Settings → API** bölümünden Project URL ile `sb_publishable_...` anahtarını al. Bunları `supabase-config.js` içindeki ilgili iki alana yerleştir. **Secret key'i bu dosyaya koyma.**
7. Supabase **Edge Functions** bölümünde şu işlevleri ayrı ayrı, dosyadaki adla oluşturup kodunu yapıştır ve dağıt:
   - `username-login` → `supabase/functions/username-login/index.ts`
   - `manage-users` → `supabase/functions/manage-users/index.ts`
   - `complete-password-change` → `supabase/functions/complete-password-change/index.ts`
8. `username-login` işlevinin ayarlarında **Verify JWT** seçeneğini kapat. Bu giriş ekranının oturum açmadan kullanıcı adı/parola gönderebilmesi içindir; işlev yine parolayı Supabase Auth ile doğrular. Diğer iki işlevde Verify JWT açık kalsın; ek olarak yönetici/oturum yetkisini kendileri de kontrol eder.
9. GitHub Pages için **bu klasörün içeriğini** yeni ve ayrı bir GitHub deposunun ana dizinine yükle. `redline-ajans-site` tanıtım deposunun üzerine yazma. GitHub Pages'i açıp panel bağlantısını oluştur.
10. Panel bağlantısını personele ilet. İlk yönetici girişiyle **Kullanıcı Yönetimi** bölümünden asistan/kayıtçı, danışman veya alt ajans sahibi hesabı oluştur.

## İlk yönetici için parola girişi

İlk yönetici, Auth'ta oluştururken verdiğin e-posta ve parola ile `redlineadmin` kullanıcı adı üzerinden giriş yapar. Personel hesapları yönetim panelinde açılır ve ilk girişte geçici parolasını değiştirmek zorundadır.

## Güvenlik notları

- `sb_secret_...` anahtarı veya eski `service_role` anahtarı **asla** GitHub deposuna, `supabase-config.js` dosyasına ya da personele gönderilen dosyalara konmamalı. Supabase Edge Functions, kendi yönetilen secret key'lerini sunucu tarafında kullanır.
- GitHub Pages kaynak kodu herkese açık olabilir; güvenliği veritabanı RLS kuralları sağlar. Özel başvuru/finans verisi HTML'e sabit yazılmaz.
- Panel giriş ekranı robots noindex ile işaretli; bu yalnızca arama motoru ipucudur. Yetkiyi tek başına sağlamaz. Veritabanı erişimi oturum/rol/ajans kurallarıyla korunur.
- Tanchat–Tanstar, Linky AI, Layla–Nivi, Timo, Sohbi ve Simi aktif iş birliği platformlarıdır.
- Parolalar kullanıcı profili tablosuna yazılmaz. Auth sağlayıcısı parolayı güvenli biçimde saklar; yönetici tarafından oluşturulan ilk parola yalnızca hesaba tanımlanırken iletilir.
- Ücretsiz Supabase projeleri kullanılmadığında duraklatılabilir; ücretsiz planda otomatik yedekler bulunmaz. Düzenli canlı operasyon ve finans kayıtları için yedekleme planı belirlenmeden gerçek finansal verileri taşımayın.

## Mevcut panel güncellemesi

Bu sürümde Başvurular menüsü kaldırılmıştır. Kayıt asistanları Performans bölümünde haftalık ulaşılan telefon numarası sayısını ve o hafta tamamlanan kayıt sayısını girebilir. Hafta başlangıç ve bitiş tarihleri formda otomatik olarak doldurulur ve gerekirse değiştirilebilir. Var olan başvuru veritabanı kayıtları silinmez.

Gelir/gider tutarı `1.234,56` veya `1234,56` biçiminde girilebilir. Finans ve performans kayıtlarında **Hepsi / Genel kayıt**, kaydı tek bir uygulamaya bağlamadan saklar.

Var olan Supabase projesi kullanılıyorsa SQL Editor'de, daha önce çalıştırmadıysan `supabase/migrations/2026-11-16-weekly-assistant-performance.sql` dosyasını; ardından `supabase/migrations/2026-11-16-role-specific-weekly-performance.sql` dosyasını çalıştır. Sonra güncel panel dosyalarını GitHub'daki `redline-ajans-panel` deposunun ana dizinine yükle.

## Haftalık performans raporları

- Kayıt asistanı kendi adını seçerek uygulama (veya **Hepsi / Genel kayıt**), hafta başlangıç/bitiş tarihleri, alınan toplam numara ve toplam kayıt bilgisini girer.
- Danışman kendi adını seçerek uygulama, hafta tarihleri, tamamlanan toplam kota, arka plan kotası, haftalık sorunlar ve çözüm önerilerini girer.
- Yönetici iki rapor türünü de personel adına girebilir ve ekip kayıtlarını birlikte görebilir. Ciro katkısı yalnızca yönetici formunda bulunur.
- Günlük performans formları bu haftalık raporlardan ayrı kalır.
- Yönetici ve alt ajans görünümünde performans kayıtları türlerine göre filtrelenir; tabloda asistan numara/kayıt sayıları ile danışman kota alanları ayrı sütunlarda gösterilir.
- Dar ekranlarda menü açılır; menü dışındaki alana dokununca veya bir bölüm seçince kapanır. Telefonda tarayıcının “Masaüstü sitesi” seçeneği kapalı olmalıdır.
- Mevcut Supabase projesinde Layla'yı Layla–Nivi olarak güncellemek, Sohbi'yi aktifleştirmek ve Simi'yi eklemek için `supabase/migrations/2026-11-16-platform-menu-updates.sql` dosyasını SQL Editor'de bir kez çalıştır.
- Asistan/kayıtçı kendi performans raporlarını, danışman kendi performans raporlarını ve kendisine atanmış uygulamaların rapor dosyalarını görebilir. Alt ajans sahibi kendi ajansına atanmış rapor dosyalarını görür. Rapor dosyası yükleme ve silme yalnızca yöneticiye açıktır.
- Mevcut Supabase projesinde yayıncı silme iznini yöneticiye eklemek için `supabase/migrations/2026-11-16-admin-only-delete-creators.sql` dosyasını SQL Editor'de bir kez çalıştır.

## Dosya raporları

- Raporlar bölümü eski Yayıncılar bağlantısının yerini alır. Eski yayıncı kayıtları veritabanından silinmez.
- Yönetici günlük veya haftalık rapor olarak XLSX, XLS, CSV, PDF, JPG, PNG, WEBP veya GIF yükleyebilir. Tek dosya sınırı 20 MB'tır; rapor başına uygulama ve dönem zorunludur. İstenirse alt ajans seçilir. Dosyaların içeriği satır satır panele aktarılmaz; dosya olarak saklanır.
- Dosyalar `platform-reports` adlı **özel** Supabase Storage alanında tutulur. Dosya bağlantıları süreli olarak oluşturulur; herkese açık link üretilmez.
- Danışmanların rapor erişimi uygulamaya göre belirlenir. Güncel panelde **Kullanıcı Yönetimi → Uygulamaları ata** ile her danışmanın sorumlu olduğu uygulamaları seç. Danışman sadece bu uygulamalara ait raporları görür.
- Alt ajans sahibi sadece kendi ajansına atanmış dosya raporlarını görür. Kayıt asistanı kendi haftalık kayıtlarını Performans bölümünde görür; diğer personelin veya dosya raporlarının arşivine erişmez.
- Yükleme ve silme yalnızca yöneticiye açıktır. Rapor dosyalarını ve erişim kurallarını eklemek için mevcut Supabase projesinde `supabase/migrations/2026-11-16-private-platform-reports.sql` dosyasını SQL Editor'de bir kez çalıştır; önceki platform/performance migration dosyalarını tekrar çalıştırma.

## Çalışan ödeme tablosu

- **Çalışma Alanı → Çalışan Ödeme Tablosu** yalnızca yöneticiye görünür. Çalışanları aktif uygulamalar altında ekleyip iletişim, IBAN, Binance TRC20, aylık/haftalık ödeme, asgari ücret, borç notu, para birimi ve aktiflik bilgilerini burada yönetebilirsin.
- Kayıt asistanları **Kayıt Asistanları · Tüm uygulamalar** grubunda ayrı görünür. Bu gruptaki ödemeler belirli bir platforma bağlanmadan **Hepsi / Genel kayıt** gideri olarak işlenir. Diğer çalışanları uygulama grubuna eklemeye devam et.
- Kayıt asistanı için **Ödeme ekle** seçildiğinde, seçilen hafta aralığındaki kendi haftalık performans raporlarının kayıt sayısı toplanır ve prim otomatik hesaplanır: 1–50 kayıt için tüm kayıt başına 25 TL, 51–100 için 30 TL, 101 ve üstü için 35 TL. Seçilen basamağın ücreti o haftanın bütün kayıtlarına uygulanır. Hesaplanan tutar ödenecek tutara ve tam ödeme varsayılanına gelir; kısmi ödeme için ödenen tutarı değiştirebilirsin. Bu hesap için kayıt asistanının ödeme kaydı panel hesabıyla eşleştirilmiş ve haftalık performans raporu girilmiş olmalı.
- Bir çalışanı panel hesabıyla eşleştirirsen o hesapta **Ödeme Durumum** menüsü çıkar. Çalışan yalnızca kendisine bağlı haftalık/aylık dönemin başlangıç-bitişini ve “Ödendi / Ödenmedi” durumunu görür; tutarları, ödeme geçmişini, IBAN/TRC20'yi ve borç notunu göremez. Eşleştirme yapılmayan çalışana ödeme durumu gösterilmez.
- Sunucu hesapları da çalışan ödeme tablosunda ilgili uygulama ve panel hesabıyla eşleştirilebilir; sunucu kendi ödeme durumunu görür, özel ücret ve ödeme bilgilerini göremez.
- Yönetici **Ödeme ekle** ile ödeme türü, dönem, ödenecek tutar, şimdi ödenen tutar ve tarihi girer. Ödeme otomatik olarak uygulamaya bağlı gider olarak eklenir. Kısmi ödeme girilirse kalan tutar beklemede kalır ve aynı döneme ek ödeme girilebilir.
- Ödeme düzeltme/silme yalnızca yönetici ödeme geçmişinden yapılır; bağlı gider kaydı da birlikte silinir. Gelir & Gider ekranında çalışan ödeme giderleri salt görüntülenir.
- Daha önce çalışan ödeme tablosu SQL'ini çalıştırdıysan yalnızca yeni `supabase/migrations/2026-11-16-employee-assistant-payment-group.sql` dosyasını Supabase SQL Editor'de bir kez çalıştır. İlk ödeme tablosu SQL'ini henüz çalıştırmadıysan önce `supabase/migrations/2026-11-16-employee-payment-table.sql`, ardından bu yeni dosyayı çalıştır. Sonra güncel panel dosyalarını GitHub deposunun ana dizinine yükleyip commit et. Çalışan hesabı varsa, ödeme tablosundaki çalışan kaydını o hesapla eşleştir.

## Panelde görünen çalışan adları

- Kullanıcı Yönetimi tablosunda **Görünen adı düzenle** seçeneğiyle çalışan için panelde kullanılacak adı belirleyebilirsin. Rol (ör. Danışman) ayrı gösterilir; görünen ada yalnızca kişinin kullanacağı adı yazmak yeterlidir. Görünen adı boş bırakırsan gerçek ad-soyad varsayılan olarak kullanılır.
- Bu ad sol alttaki hesap alanında, kullanıcı listelerinde ve performans kayıtlarında görünür. Gerçek `Ad soyad` profilde değiştirilmez.
- Var olan Supabase projesinde `supabase/migrations/2026-11-17-profile-display-names.sql` dosyasını SQL Editor'de bir kez çalıştır, sonra güncel panel dosyalarını GitHub deposunun ana dizinine yükleyip commit et.

## Haftalık referans kayıtları

- **Referans Kayıtları** bölümü yönetici, asistan/kayıtçı ve danışman hesaplarında görünür. Asistanlar uygulama ve hafta seçip kayıt ekleyebilir; kendi girdiklerini düzenleyebilir. Danışmanlar yalnızca Kullanıcı Yönetimi'nde kendilerine atanmış uygulamaların kayıtlarını görür. Yönetici tüm uygulamaları görür, düzenler ve siler; çalışanlar kayıt silemez.
- Her satırda hafta, uygulama, referansla gelen yayıncının ID ve telefonu, onu referans eden kişinin adı ve telefonu tutulur. Uygulama seçimi, “Lu200” gibi uygulama etiketini ayrıca yazma ihtiyacını kaldırır.
- Referans satırında ödeme durumu **Referans Ödemesi Var** (tutar ve para birimiyle) ya da **Referans Ödemesi Yoktur** olarak işaretlenebilir. Yönetici, kaydı giren asistan ve yetkili danışman ödeme bilgisini güncelleyebilir; asistanlar tüm referansların ödeme durumunu görebilir.
- Var olan Supabase projesinde `supabase/migrations/2026-11-18-referral-payment-status.sql` dosyasını bir kez çalıştır.
- Var olan Supabase projesinde `supabase/migrations/2026-11-17-weekly-referral-entries.sql` dosyasını SQL Editor'de bir kez çalıştır; sonra güncel panel dosyalarını GitHub deposunun ana dizinine yükleyip commit et.

## Sunucular ve PK Takip

- Kullanıcı Yönetimi'nde hesabı **Sunucu** rolüyle oluştur. Sunucuyu **Çalışan Ödeme Tablosu**nda ilgili uygulama grubuna ekle ve panel hesabıyla eşleştir. Böylece Sunucu hesabı yalnızca kendi PK programlarını ve eşleştirilen ödeme durumunu görür.
- Yönetici ve danışmanlar PK adı, uygulama, tarih-saat, bir veya birden fazla sunucu, afiş, isteğe bağlı EVT takip kodu ve onay durumunu ekleyip düzenleyebilir. Danışman sadece kendisine atanmış uygulamaların PK kayıtlarını yönetir. Afiş onayını dış portaldan kontrol ettikten sonra panelde elle güncelle; panel dış portala bağlanmaz. Sunucular kayıt ekleyemez ve silemez.
- Afişler `pk-posters` adlı özel Storage alanında saklanır ve yalnızca ilgili PK kaydına yetkili hesaplarca görüntülenebilir. Afiş dosyası 20 MB'ı geçmemelidir.
- Var olan Supabase projesinde `supabase/migrations/2026-11-17-pk-host-tracking.sql` dosyasını SQL Editor'de bir kez çalıştır. Sonra güncel panel dosyalarını GitHub deposunun ana dizinine yükle. Yeni **Sunucu** hesapları açabilmek için paketteki `supabase/functions/manage-users/index.ts` dosyasını Supabase Edge Functions'taki `manage-users` işlevine yükleyip yeniden dağıt.
- Sunucu PK tamamlandıktan sonra kendisine atanmış kayıtta **Sunuldu** veya **Sunulmadı** seçip kaydedebilir. Yönetici ve ilgili danışman bu durumu görür. Sunucunun, yöneticinin ve danışmanın **Sunucu Performansı** bölümü yalnızca Sunuldu olarak işaretlenen kayıtları listeler; danışman yalnızca yetkili olduğu uygulamaları görür. Mevcut projede `supabase/migrations/2026-11-18-pk-presentation-status.sql` dosyasını bir kez çalıştır.
- PK kaydı eklerken RLS hatası alınırsa supabase/migrations/2026-11-18-pk-create-event-rpc.sql dosyasını da bir kez çalıştır.

## Oda Asistanı ve günlük takip

- Kullanıcı Yönetimi'nden yeni hesabı **Oda Asistanı** rolüyle oluştur; ardından **Uygulamaları ata** ile sorumlu olduğu uygulamaları seç. Mevcut **Danışman** rolü değişmez; danışmanlar Baş Asistan olarak kalır.
- Yönetici günlük/haftalık uygulama raporlarını **Raporlar** bölümüne yükler. Oda Asistanı yalnızca atandığı uygulamaların raporlarını ve rapor dosyalarını görebilir. Kota/yayın rakamları otomatik gelmez; Oda Asistanı rapora bakarak her yayıncı için yayın yaptı mı, kota eksiği var mı, iletişim kuruldu mu, etkinlik/PK yönlendirmesi ve motivasyon desteği gerekip gerekmediğini günlük takip formuna işler. Sayısal raporu yeniden girmesi gerekmez.
- Oda Asistanı çözemediği konuyu takip kaydında yazar; kayıt ilgili uygulamanın danışmanına (Baş Asistanına) ve yöneticiye görünür. Danışman çözüm notu girip konuyu kapatabilir. Oda Asistanı kendi oluşturduğu takip kayıtlarını düzenler; silme yalnızca yöneticiye açıktır.
- Mevcut Supabase projesinde `supabase/migrations/2026-11-25-room-assistant-operations.sql` dosyasını SQL Editor'de bir kez çalıştır. Sonra güncel panel dosyalarını GitHub'a yükle. Yeni Oda Asistanı kullanıcıları açabilmek için paketteki `supabase/functions/manage-users/index.ts` kodunu Supabase Edge Functions'taki `manage-users` işlevine yükleyip yeniden dağıt.

## Bu sürümün sınırı

Bu sürüm; kullanıcı adıyla giriş, ilk girişte parola değiştirme, rol bazlı ekranlar, platform listesi, dosya raporu arşivi, çalışan ödeme tablosu, otomatik gider kaydı, finans kaydı, haftalık performans girişi, haftalık referans kayıtları, sunucu PK takibi ve sunum durumu bildirimi, danışman uygulama ataması ve hesap kapatma akışlarını içerir. Eski yayıncı verileri veritabanında korunur ancak panelde ayrı bir Yayıncılar bölümü gösterilmez. Rol bazlı erişim veritabanında da uygulanır.
