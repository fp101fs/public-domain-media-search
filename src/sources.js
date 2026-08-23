// Fetch functions for each public-domain media source.

async function wikimediaSearch(gsrsearch, limit, signal) {
  const response = await fetch(
    'https://commons.wikimedia.org/w/api.php?' +
      new URLSearchParams({
        action: 'query',
        generator: 'search',
        gsrsearch,
        gsrnamespace: '6', // File namespace
        gsrlimit: String(limit),
        prop: 'imageinfo',
        iiprop: 'url|extmetadata|mediatype',
        // Cards render at ~220-260px wide — requesting a thumbnail close to
        // that (rather than 300px) trims transfer size with no visible loss.
        iiurlwidth: '240',
        format: 'json',
        origin: '*',
      }),
    { signal }
  )
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = await response.json()
  const pages = data.query && data.query.pages
  if (!pages) return []
  const items = []
  for (const pageId in pages) {
    const p = pages[pageId]
    const title = p.title || ''
    const ii = p.imageinfo && p.imageinfo[0]
    if (!ii) continue
    const url = ii.url || ''
    const thumb = ii.thumburl || ii.url
    const meta = ii.extmetadata || {}
    const author = meta.Artist ? meta.Artist.value : ''
    const license = meta.LicenseShortName ? meta.LicenseShortName.value : ''
    // filter: only public domain or CC0
    if (license !== 'Public domain' && license !== 'CC0') continue
    // .ogv (Theora) files have no video decoder in Chrome — audio plays but
    // the frame stays black, so skip them rather than show a broken result.
    if (/\.ogv$/i.test(title)) continue
    const sourceUrl = `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(
      title.replace(/^File:/, '')
    )}`
    const type = ii.mediatype === 'VIDEO' ? 'video' : 'image'
    items.push({ url, thumb, title, author, license, sourceUrl, type })
  }
  return items
}

export async function fetchWikimedia(query, mediaType = 'images', signal) {
  // Fetch a larger batch than one page so client-side pagination has
  // multiple pages to work with.
  if (mediaType === 'images') {
    return wikimediaSearch(query, 40, signal)
  }
  if (mediaType === 'videos') {
    return wikimediaSearch(`filetype:video ${query}`, 40, signal)
  }
  // 'both' — run image and video searches in parallel and merge.
  const [images, videos] = await Promise.all([
    wikimediaSearch(query, 20, signal),
    wikimediaSearch(`filetype:video ${query}`, 20, signal),
  ])
  return [...images, ...videos]
}

export async function fetchOpenverse(query, signal) {
  const response = await fetch(
    'https://api.openverse.org/v1/images/?' +
      new URLSearchParams({
        q: query,
        // cc0 = public domain dedication, pdm = public domain mark (no known copyright)
        license: 'cc0,pdm',
        // Openverse hard-caps anonymous (keyless) requests at 20 — anything
        // higher is a 401 "page_size may not exceed 20 for anonymous
        // requests", not a rate limit. Don't raise this without an API key.
        page_size: '20',
      }),
    { signal }
  )
  if (!response.ok) {
    const detail = await response.json().catch(() => null)
    throw new Error(detail?.detail || `HTTP ${response.status}`)
  }
  const data = await response.json()
  const results = data.results || []
  return results.map((r) => ({
    url: r.url || '',
    thumb: r.thumbnail || r.url || '',
    title: r.title || '',
    author: r.creator || '',
    license: r.license || '',
    sourceUrl: r.url || '',
  }))
}

// LOC's search API sits behind Cloudflare bot protection that blocks
// browser-side cross-origin access both ways:
//   - fetch(): no Access-Control-Allow-Origin on the response the browser
//     actually receives (curl gets it; real browser requests get challenged)
//   - JSONP via <script src>: the response Content-Type is always
//     application/json (with nosniff), so Chrome's ORB blocks executing it
//     as a script regardless of the callback wrapper — this is not
//     intermittent, it structurally can't work.
// Public CORS proxies (allorigins, corsproxy.io, corsfix, codetabs, etc.)
// were tried and are either down or themselves get Cloudflare-challenged by
// loc.gov, since it blocks known datacenter/proxy IP ranges. There is no
// reliable pure-front-end fix here; a real fix needs a backend/proxy you
// control (e.g. a small Cloudflare Worker) to relay the request server-side.
// This still attempts a direct fetch — it'll work if LOC's bot protection
// ever loosens for your network — and fails with a clear message otherwise.
// LOC's search API also has no license/rights query filter, so "public
// domain only" has to be applied client-side (see filter below).
export async function fetchLOC(query, signal) {
  const baseUrl = 'https://www.loc.gov/photos/'
  const params = new URLSearchParams({
    q: query,
    fo: 'json',
    c: '25',
  })
  const url = `${baseUrl}?${params.toString()}`
  let response
  try {
    response = await fetch(url, { signal })
  } catch (e) {
    if (e.name === 'AbortError') throw e
    throw new Error(
      'Library of Congress blocked this request (their site blocks cross-origin browser access). This tab cannot work without a server-side proxy you control.'
    )
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = await response.json()
  const results = (data.content && data.content.results) || []

  const filtered = results.filter((r) => {
    if (r.access_restricted) return false
    const item = r.item || {}
    // Presence of a rights_advisory/rights_information note means usage is
    // restricted in some way; only keep items with none, i.e. public domain
    // / no known restrictions.
    const advisory = item.rights_advisory || item.rights_information
    if (advisory && (Array.isArray(advisory) ? advisory.length : true)) return false
    return true
  })

  return filtered
    .filter((r) => r.image_url && r.image_url.length)
    .map((r) => {
      const images = r.image_url
      const thumb = images[0] || ''
      const full = images[images.length - 1] || thumb
      const title = r.title || ''
      const item = r.item || {}
      const author =
        (item.contributors && item.contributors[0]) ||
        (item.creators && item.creators[0] && item.creators[0].title) ||
        ''
      const license = 'Public domain / no known restrictions'
      let sourceUrl = r.url || item.link || ''
      if (sourceUrl.startsWith('//')) sourceUrl = 'https:' + sourceUrl
      return { url: full, thumb, title, author, license, sourceUrl }
    })
}

export async function fetchNASA(query, signal) {
  const encodedQuery = encodeURIComponent(query)
  const url = `https://images-api.nasa.gov/search?q=${encodedQuery}&page=1&media_type=image`
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = await response.json()
  const items = (data.collection && data.collection.items) || []

  return items
    .map((item) => {
      const d = (item.data && item.data[0]) || {}
      const title = d.title || 'Untitled'
      const author =
        d.photographer || d.secondary_creator || (d.center ? `NASA ${d.center}` : 'NASA')
      const license = 'Public domain (NASA)'
      const nasaId = d.nasa_id || ''
      const sourceUrl = nasaId
        ? `https://images.nasa.gov/details/${encodeURIComponent(nasaId)}`
        : 'https://images.nasa.gov/'

      let thumb = ''
      let fullUrl = ''
      if (item.links && item.links.length > 0) {
        const previewLink = item.links.find((l) => l.rel === 'preview') || item.links[0]
        thumb = previewLink ? previewLink.href : ''
        const origLink = item.links.find((l) => l.rel === 'canonical')
        fullUrl = origLink ? origLink.href : thumb
      }

      return {
        url: fullUrl || thumb,
        thumb: thumb || fullUrl,
        title,
        author,
        license,
        sourceUrl,
        type: 'image',
      }
    })
    .filter((item) => item.thumb)
}

// Internet Archive: keyless, CORS-open (access-control-allow-origin: *),
// verified directly against the live API. Restricting the query to items
// whose licenseurl is a public-domain or CC0 grant keeps this consistent
// with the other sources' PD/CC0-only filtering.
export async function fetchInternetArchive(query, signal) {
  const q = `mediatype:image AND (${query}) AND licenseurl:(*publicdomain* OR *zero*)`
  const response = await fetch(
    'https://archive.org/advancedsearch.php?' +
      new URLSearchParams({
        q,
        'fl[]': ['identifier', 'title', 'creator', 'licenseurl'],
        rows: '24',
        page: '1',
        output: 'json',
      }),
    { signal }
  )
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = await response.json()
  const docs = (data.response && data.response.docs) || []
  return docs
    .filter((d) => d.identifier)
    .map((d) => {
      // The img service always returns a fixed-size derivative thumbnail —
      // there's no reliably-named full-res file in search results without
      // an extra per-item metadata fetch, so the item's details page (not
      // a raw file) is what "view source" / the image link opens to.
      const thumb = `https://archive.org/services/img/${encodeURIComponent(d.identifier)}`
      const sourceUrl = `https://archive.org/details/${encodeURIComponent(d.identifier)}`
      const license = /zero/.test(d.licenseurl || '')
        ? 'CC0'
        : 'Public domain'
      return {
        url: sourceUrl,
        thumb,
        title: d.title || d.identifier,
        author: d.creator || '',
        license,
        sourceUrl,
        type: 'image',
      }
    })
}

// Metropolitan Museum of Art Collection API: keyless, CORS-open (verified
// with an Origin header against the live API). isPublicDomain gates every
// result already; no extra license filtering needed.
export async function fetchMet(query, signal) {
  const searchRes = await fetch(
    'https://collectionapi.metmuseum.org/public/collection/v1/search?' +
      new URLSearchParams({ q: query, hasImages: 'true' }),
    { signal }
  )
  if (!searchRes.ok) throw new Error(`HTTP ${searchRes.status}`)
  const searchData = await searchRes.json()
  const ids = (searchData.objectIDs || []).slice(0, 24)

  const objects = await Promise.all(
    ids.map((id) =>
      fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`, { signal })
        .then((r) => (r.ok ? r.json() : null))
        .catch((e) => {
          if (e.name === 'AbortError') throw e
          return null
        })
    )
  )

  return objects
    .filter((o) => o && o.isPublicDomain && (o.primaryImageSmall || o.primaryImage))
    .map((o) => ({
      url: o.primaryImage || o.primaryImageSmall,
      thumb: o.primaryImageSmall || o.primaryImage,
      title: o.title || 'Untitled',
      author: o.artistDisplayName || '',
      license: 'Public domain (The Met)',
      sourceUrl: o.objectURL || 'https://www.metmuseum.org/art/collection',
      type: 'image',
    }))
}

// Cleveland Museum of Art Open Access API: keyless, CORS-open (verified
// against the live API). share_license_status === 'CC0' gates every result.
export async function fetchCleveland(query, signal) {
  const response = await fetch(
    'https://openaccess-api.clevelandart.org/api/artworks?' +
      new URLSearchParams({ q: query, limit: '24', cc0: '1' }),
    { signal }
  )
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = await response.json()
  const results = data.data || []
  return results
    .filter((r) => r.share_license_status === 'CC0' && r.images && r.images.web)
    .map((r) => {
      const author = (r.creators && r.creators[0] && r.creators[0].description) || ''
      return {
        url: r.images.web.url || r.images.print?.url || '',
        thumb: r.images.web.url || '',
        title: r.title || 'Untitled',
        author,
        license: 'CC0 (Cleveland Museum of Art)',
        sourceUrl: r.url || 'https://www.clevelandart.org/art',
        type: 'image',
      }
    })
    .filter((item) => item.thumb)
}
