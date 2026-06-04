import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../services/api.js'

export default function SearchModal({ isOpen, onClose }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [savedSearches, setSavedSearches] = useState([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef(null)
  const searchTimeoutRef = useRef(null)
  const navigate = useNavigate()

  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem('saved_searches') || '[]')
    setSavedSearches(saved)
  }, [])

  useEffect(() => {
    if (!isOpen) return
    inputRef.current?.focus()
  }, [isOpen])

  useEffect(() => {
    setFocusedIndex(0)

    if (query.trim().length < 2) {
      setResults([])
      return
    }

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    setLoading(true)
    searchTimeoutRef.current = setTimeout(() => {
      api.search(query, 'events,suppliers,audit', 20)
        .then(res => {
          const grouped = res.results || []
          setResults(grouped)
        })
        .catch(err => console.error('Search failed', err))
        .finally(() => setLoading(false))
    }, 300)

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
    }
  }, [query])

  const handleSaveSearch = () => {
    if (query.trim().length < 2 || results.length === 0) return
    const updated = [query, ...savedSearches.filter(s => s !== query)].slice(0, 5)
    setSavedSearches(updated)
    localStorage.setItem('saved_searches', JSON.stringify(updated))
  }

  const handleSelectSavedSearch = (savedQuery) => {
    setQuery(savedQuery)
  }

  const handleNavigate = (result) => {
    navigate(result.href)
    onClose()
  }

  const handleKeyDown = e => {
    if (e.key === 'Escape') {
      onClose()
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIndex(prev => (prev + 1) % Math.max(results.length, 1))
      return
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIndex(prev => (prev - 1 + Math.max(results.length, 1)) % Math.max(results.length, 1))
      return
    }

    if (e.key === 'Enter' && results.length > 0) {
      e.preventDefault()
      handleNavigate(results[focusedIndex])
      return
    }
  }

  if (!isOpen) return null

  const getTypeIcon = type => {
    switch (type) {
      case 'events':
        return '📋'
      case 'suppliers':
        return '🏭'
      case 'audit':
        return '📝'
      default:
        return '🔍'
    }
  }

  const grouped = {}
  results.forEach(r => {
    if (!grouped[r.type]) grouped[r.type] = []
    grouped[r.type].push(r)
  })

  const resultsByGroup = Object.entries(grouped).map(([type, items]) => ({ type, items }))

  let flatIndex = 0
  const getGroupResult = (type, itemIndex) => {
    for (const group of resultsByGroup) {
      if (group.type === type) {
        return group.items[itemIndex]
      }
      flatIndex += group.items.length
    }
    return null
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0, 0, 0, 0.72)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          maxWidth: 640,
          width: '100%',
          margin: '80px 20px 0 20px',
          padding: 24,
          borderRadius: 'var(--radius)',
          background: 'var(--bg-solid)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search events, suppliers, audit logs... (Ctrl+K to open)"
          style={{
            width: '100%',
            padding: '12px 16px',
            border: '1px solid var(--glass-border)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-panel)',
            color: 'var(--text-pri)',
            fontSize: 14,
            boxSizing: 'border-box',
            outline: 'none',
          }}
          onFocus={e => (e.target.style.borderColor = 'var(--primary)')}
          onBlur={e => (e.target.style.borderColor = 'var(--glass-border)')}
        />

        {query.trim().length === 0 && savedSearches.length > 0 && (
          <div style={{ marginTop: 16, paddingBottom: 16, borderBottom: '1px solid var(--glass-border)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 8 }}>
              Saved Searches
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {savedSearches.map((saved, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSelectSavedSearch(saved)}
                  style={{
                    padding: '4px 12px',
                    background: 'rgba(124, 107, 255, 0.15)',
                    border: '1px solid rgba(124, 107, 255, 0.3)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--primary)',
                    fontSize: 11,
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  {saved}
                </button>
              ))}
            </div>
          </div>
        )}

        {loading && query.trim().length >= 2 && (
          <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-dim)', textAlign: 'center' }}>
            Searching...
          </div>
        )}

        {query.trim().length >= 2 && !loading && results.length === 0 && (
          <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-dim)', textAlign: 'center' }}>
            No results found
          </div>
        )}

        {results.length > 0 && (
          <>
            <div style={{ marginTop: 16, maxHeight: 400, overflowY: 'auto' }}>
              {resultsByGroup.map((group, groupIdx) => (
                <div key={group.type}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', marginTop: groupIdx > 0 ? 12 : 0, marginBottom: 8 }}>
                    {group.type.charAt(0).toUpperCase() + group.type.slice(1)}
                  </div>
                  {group.items.map((item, itemIdx) => {
                    let globalIdx = 0
                    for (let i = 0; i < groupIdx; i++) {
                      globalIdx += resultsByGroup[i].items.length
                    }
                    globalIdx += itemIdx

                    return (
                      <div
                        key={`${group.type}-${itemIdx}`}
                        onClick={() => handleNavigate(item)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          padding: '12px',
                          marginBottom: 4,
                          borderRadius: 'var(--radius-sm)',
                          background: globalIdx === focusedIndex ? 'rgba(124, 107, 255, 0.15)' : 'transparent',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={() => setFocusedIndex(globalIdx)}
                      >
                        <span style={{ fontSize: 16 }}>{getTypeIcon(group.type)}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-pri)' }}>{item.title}</div>
                          {item.subtitle && (
                            <div style={{ fontSize: 11, color: 'var(--text-sec)', marginTop: 2 }}>{item.subtitle}</div>
                          )}
                        </div>
                        <span style={{ fontSize: 14, color: 'var(--text-dim)' }}>→</span>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>

            {results.length > 0 && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--glass-border)' }}>
                <button
                  onClick={handleSaveSearch}
                  style={{
                    padding: '6px 12px',
                    background: 'rgba(124, 107, 255, 0.15)',
                    border: '1px solid rgba(124, 107, 255, 0.3)',
                    borderRadius: 'var(--radius-sm)',
                    color: 'var(--primary)',
                    fontSize: 11,
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  Save this search
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
