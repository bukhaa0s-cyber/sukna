# سُكنى · Sukna Madinah

موقع الحجز المباشر للوحدات الأربع في المدينة المنورة: هومي إن، واحة جراند، أوليف، أوليف ستوديو.

- **الموقع:** https://bukhaa0s-cyber.github.io/sukna/
- **لوحة المالك:** من الرابط الصغير "دخول المالك" أسفل الصفحة، بحساب Google ‏bukhaa0s@gmail.com فقط.

## كيف يشتغل

| الجزء | وين |
|---|---|
| الصفحات | GitHub Pages (هذا المستودع) |
| الحجوزات والأيام المقفلة | Firebase مشروع `sukna-65778`، قاعدة Firestore في الدمام |
| الدفع | PayPal، تطبيق "Sukna Website" |
| الأسعار | `data/prices.json` (من PriceLabs) |
| الأيام المحجوزة في المنصات | `data/blocked.json`، يحدّثه GitHub Actions كل 15 دقيقة |
| تصدير حجوزات الموقع للمنصات | `ical/<unit>.ics` |

## التحويل من التجربة إلى الدفع الحقيقي

في `index.html` غيّر السطر:

```js
var PAYPAL_MODE='sandbox';
```

إلى `'live'`.

## ربط تقويمات المنصات

في GitHub: **Settings → Secrets and variables → Actions → New repository secret**، وأضف لكل وحدة روابط iCal (رابط في كل سطر):

| الاسم | الوحدة |
|---|---|
| `ICAL_HOMEY` | هومي إن |
| `ICAL_WAHA` | واحة جراند |
| `ICAL_OLIVE` | أوليف |
| `ICAL_STUDIO` | أوليف ستوديو |

واختياري `PRICELABS_API_KEY` لتحديث الأسعار تلقائياً من PriceLabs.

بعدها حط روابط التصدير (`https://bukhaa0s-cyber.github.io/sukna/ical/homey.ics` وغيرها) في Airbnb وBooking وقاذر كتقويم مستورد.
