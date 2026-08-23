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

// LOC's search API sits behind Cloudflare bot protection: any cross-origin
// fetch() carries an Origin header, and Cloudflare challenges every request
// that has one (verified directly — identical requests succeed without an
// Origin header, get a 403 "Just a moment..." challenge with one). That's
// not something a browser can route around client-side, so this goes
// through our own Vercel serverless function (api/loc.js) instead, which
// calls loc.gov server-to-server (no Origin header) and forwards the JSON.
// LOC's search API also has no license/rights query filter, so "public
// domain only" has to be applied client-side (see filter below).
async function locSearch(query, format, signal) {
  const url = '/api/loc?' + new URLSearchParams({ q: query, format })
  let response
  try {
    response = await fetch(url, { signal })
  } catch (e) {
    if (e.name === 'AbortError') throw e
    throw new Error('Could not reach the Library of Congress proxy.')
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new Error(body?.error || `HTTP ${response.status}`)
  }
  const data = await response.json()
  const results = (data.content && data.content.results) || []

  return results.filter((r) => {
    if (r.access_restricted) return false
    const item = r.item || {}
    // Presence of a rights_advisory/rights_information note means usage is
    // restricted in some way; only keep items with none, i.e. public domain
    // / no known restrictions.
    const advisory = item.rights_advisory || item.rights_information
    if (advisory && (Array.isArray(advisory) ? advisory.length : true)) return false
    return true
  })
}

function locAuthor(r) {
  const item = r.item || {}
  return (
    (item.contributors && item.contributors[0]) ||
    (item.creators && item.creators[0] && item.creators[0].title) ||
    ''
  )
}

function locSourceUrl(r) {
  const item = r.item || {}
  let sourceUrl = r.url || item.link || ''
  if (sourceUrl.startsWith('//')) sourceUrl = 'https:' + sourceUrl
  return sourceUrl
}

async function fetchLOCImages(query, signal) {
  const filtered = await locSearch(query, 'photos', signal)
  return filtered
    .filter((r) => r.image_url && r.image_url.length)
    .map((r) => {
      const images = r.image_url
      const thumb = images[0] || ''
      const full = images[images.length - 1] || thumb
      return {
        url: full,
        thumb,
        title: r.title || '',
        author: locAuthor(r),
        license: 'Public domain / no known restrictions',
        sourceUrl: locSourceUrl(r),
        type: 'image',
      }
    })
}

async function fetchLOCVideos(query, signal) {
  const filtered = await locSearch(query, 'film-and-videos', signal)
  return filtered
    .map((r) => {
      // Video URL/thumbnail live in resources[0], not image_url — only
      // present when LoC actually has a digitized, streamable copy.
      const resource = (r.resources || []).find((res) => res.type === 'video' && res.video)
      if (!resource) return null
      return {
        url: resource.video,
        thumb: resource.image || resource.background || '',
        title: r.title || '',
        author: locAuthor(r),
        license: 'Public domain / no known restrictions',
        sourceUrl: locSourceUrl(r),
        type: 'video',
      }
    })
    .filter(Boolean)
    .filter((item) => item.thumb)
}

export async function fetchLOC(query, mediaType = 'images', signal) {
  if (mediaType === 'images') return fetchLOCImages(query, signal)
  if (mediaType === 'videos') return fetchLOCVideos(query, signal)
  const [images, videos] = await Promise.all([
    fetchLOCImages(query, signal),
    fetchLOCVideos(query, signal),
  ])
  return [...images, ...videos]
}

async function nasaSearch(query, mediaType, signal) {
  const encodedQuery = encodeURIComponent(query)
  const url = `https://images-api.nasa.gov/search?q=${encodedQuery}&page=1&media_type=${mediaType}`
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

      if (mediaType === 'video') {
        if (!nasaId) return null
        // NASA's asset host follows a predictable {id}/{id}~variant.ext
        // naming scheme, so the actual video file can be built straight
        // from nasa_id — confirmed against multiple items — with no extra
        // per-item request. ~mobile.mp4 is a compressed streaming-sized
        // variant (not the multi-hundred-MB ~orig.mp4).
        const base = `https://images-assets.nasa.gov/video/${encodeURIComponent(nasaId)}/${encodeURIComponent(nasaId)}`
        return {
          url: `${base}~mobile.mp4`,
          thumb: `${base}~thumb.jpg`,
          title,
          author,
          license,
          sourceUrl,
          type: 'video',
        }
      }

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
    .filter(Boolean)
    .filter((item) => item.thumb)
}

export async function fetchNASA(query, mediaType = 'images', signal) {
  if (mediaType === 'images') return nasaSearch(query, 'image', signal)
  if (mediaType === 'videos') return nasaSearch(query, 'video', signal)
  const [images, videos] = await Promise.all([
    nasaSearch(query, 'image', signal),
    nasaSearch(query, 'video', signal),
  ])
  return [...images, ...videos]
}

async function iaAdvancedSearch(query, mediatype, rows, signal) {
  const q = `mediatype:${mediatype} AND (${query}) AND licenseurl:(*publicdomain* OR *zero*)`
  const response = await fetch(
    'https://archive.org/advancedsearch.php?' +
      new URLSearchParams({
        q,
        'fl[]': ['identifier', 'title', 'creator', 'licenseurl'],
        rows: String(rows),
        page: '1',
        output: 'json',
      }),
    { signal }
  )
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = await response.json()
  return ((data.response && data.response.docs) || []).filter((d) => d.identifier)
}

function iaLicense(licenseurl) {
  return /zero/.test(licenseurl || '') ? 'CC0' : 'Public domain'
}

// Internet Archive: keyless, CORS-open (access-control-allow-origin: *),
// verified directly against the live API. Restricting the query to items
// whose licenseurl is a public-domain or CC0 grant keeps this consistent
// with the other sources' PD/CC0-only filtering.
async function fetchInternetArchiveImages(query, rows, signal) {
  const docs = await iaAdvancedSearch(query, 'image', rows, signal)
  return docs.map((d) => {
    // The img service always returns a fixed-size derivative thumbnail —
    // there's no reliably-named full-res file in search results without
    // an extra per-item metadata fetch, so the item's details page (not
    // a raw file) is what "view source" / the image link opens to.
    const thumb = `https://archive.org/services/img/${encodeURIComponent(d.identifier)}`
    const sourceUrl = `https://archive.org/details/${encodeURIComponent(d.identifier)}`
    return {
      url: sourceUrl,
      thumb,
      title: d.title || d.identifier,
      author: d.creator || '',
      license: iaLicense(d.licenseurl),
      sourceUrl,
      type: 'image',
    }
  })
}

// Unlike images, IA video files aren't at a predictable URL — the actual
// filename (often not even related to the identifier) only comes from a
// per-item metadata call. Rows are capped low here since each result costs
// one extra request.
async function fetchInternetArchiveVideos(query, rows, signal) {
  const docs = await iaAdvancedSearch(query, 'movies', rows, signal)
  const withFiles = await Promise.all(
    docs.map((d) =>
      fetch(`https://archive.org/metadata/${encodeURIComponent(d.identifier)}`, { signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((meta) => ({ d, meta }))
        .catch((e) => {
          if (e.name === 'AbortError') throw e
          return { d, meta: null }
        })
    )
  )

  return withFiles
    .map(({ d, meta }) => {
      const files = (meta && meta.files) || []
      const videoFile =
        files.find((f) => /\.mp4$/i.test(f.name || '')) ||
        files.find((f) => /\.ogv$/i.test(f.name || ''))
      if (!videoFile) return null
      const sourceUrl = `https://archive.org/details/${encodeURIComponent(d.identifier)}`
      return {
        url: `https://archive.org/download/${encodeURIComponent(d.identifier)}/${encodeURIComponent(videoFile.name)}`,
        thumb: `https://archive.org/services/img/${encodeURIComponent(d.identifier)}`,
        title: d.title || d.identifier,
        author: d.creator || '',
        license: iaLicense(d.licenseurl),
        sourceUrl,
        type: 'video',
      }
    })
    .filter(Boolean)
}

export async function fetchInternetArchive(query, mediaType = 'images', signal) {
  if (mediaType === 'images') return fetchInternetArchiveImages(query, 24, signal)
  if (mediaType === 'videos') return fetchInternetArchiveVideos(query, 12, signal)
  const [images, videos] = await Promise.all([
    fetchInternetArchiveImages(query, 16, signal),
    fetchInternetArchiveVideos(query, 8, signal),
  ])
  return [...images, ...videos]
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
