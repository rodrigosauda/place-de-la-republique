Advertising banner (south building wall)
=======================================
1. Put the advertiser's image here, e.g. public/ads/acme.jpg (16:9, about 1600x900, under 500 KB).
2. Edit ads.json, for example:

{
  "contact": "ads@your-domain.com",
  "campaigns": [
    { "id": "acme-nov", "title": "ACME Coffee", "image": "/ads/acme.jpg",
      "url": "https://acme.example", "start": "2026-11-10", "end": "2026-11-30" }
  ]
}

   - id: short name, letters/numbers/dashes only (used for the statistics)
   - start / end: the campaign only shows between these dates (YYYY-MM-DD)
   - several active campaigns rotate every 30 seconds
3. npm run deploy
4. Impressions (players who saw the banner for 2+ seconds) are in /stats under "ads".
