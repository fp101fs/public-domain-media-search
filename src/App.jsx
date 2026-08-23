import { useState } from 'react'
import { fetchWikimedia, fetchOpenverse, fetchLOC, fetchNASA } from './sources.js'

const TABS = [
  { key: 'wikimedia', label: 'Wikimedia' },
  { key: 'openverse', label: 'Openverse' },
  { key: 'loc', label: 'Library of Congress' },
  { key: 'nasa', label: 'NASA' },
]

export default function App() {
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState('wikimedia')
  const [mediaType, setMediaType] = useState('images')
  const [items, setItems] = useState([])
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function switchTab(key) {
    setTab(key)
    setItems([])
    setStatus('')
    setError('')
  }

  async function performSearch(e) {
    e?.preventDefault()
    const q = query.trim()
    if (!q) return

    setLoading(true)
    setError('')
    setItems([])
    setStatus('Searching...')

    try {
      let results = []
      if (tab === 'wikimedia') results = await fetchWikimedia(q, mediaType)
      else if (tab === 'openverse') results = await fetchOpenverse(q)
      else if (tab === 'loc') results = await fetchLOC(q)
      else if (tab === 'nasa') results = await fetchNASA(q)

      setItems(results)
      setStatus(results.length ? `${results.length} result(s)` : 'No results found.')
    } catch (err) {
      console.error(err)
      setStatus('')
      setError(err.message || 'Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

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

      {items.length > 0 && (
        <div className="results">
          {items.map((item, i) => (
            <div className="card" key={`${item.sourceUrl}-${i}`}>
              <div className="card-media">
                {item.type === 'video' ? (
                  <video src={item.url} poster={item.thumb} controls preload="metadata" />
                ) : (
                  <a href={item.url} target="_blank" rel="noopener noreferrer">
                    <img src={item.thumb} alt={item.title} loading="lazy" />
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
