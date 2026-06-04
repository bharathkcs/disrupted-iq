import React, { useEffect, useState, useMemo } from 'react'
import { api } from '../services/api.js'
import { severityColor, Tag, InfoTooltip } from '../components/ui.jsx'

const WEATHER_ICONS = {
  'Thunderstorm': '⛈️',
  'Heavy Rain Showers': '🌧️',
  'Snow / Sleet': '❄️',
  'Heavy Rain': '🌧️',
  'Drizzle / Light Rain': '🌦️',
  'Fog': '🌫️',
  'Clear / Partly Cloudy': '⛅',
  'Clear Sky': '☀️',
}

function weatherDescription(code) {
  if (code >= 95) return 'Thunderstorm'
  if (code >= 80) return 'Heavy Rain Showers'
  if (code >= 71) return 'Snow / Sleet'
  if (code >= 61) return 'Heavy Rain'
  if (code >= 51) return 'Drizzle / Light Rain'
  if (code >= 45) return 'Fog'
  if (code >= 1) return 'Clear / Partly Cloudy'
  return 'Clear Sky'
}

function WeatherCard({ city, isRelevant, index }) {
  const sevColor = severityColor(city.severity_score || 0)
  const statusColor = city.alert_status === 'warning' ? 'var(--danger)' : city.alert_status === 'watch' ? 'var(--warning)' : 'var(--success)'
  const statusLabel = city.alert_status === 'warning' ? 'Warning' : city.alert_status === 'watch' ? 'Watch' : 'Clear'
  const description = weatherDescription(city.weathercode ?? 0)
  const icon = WEATHER_ICONS[description] || '🌤️'

  return (
    <div style={{
      padding: '20px',
      borderRadius: 12,
      background: isRelevant
        ? `linear-gradient(135deg, ${sevColor}15 0%, rgba(255,255,255,0.02) 100%)`
        : 'linear-gradient(135deg, rgba(124,107,255,0.12), rgba(96,165,250,0.06))',
      border: `1px solid ${isRelevant ? `${sevColor}35` : 'rgba(124,107,255,0.35)'}`,
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      transition: 'all 0.35s cubic-bezier(0.23, 1, 0.320, 1)',
      position: 'relative',
      overflow: 'hidden',
      animation: `bounce-in ${0.5 + index * 0.06}s cubic-bezier(0.23, 1, 0.320, 1)`,
      boxShadow: `inset 0 0 20px ${isRelevant ? sevColor + '08' : 'rgba(124,107,255,0.05)'}, 0 8px 24px rgba(0,0,0,0.3)`,
    }}
    onMouseOver={(e) => {
      e.currentTarget.style.transform = 'translateY(-3px)'
      e.currentTarget.style.boxShadow = `inset 0 0 30px ${isRelevant ? sevColor + '12' : 'rgba(124,107,255,0.1)'}, 0 0 1px ${isRelevant ? sevColor : 'rgba(124,107,255,0.5)'}, 0 0 20px ${isRelevant ? sevColor + '30' : 'rgba(124,107,255,0.3)'}, 0 12px 32px rgba(0,0,0,0.4)`
      e.currentTarget.style.borderColor = isRelevant ? `${sevColor}60` : 'rgba(124,107,255,0.5)'
    }}
    onMouseOut={(e) => {
      e.currentTarget.style.transform = 'translateY(0)'
      e.currentTarget.style.boxShadow = `inset 0 0 20px ${isRelevant ? sevColor + '08' : 'rgba(124,107,255,0.05)'}, 0 8px 24px rgba(0,0,0,0.3)`
      e.currentTarget.style.borderColor = isRelevant ? `${sevColor}35` : 'rgba(124,107,255,0.35)'
    }}
    >
      {/* Background glow */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(circle at 100% 0%, ${sevColor}20, transparent 60%)`,
        pointerEvents: 'none',
      }} />

      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 28 }}>{icon}</span>
            <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--text-pri)' }}>{city.name}</div>
          </div>
          <Tag color={sevColor} style={{ fontSize: 11, fontWeight: 700 }}>sev {city.severity_score ?? 0}</Tag>
        </div>

        <div style={{ fontSize: 12, color: 'var(--text-sec)', marginBottom: 12 }}>{description}</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div style={{ background: 'rgba(255,255,255,0.05)', padding: '10px 12px', borderRadius: 8 }}>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4, fontWeight: 600 }}>💨 Wind</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-pri)' }}>{city.wind_kmh ?? '-'} km/h</div>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.05)', padding: '10px 12px', borderRadius: 8 }}>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4, fontWeight: 600 }}>💧 Precipitation</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-pri)' }}>{city.precip_mm_24h ?? '-'} mm</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            Status: <span style={{ color: statusColor, fontWeight: 800 }}>{statusLabel}</span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>
            {city.last_updated_utc?.replace('T', ' ').slice(0, 16) || '-'}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function WeatherMonitor() {
  const [weather, setWeather] = useState({ cities: [] })
  const [events, setEvents] = useState([])
  const [isRefreshing, setIsRefreshing] = useState(false)

  const loadData = async () => {
    try {
      setIsRefreshing(true)
      const [weatherData, eventData] = await Promise.all([
        api.weatherCurrent(),
        api.reportEventLog({ source: 'Open-Meteo' }),
      ])
      setWeather(weatherData || { cities: [] })
      setEvents(eventData || [])
    } catch (err) {
      console.error('Weather load error:', err)
    } finally {
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    let alive = true
    loadData()
    const t = setInterval(() => { if (alive) loadData() }, 5000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  const relevantCities = useMemo(() => (weather.cities || []).filter(c => c.relevant_to_client), [weather.cities])
  const otherCities = useMemo(() => (weather.cities || []).filter(c => !c.relevant_to_client), [weather.cities])

  return (
    <div style={{ maxWidth: 1700, margin: '0 auto', width: '100%', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div className="panel" style={{
        background: 'linear-gradient(135deg, rgba(96,165,250,0.1) 0%, rgba(45,212,191,0.05) 100%)',
        border: '1px solid rgba(96,165,250,0.2)',
        borderRadius: 16,
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '32px 28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
        }}>
          <div style={{ flex: 1, minWidth: 300 }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-pri)', marginBottom: 4 }}>🌤️ Weather Monitor</div>
            <div style={{ color: 'var(--text-sec)', lineHeight: 1.6, maxWidth: 600, fontSize: 14 }}>
              Real-time weather conditions for every city where your suppliers operate. Severe conditions automatically trigger AI analysis if severity exceeds your threshold.
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" onClick={loadData} disabled={isRefreshing} style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              whiteSpace: 'nowrap',
            }}>
              {isRefreshing ? '↻' : '↻'} {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </button>
            <Tag color="var(--info)" style={{ fontSize: 12, fontWeight: 600 }}>Auto-refresh 5s</Tag>
          </div>
        </div>
      </div>

      {weather.client_zones && weather.client_zones.length > 0 && (
        <div style={{
          fontSize: 13,
          color: 'var(--success)',
          padding: '12px 16px',
          background: 'linear-gradient(135deg, rgba(34,197,94,0.12), rgba(45,212,191,0.06))',
          border: '1px solid rgba(34,197,94,0.3)',
          borderRadius: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          animation: 'slideIn 0.3s ease-out',
        }}>
          <span style={{ fontSize: 16 }}>✓</span>
          <span><strong>Showing your {weather.client_zones.length} supplier zone{weather.client_zones.length !== 1 ? 's' : ''}</strong> first — these are critical to monitor</span>
        </div>
      )}

      {relevantCities.length > 0 && (
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-pri)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>📍</span> Your Supplier Zones
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
            {relevantCities.map((city, i) => <WeatherCard key={city.name} city={city} isRelevant={true} index={i} />)}
          </div>
        </div>
      )}

      {relevantCities.length === 0 && otherCities.length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '48px 20px',
          background: 'linear-gradient(135deg, rgba(96,165,250,0.08), rgba(45,212,191,0.03))',
          border: '1px solid rgba(96,165,250,0.2)',
          borderRadius: 14,
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🌤️</div>
          {weather.client_zones && weather.client_zones.length > 0 ? (
            <>
              <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 8, color: 'var(--text-pri)' }}>
                Weather data not yet available
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-sec)', maxWidth: 520, margin: '0 auto', lineHeight: 1.7 }}>
                Your suppliers are in zones not yet covered by live monitoring
                ({weather.client_zones.slice(0, 5).join(', ')}{weather.client_zones.length > 5 ? ` and ${weather.client_zones.length - 5} more` : ''}).
                Global coverage is expanding — refresh to see updates.
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 6, color: 'var(--text-pri)' }}>No supplier zones yet</div>
              <div style={{ fontSize: 13, color: 'var(--text-sec)' }}>Upload suppliers to see weather for your regions</div>
            </>
          )}
        </div>
      )}

      {otherCities.length > 0 && weather.client_zones && weather.client_zones.length > 0 && (
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-pri)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>🌍</span> Other Monitored Regions
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
            {otherCities.map((city, i) => <WeatherCard key={city.name} city={city} isRelevant={false} index={i} />)}
          </div>
        </div>
      )}

      {/* Events Table */}
      <div className="panel" style={{
        background: 'linear-gradient(135deg, rgba(124,107,255,0.08), rgba(96,165,250,0.03))',
        border: '1px solid rgba(124,107,255,0.25)',
        borderRadius: 14,
      }}>
        <div style={{
          padding: '18px 24px',
          background: 'rgba(124,107,255,0.12)',
          borderBottom: '1px solid rgba(124,107,255,0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16 }}>⚡</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-pri)' }}>Recent Weather-Triggered Events</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <InfoTooltip title="Weather Events" description="Real-time weather alerts automatically cross-referenced with your supplier zones. A weather event here may trigger an AI disruption analysis if severity crosses your configured threshold." />
            <button className="btn btn-sm btn-primary" onClick={() => api.reportEventLog({ source: 'Open-Meteo' }).then(setEvents).catch(() => {})}>Refresh</button>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Event ID</th>
                <th>Geography</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: '24px', color: 'var(--text-dim)' }}>
                    No weather-triggered events yet
                  </td>
                </tr>
              ) : events.map((row, i) => (
                <tr key={row.event_id} style={{ animation: `slideUp ${0.3 + i * 0.05}s ease-out` }}>
                  <td className="mono" style={{ fontWeight: 700, color: 'var(--primary)' }}>{row.event_id}</td>
                  <td>{row.geography}</td>
                  <td style={{ fontWeight: 700 }}>{row.severity}</td>
                  <td>{row.status}</td>
                  <td className="mono">{row.timestamp_utc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
