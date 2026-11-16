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
- Bir çalışanı panel hesabıyla eşleştirirsen o hesapta **Ödeme Durumum** menüsü çıkar. Çalışan yalnızca kendisine bağlı haftalık/aylık dönemin başlangıç-bitişini ve “Ödendi / Ödenmedi” durumunu görür; tutarları, ödeme geçmişini, IBAN/TRC20'yi ve borç notunu göremez. Eşleştirme yapılmayan çalışana ödeme durumu gösterilmez.
- Yönetici **Ödeme ekle** ile ödeme türü, dönem, ödenecek tutar, şimdi ödenen tutar ve tarihi girer. Ödeme otomatik olarak uygulamaya bağlı gider olarak eklenir. Kısmi ödeme girilirse kalan tutar beklemede kalır ve aynı döneme ek ödeme girilebilir.
- Ödeme düzeltme/silme yalnızca yönetici ödeme geçmişinden yapılır; bağlı gider kaydı da birlikte silinir. Gelir & Gider ekranında çalışan ödeme giderleri salt görüntülenir.
- Mevcut Supabase projesinde `supabase/migrations/2026-11-16-employee-payment-table.sql` dosyasını SQL Editor'de bir kez çalıştır. Sonra güncel panel dosyalarını GitHub deposunun ana dizinine yükleyip commit et. Çalışan hesabı varsa, ödeme tablosundaki çalışan kaydını o hesapla eşleştir.

## Bu sürümün sınırı

Bu sürüm; kullanıcı adıyla giriş, ilk girişte parola değiştirme, rol bazlı ekranlar, platform listesi, dosya raporu arşivi, çalışan ödeme tablosu, otomatik gider kaydı, finans kaydı, haftalık performans girişi, danışman uygulama ataması ve hesap kapatma akışlarını içerir. Eski yayıncı verileri veritabanında korunur ancak panelde ayrı bir Yayıncılar bölümü gösterilmez. Rol bazlı erişim veritabanında da uygulanır.
