// Vercel serverless function: proxies Library of Congress JSON search.
//
// The browser can't call loc.gov directly — any cross-origin fetch()
// carries an Origin header, and Cloudflare challenges every request that
// has one (confirmed: identical requests succeed without an Origin header,
// fail with a 403 "Just a moment..." challenge page with one). A
// server-to-server request from this function has no Origin header, so it
// goes through cleanly — this is exactly what a browser sees when it talks
// to *this* endpoint instead of loc.gov.
const ALLOWED_FORMATS = new Set(['photos', 'film-and-videos', 'audio'])

export default async function handler(req, res) {
  const q = (req.query.q || '').toString().trim()
  const format = ALLOWED_FORMATS.has(req.query.format) ? req.query.format : 'photos'

  if (!q) {
    res.status(400).json({ error: 'Missing required query parameter: q' })
    return
  }

  const upstreamUrl =
    `https://www.loc.gov/${format}/?` +
    new URLSearchParams({ q, fo: 'json', c: '25' })

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: {
        // A descriptive UA is good etiquette for loc.gov's API and makes
        // the traffic distinguishable from generic bot noise.
        'User-Agent': 'public-domain-media-search/1.0 (Vercel serverless proxy)',
      },
    })

    if (!upstream.ok) {
      res.status(upstream.status).json({ error: `Library of Congress returned HTTP ${upstream.status}` })
      return
    }

    const data = await upstream.json()
    // Cache briefly at the edge/CDN so repeat searches for the same term
    // don't re-hit loc.gov (helps stay well under their 20 req/min limit).
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600')
    res.status(200).json(data)
  } catch (err) {
    res.status(502).json({ error: 'Failed to reach the Library of Congress API', detail: err.message })
  }
}
