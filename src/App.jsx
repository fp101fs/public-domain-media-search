import { useEffect, useRef, useState } from 'react'
import {
  fetchWikimedia,
  fetchOpenverse,
  fetchNASA,
  fetchInternetArchive,
  fetchMet,
  fetchCleveland,
  fetchLOC,
} from './sources.js'

const TABS = [
  { key: 'wikimedia', label: 'Wikimedia' },
  { key: 'openverse', label: 'Openverse' },
  { key: 'nasa', label: 'NASA' },
  { key: 'archive', label: 'Internet Archive' },
  { key: 'met', label: 'The Met' },
  { key: 'cleveland', label: 'Cleveland Museum' },
  { key: 'loc', label: 'Library of Congress' },
]

const PAGE_SIZE = 12

export default function App() {
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState('wikimedia')
  const [mediaType, setMediaType] = useState('images')
  const [items, setItems] = useState([])
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const abortRef = useRef(null)

  // Cancel any in-flight request on unmount so it doesn't try to update
  // state after the component is gone.
  useEffect(() => () => abortRef.current?.abort(), [])

  function switchTab(key) {
    setTab(key)
    setItems([])
    setPage(1)
    setStatus('')
    setError('')
  }

  async function performSearch(e) {
    e?.preventDefault()
    const q = query.trim()
    if (!q) return

    // Cancel any previous, still-in-flight search so a slow earlier
    // response can't land after a newer one and overwrite it.
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError('')
    setItems([])
    setPage(1)
    setStatus('Searching...')

    try {
      let results = []
      if (tab === 'wikimedia') results = await fetchWikimedia(q, mediaType, controller.signal)
      else if (tab === 'openverse') results = await fetchOpenverse(q, controller.signal)
      else if (tab === 'nasa') results = await fetchNASA(q, controller.signal)
      else if (tab === 'archive') results = await fetchInternetArchive(q, controller.signal)
      else if (tab === 'met') results = await fetchMet(q, controller.signal)
      else if (tab === 'cleveland') results = await fetchCleveland(q, controller.signal)
      else if (tab === 'loc') results = await fetchLOC(q, controller.signal)

      setItems(results)
      setStatus(results.length ? `${results.length} result(s)` : 'No results found.')
    } catch (err) {
      if (err.name === 'AbortError') return
      console.error(err)
      setStatus('')
      setError(err.message || 'Something went wrong.')
    } finally {
      if (abortRef.current === controller) setLoading(false)
    }
  }

  function hideBrokenImage(e) {
    e.currentTarget.closest('.card')?.style.setProperty('display', 'none')
  }

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const pageItems = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="app">
      <div className="header">
        <h1>Public Domain Media Search</h1>
        <p>Search free-to-use images and videos across public archives.</p>
      </div>

      <form className="search-bar" onSubmit={performSearch}>
        <input
          type="text"
          placeholder="Enter search term (e.g., ancient Rome)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      <div className="controls-row">
        <div className="tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`tab-button ${tab === t.key ? 'active' : ''}`}
              onClick={() => switchTab(t.key)}
              type="button"
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'wikimedia' && (
          <div className="media-type">
            {['images', 'videos', 'both'].map((v) => (
              <label key={v}>
                <input
                  type="radio"
                  name="mediaType"
                  value={v}
                  checked={mediaType === v}
                  onChange={() => setMediaType(v)}
                />
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </label>
            ))}
          </div>
        )}
      </div>

      {(status || error) && (
        <div className={`status ${error ? 'error' : ''}`}>{error || status}</div>
      )}

      {pageItems.length > 0 && (
        <>
          <div className="results">
            {pageItems.map((item, i) => (
              <div className="card" key={`${item.sourceUrl}-${i}`}>
                <div className="card-media">
                  {item.type === 'video' ? (
                    <video src={item.url} poster={item.thumb} controls preload="metadata" />
                  ) : (
                    <a href={item.url} target="_blank" rel="noopener noreferrer">
                      <img
                        src={item.thumb}
                        alt={item.title}
                        loading="lazy"
                        decoding="async"
                        onError={hideBrokenImage}
                      />
                    </a>
                  )}
                </div>
                <div className="card-body">
                  <div className="card-title">{item.title}</div>
                  <div className="card-meta">
                    {item.author && <div>By: {item.author}</div>}
                    {item.license && <div>License: {item.license}</div>}
                  </div>
                  <div className="card-links">
                    <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">
                      View source
                    </a>
                    {item.type === 'video' && (
                      <a href={item.url} target="_blank" rel="noopener noreferrer">
                        Open video
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                ← Prev
              </button>
              <span>
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}

      {!loading && !items.length && !status && !error && (
        <div className="empty">Start by searching for a topic above.</div>
      )}

      <footer>
        Built with React &middot; Deployed on Vercel
      </footer>
    </div>
  )
}
