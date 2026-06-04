import React, { useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { api } from '../services/api.js'
import { PanelHeader, Tag, InfoTooltip } from '../components/ui.jsx'
import InsightsPanel from '../components/InsightsPanel.jsx'
import FinancialHealthPanel from '../components/FinancialHealthPanel.jsx'
import ESGPanel from '../components/ESGPanel.jsx'
import BenchmarkStrip from '../components/BenchmarkStrip.jsx'

/* ─── Tile & colour helpers ────────────────────────────────────────────── */
const TILE_URL  = 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png'
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'

const HEALTH_COLOR = { healthy:'#2dd4bf', warning:'#f59e0b', critical:'#ef4444' }

function regionColor(lon, disrupted) {
  if (disrupted) return '#ef4444'
  if (lon < -30) return '#f59e0b'   // Americas
  if (lon <  20) return '#60a5fa'   // Europe
  if (lon <  55) return '#34d399'   // Middle East
  if (lon < 100) return '#2dd4bf'   // India / South Asia
  return '#a78bfa'                   // Asia-Pacific
}
function reliabilityLabel(v) {
  if (v >= 95) return { text:'Excellent',       color:'#2dd4bf' }
  if (v >= 85) return { text:'Good',            color:'#60a5fa' }
  if (v >= 70) return { text:'Fair — monitor',  color:'#f59e0b' }
  return              { text:'Poor — act now',  color:'#ef4444' }
}
function bufferLabel(d) {
  if (d >= 30) return { text:'Strong buffer',       color:'#2dd4bf' }
  if (d >= 14) return { text:'Adequate',            color:'#60a5fa' }
  if (d >=  7) return { text:'Low — replenish',     color:'#f59e0b' }
  return              { text:'Critical — depleted', color:'#ef4444' }
}
function healthMessage(h) {
  if (h === 'critical') return 'Multiple disruptions active. Immediate review required.'
  if (h === 'warning')  return 'Some suppliers at risk. Review and prepare alternatives.'
  return 'Network operating normally. No immediate action needed.'
}

/* ─── DivIcon builders ─────────────────────────────────────────────────── */

// Hexagon SVG with optional disruption ring
function hexSingleIcon(accent, disrupted) {
  const ring = disrupted
    ? `<circle cx="20" cy="20" r="17" fill="none" stroke="${accent}" stroke-width="1.5" opacity="0.5" style="animation:scPulseRing 1.6s ease-out infinite"/>`
    : ''
  const dot  = disrupted
    ? `<circle cx="20" cy="20" r="5" fill="${accent}"/>`
    : `<circle cx="20" cy="20" r="4" fill="${accent}"/>`
  const hex  = `<polygon points="20,5 33,12.5 33,27.5 20,35 7,27.5 7,12.5"
    fill="${accent}22" stroke="${accent}" stroke-width="2"
    style="filter:drop-shadow(0 0 4px ${accent}66)"/>`
  const html = `<div style="width:40px;height:40px;position:relative">${ring}<svg viewBox="0 0 40 40" width="40" height="40" style="position:absolute;inset:0">${hex}${dot}</svg></div>`
  return L.divIcon({ className:'sc-icon', html, iconSize:[40,40], iconAnchor:[20,20] })
}

function hexClusterIcon(count, accent, disrupted) {
  const ring = disrupted
    ? `<circle cx="22" cy="22" r="20" fill="none" stroke="${accent}" stroke-width="1.5" opacity="0.5" style="animation:scPulseRing 1.6s ease-out infinite"/>`
    : ''
  const hex  = `<polygon points="22,4 37,13 37,31 22,40 7,31 7,13"
    fill="${accent}30" stroke="${accent}" stroke-width="2.5"
    style="filter:drop-shadow(0 0 6px ${accent}88)"/>`
  const label= `<text x="22" y="26" text-anchor="middle" fill="${accent}" font-size="15" font-weight="900" font-family="monospace" style="filter:drop-shadow(0 0 2px #000)">${count}</text>`
  const html = `<div style="width:44px;height:44px;position:relative">${ring}<svg viewBox="0 0 44 44" width="44" height="44" style="position:absolute;inset:0">${hex}${label}</svg></div>`
  return L.divIcon({ className:'sc-icon', html, iconSize:[44,44], iconAnchor:[22,22] })
}

function hqStarIcon(disrupted) {
  const color = disrupted ? '#ef4444' : '#fbbf24'
  // Outer pulsing halo
  const halo1 = `<circle cx="24" cy="24" r="22" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.3" style="animation:scHqHalo 2.8s ease-in-out infinite"/>`
  const halo2 = `<circle cx="24" cy="24" r="16" fill="${color}18"/>`
  // 8-point star
  const star  = `<polygon points="24,6 27,17 38,17 29,24 32,35 24,28 16,35 19,24 10,17 21,17"
    fill="${color}" stroke="rgba(255,255,255,0.6)" stroke-width="1"
    style="filter:drop-shadow(0 0 8px ${color}cc)"/>`
  const lbl   = `<text x="24" y="28" text-anchor="middle" fill="#1f2937" font-size="10" font-weight="900" font-family="Inter,system-ui">HQ</text>`
  const html  = `<div style="width:48px;height:48px;position:relative"><svg viewBox="0 0 48 48" width="48" height="48" style="position:absolute;inset:0">${halo1}${halo2}${star}${lbl}</svg></div>`
  return L.divIcon({ className:'sc-icon', html, iconSize:[48,48], iconAnchor:[24,24] })
}

function portIcon(disrupted) {
  const color = disrupted ? '#ef4444' : '#60a5fa'
  const shape = `<rect x="5" y="5" width="22" height="22" rx="3"
    fill="${color}33" stroke="${color}" stroke-width="2.5"
    style="filter:drop-shadow(0 0 5px ${color}88)"/>`
  const cross = `<line x1="16" y1="9" x2="16" y2="23" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
    <line x1="9" y1="16" x2="23" y2="16" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`
  const html  = `<div style="width:32px;height:32px;position:relative"><svg viewBox="0 0 32 32" width="32" height="32" style="position:absolute;inset:0">${shape}${cross}</svg></div>`
  return L.divIcon({ className:'sc-icon', html, iconSize:[32,32], iconAnchor:[16,16] })
}

/* ─── Bezier arc waypoints ─────────────────────────────────────────────── */
function bezierWaypoints(from, to, bend, steps = 50) {
  const [fLat, fLon] = from, [tLat, tLon] = to
  const dLat = tLat - fLat, dLon = tLon - fLon
  const len   = Math.sqrt(dLat*dLat + dLon*dLon)
  if (len < 0.001) return [from, to]
  const mLat = (fLat+tLat)/2, mLon = (fLon+tLon)/2
  const nLat = -dLon/len,     nLon =  dLat/len
  const bow  = len * bend
  const cLat = mLat + nLat*bow, cLon = mLon + nLon*bow
  return Array.from({ length: steps+1 }, (_,i) => {
    const t = i/steps, u = 1-t
    return [u*u*fLat + 2*u*t*cLat + t*t*tLat,
            u*u*fLon + 2*u*t*cLon + t*t*tLon]
  })
}

/* ─── Animated shipment dots layer (pure Leaflet, no React-Leaflet) ────── */
function ShipmentDotsLayer({ routes, nodeById, hqNode }) {
  const map = useMap()
  const layerRef = useRef(null)
  const frameRef = useRef(null)
  const stateRef = useRef([])

  useEffect(() => {
    if (!map || !hqNode) return

    // Build per-route data once
    const routeData = routes
      .filter(r => r.kind === 'supplier_to_hq')
      .map((route, ri) => {
        const from = nodeById[route.from]
        if (!from || typeof from.lat !== 'number') return null
        const atRisk = route.status === 'at_risk'
        const color  = regionColor(from.lon, atRisk)
        const bend   = 0.18 + (ri % 7) * 0.045
        const wps    = bezierWaypoints([from.lat, from.lon], [hqNode.lat, hqNode.lon], bend, 50)
        return { wps, color, atRisk, speed: atRisk ? 0.012 : 0.008, t: ri * 0.15 % 1 }
      })
      .filter(Boolean)

    stateRef.current = routeData

    // Create a layer group
    const layer = L.layerGroup().addTo(map)
    layerRef.current = layer

    // Create one circle marker per route
    const markers = routeData.map(rd => {
      const m = L.circleMarker(rd.wps[0], {
        radius:      rd.atRisk ? 4 : 3,
        color:       rd.color,
        fillColor:   rd.color,
        fillOpacity: 1,
        weight:      1,
        opacity:     0.95,
        interactive: false,
        pane:        'markerPane',
      })
      m.addTo(layer)
      return m
    })

    let last = performance.now()
    function animate(now) {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      routeData.forEach((rd, i) => {
        rd.t = (rd.t + rd.speed * dt * 60) % 1
        const idx = Math.floor(rd.t * (rd.wps.length - 1))
        markers[i].setLatLng(rd.wps[idx])
      })
      frameRef.current = requestAnimationFrame(animate)
    }
    frameRef.current = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(frameRef.current)
      layer.remove()
    }
  }, [map, routes, nodeById, hqNode])

  return null
}

/* ─── FitBoundsController — fits map ONCE on first data load only ────────── */
function FitBoundsController({ nodes }) {
  const map = useMap()
  const fitted = useRef(false)
  useEffect(() => {
    if (fitted.current) return          // never re-fit after first time
    const valid = nodes.filter(n => typeof n.lat === 'number' && typeof n.lon === 'number')
    if (valid.length === 0) return
    fitted.current = true
    if (valid.length === 1) {
      map.setView([valid[0].lat, valid[0].lon], 8)
      return
    }
    const bounds = L.latLngBounds(valid.map(n => [n.lat, n.lon]))
    map.fitBounds(bounds, { padding: [70, 70], maxZoom: 10 })
  }, [nodes, map])
  return null
}

/* ─── MapController (flyTo) ────────────────────────────────────────────── */
function MapController({ flyTarget }) {
  const map = useMap()
  useEffect(() => {
    if (flyTarget) map.flyTo([flyTarget.lat, flyTarget.lon], flyTarget.zoom || 6, { duration: 1.6 })
  }, [flyTarget, map])
  return null
}

/* ─── Click outside deselect ───────────────────────────────────────────── */
function MapClickHandler({ onBgClick }) {
  useMapEvents({ click: onBgClick })
  return null
}

/* ─── Sidebar helpers ──────────────────────────────────────────────────── */
function StatCard({ label, value, color, sub, icon }) {
  return (
    <div style={{
      flex:1, minWidth:140, padding:'14px 16px', borderRadius:12,
      background:'rgba(255,255,255,0.03)',
      border:`1px solid rgba(255,255,255,0.07)`,
      display:'flex', flexDirection:'column', gap:4,
      boxShadow:'0 4px 20px rgba(0,0,0,0.3)',
    }}>
      <div style={{ fontSize:10, color:'rgba(148,163,184,0.7)', textTransform:'uppercase', letterSpacing:'0.08em', display:'flex', alignItems:'center', gap:5 }}>
        {icon && <span style={{ fontSize:13 }}>{icon}</span>}
        {label}
      </div>
      <div style={{ fontSize:24, fontWeight:800, color: color||'#f1f5f9', lineHeight:1 }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:'rgba(148,163,184,0.55)' }}>{sub}</div>}
    </div>
  )
}

function MetricBox({ label, value, valueColor, sub, bar }) {
  return (
    <div style={{ padding:'10px 12px', borderRadius:8, background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)' }}>
      <div style={{ fontSize:10, color:'rgba(148,163,184,0.6)', marginBottom:3 }}>{label}</div>
      <div style={{ fontSize:19, fontWeight:800, color: valueColor||'#f1f5f9' }}>{value}</div>
      {sub && <div style={{ fontSize:10, color: valueColor||'rgba(148,163,184,0.5)', marginTop:1 }}>{sub}</div>}
      {bar !== undefined && (
        <div style={{ marginTop:5, height:3, borderRadius:2, background:'rgba(255,255,255,0.08)' }}>
          <div style={{ height:'100%', borderRadius:2, width:`${Math.min(100,bar)}%`, background: valueColor||'#2dd4bf', transition:'width 0.4s ease' }}/>
        </div>
      )}
    </div>
  )
}

function NodeDetail({ node, onBack, supplierCount = 0 }) {
  if (!node) return null
  const isDisrupted = node.status === 'disrupted'
  const isPort = node.type === 'port'
  const isHQ   = node.type === 'hq'
  const rel  = reliabilityLabel(node.reliability || 0)
  const buf  = bufferLabel(node.buffer_stock_days || 0)

  const backBtn = onBack && (
    <button onClick={onBack} style={{
      alignSelf:'flex-start', cursor:'pointer', padding:'4px 12px', borderRadius:6,
      background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.12)',
      color:'rgba(148,163,184,0.8)', fontSize:11,
    }}>← Back</button>
  )

  if (isHQ) return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      {backBtn}
      <div style={{ fontSize:12, color:'rgba(148,163,184,0.75)', lineHeight:1.75 }}>
        Your <strong style={{ color:'#fbbf24' }}>HQ / factory</strong> in <strong style={{ color:'#fff' }}>{node.zone}</strong>. All supplier routes converge here.
      </div>
      <div style={{ padding:'12px 14px', borderRadius:10,
        background: isDisrupted ? 'rgba(239,68,68,0.08)' : 'rgba(251,191,36,0.07)',
        border:`1px solid ${isDisrupted ? 'rgba(239,68,68,0.3)' : 'rgba(251,191,36,0.25)'}` }}>
        <div style={{ fontSize:13, fontWeight:700, color: isDisrupted ? '#ef4444':'#fbbf24', marginBottom:4 }}>
          {isDisrupted ? '⚠ HQ region impacted' : '✓ HQ operating normally'}
        </div>
        <div style={{ fontSize:12, color:'rgba(148,163,184,0.7)', lineHeight:1.6 }}>
          {isDisrupted
            ? 'Disruption near HQ affects all inbound shipments. Open Dashboard for recovery options.'
            : 'No active disruptions. All inbound supplier flows are clear.'}
        </div>
      </div>
      <div style={{ padding:'12px 14px', borderRadius:10, background:'rgba(124,107,255,0.07)', border:'1px solid rgba(124,107,255,0.2)' }}>
        <div style={{ fontSize:10, color:'rgba(148,163,184,0.5)', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:4 }}>Network feeding in</div>
        <div style={{ fontSize:28, fontWeight:900, color:'#fff' }}>{supplierCount}</div>
        <div style={{ fontSize:11, color:'rgba(148,163,184,0.6)', marginTop:2 }}>active suppliers shipping to {node.zone}</div>
      </div>
    </div>
  )

  if (isPort) return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      {backBtn}
      <div style={{ fontSize:12, color:'rgba(148,163,184,0.75)', lineHeight:1.75 }}>
        <strong style={{ color:'#60a5fa' }}>Port hub</strong> — critical logistics gateway. Disruptions here affect all routed suppliers.
      </div>
      <div style={{ padding:'12px 14px', borderRadius:10,
        background: node.active_events?.length > 0 ? 'rgba(239,68,68,0.08)' : 'rgba(45,212,191,0.06)',
        border:`1px solid ${node.active_events?.length > 0 ? 'rgba(239,68,68,0.3)' : 'rgba(45,212,191,0.2)'}` }}>
        {node.active_events?.length > 0
          ? <><div style={{ fontSize:13, fontWeight:700, color:'#ef4444', marginBottom:4 }}>⚠ Port Disrupted</div>
              <div style={{ fontSize:12, color:'rgba(148,163,184,0.7)' }}>Consider rerouting via an alternate port.</div></>
          : <><div style={{ fontSize:13, fontWeight:700, color:'#2dd4bf', marginBottom:4 }}>✓ Port Operating Normally</div>
              <div style={{ fontSize:12, color:'rgba(148,163,184,0.7)' }}>All routes clear.</div></>}
      </div>
      {(node.active_events || []).map(ev => (
        <div key={ev.event_id} style={{ padding:'8px 12px', borderRadius:8, background:'rgba(239,68,68,0.07)', border:'1px solid rgba(239,68,68,0.2)' }}>
          <div style={{ fontSize:12, fontWeight:600, color:'#ef4444' }}>{ev.event_type} — Sev {ev.severity}/10</div>
          <div style={{ fontSize:11, color:'rgba(148,163,184,0.6)', marginTop:2 }}>📍 {ev.geography}</div>
        </div>
      ))}
    </div>
  )

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      {backBtn}
      {/* Status banner */}
      <div style={{ padding:'12px 14px', borderRadius:10,
        background: isDisrupted ? 'rgba(239,68,68,0.08)' : 'rgba(45,212,191,0.06)',
        border:`1px solid ${isDisrupted ? 'rgba(239,68,68,0.3)' : 'rgba(45,212,191,0.2)'}` }}>
        <div style={{ fontSize:13, fontWeight:700, color: isDisrupted ? '#ef4444':'#2dd4bf', marginBottom:4 }}>
          {isDisrupted ? '🔴 Supplier Disrupted' : '🟢 Operating Normally'}
        </div>
        <div style={{ fontSize:12, color:'rgba(148,163,184,0.7)', lineHeight:1.55 }}>
          {isDisrupted ? 'This supplier is impacted. Check Dashboard for recovery options.' : 'No active disruptions detected. Continue monitoring.'}
        </div>
      </div>

      {/* Metrics grid */}
      <div>
        <div style={{ fontSize:10, color:'rgba(148,163,184,0.5)', fontWeight:700, letterSpacing:'0.07em', textTransform:'uppercase', marginBottom:8 }}>Supplier Health</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
          <MetricBox label="Reliability" value={`${node.reliability||0}%`} valueColor={rel.color} sub={rel.text} bar={node.reliability||0}/>
          <MetricBox label="Buffer Stock" value={`${node.buffer_stock_days||0}d`} valueColor={buf.color} sub={buf.text} bar={Math.min(100,(node.buffer_stock_days||0)/30*100)}/>
          <MetricBox label="Sites" value={node.sites||1} valueColor="#f1f5f9" sub={node.sites>1?'Multi-site':'Single site'}/>
          <MetricBox label="Criticality"
            value={(node.criticality||'medium')[0].toUpperCase()+(node.criticality||'medium').slice(1)}
            valueColor={node.criticality==='critical'?'#ef4444':node.criticality==='high'?'#f59e0b':'#2dd4bf'}
            sub="Network impact"/>
        </div>
      </div>

      {/* Categories */}
      {(node.categories||[]).length > 0 && (
        <div>
          <div style={{ fontSize:10, color:'rgba(148,163,184,0.5)', fontWeight:700, letterSpacing:'0.07em', textTransform:'uppercase', marginBottom:8 }}>What They Supply</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
            {(node.categories||[]).map(cat => (
              <span key={cat} style={{ padding:'3px 10px', borderRadius:20, background:'rgba(124,107,255,0.14)', border:'1px solid rgba(124,107,255,0.28)', fontSize:11, color:'#a78bfa' }}>{cat}</span>
            ))}
          </div>
        </div>
      )}

      {/* Active events */}
      {(node.active_events||[]).length > 0 && (
        <div>
          <div style={{ fontSize:10, color:'#ef4444', fontWeight:700, letterSpacing:'0.07em', textTransform:'uppercase', marginBottom:8 }}>Active Disruptions</div>
          {(node.active_events||[]).map(ev => (
            <div key={ev.event_id} style={{ padding:'8px 12px', borderRadius:8, marginBottom:6, background:'rgba(239,68,68,0.07)', border:'1px solid rgba(239,68,68,0.2)' }}>
              <div style={{ fontSize:12, fontWeight:600, color:'#ef4444' }}>{ev.event_type} — Sev {ev.severity}/10</div>
              <div style={{ fontSize:11, color:'rgba(148,163,184,0.6)', marginTop:2 }}>📍 {ev.geography}</div>
            </div>
          ))}
        </div>
      )}

      {/* Action hints */}
      {(isDisrupted || (node.buffer_stock_days||0) < 14) && (
        <div style={{ padding:'12px 14px', borderRadius:10, background:'rgba(245,158,11,0.07)', border:'1px solid rgba(245,158,11,0.22)' }}>
          <div style={{ fontSize:12, fontWeight:700, color:'#f59e0b', marginBottom:8 }}>Recommended Actions</div>
          <ul style={{ margin:0, paddingLeft:16, fontSize:12, color:'rgba(148,163,184,0.75)', lineHeight:2 }}>
            {isDisrupted && <li>Open Dashboard → review recovery options</li>}
            {isDisrupted && <li>Identify backup supplier for these categories</li>}
            {(node.buffer_stock_days||0) < 7  && <li style={{ color:'#ef4444', fontWeight:700 }}>Buffer critically low — expedite now</li>}
            {(node.buffer_stock_days||0) >= 7 && (node.buffer_stock_days||0) < 14 && <li>Begin replenishment to restore buffer</li>}
          </ul>
        </div>
      )}
    </div>
  )
}

function ClusterDetail({ cluster, onSelectNode }) {
  const hasDisrupted = cluster.some(n => n.status === 'disrupted')
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
      <div style={{ fontSize:12, color:'rgba(148,163,184,0.7)', lineHeight:1.7 }}>
        <strong style={{ color:'#f1f5f9' }}>{cluster.length} suppliers</strong> in{' '}
        <strong style={{ color:'#a78bfa' }}>{cluster[0].zone}</strong>. Select one to view its health profile.
      </div>
      {hasDisrupted && (
        <div style={{ padding:'8px 12px', borderRadius:8, background:'rgba(239,68,68,0.07)', border:'1px solid rgba(239,68,68,0.25)', fontSize:12, color:'#ef4444', fontWeight:600 }}>
          ⚠ One or more suppliers here are disrupted
        </div>
      )}
      <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
        {cluster.map(node => {
          const isD = node.status === 'disrupted'
          const rel = reliabilityLabel(node.reliability || 0)
          return (
            <button key={node.id} onClick={() => onSelectNode(node)} style={{
              textAlign:'left', width:'100%', cursor:'pointer',
              padding:'10px 14px', borderRadius:10,
              background: isD ? 'rgba(239,68,68,0.05)' : 'rgba(255,255,255,0.03)',
              border:`1px solid ${isD ? 'rgba(239,68,68,0.3)':'rgba(255,255,255,0.07)'}`,
              borderLeft:`3px solid ${isD ? '#ef4444':'#2dd4bf'}`,
              transition:'all 0.15s',
            }}
              onMouseEnter={e => { e.currentTarget.style.background = isD ? 'rgba(239,68,68,0.1)':'rgba(124,107,255,0.1)' }}
              onMouseLeave={e => { e.currentTarget.style.background = isD ? 'rgba(239,68,68,0.05)':'rgba(255,255,255,0.03)' }}
            >
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:3 }}>
                <span style={{ fontSize:12, fontWeight:700, color: isD ? '#ef4444':'#f1f5f9' }}>{node.name}</span>
                <span style={{ fontSize:11, fontWeight:800, color: rel.color }}>{node.reliability||0}%</span>
              </div>
              <div style={{ fontSize:10, color:'rgba(148,163,184,0.5)' }}>
                {(node.categories||[]).slice(0,3).join(' · ')}{(node.categories||[]).length > 3 && ` +${(node.categories||[]).length-3}`}
              </div>
              {isD && <div style={{ fontSize:10, color:'#ef4444', marginTop:3, fontWeight:600 }}>⚠ Disrupted — click for details →</div>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ─── Main page ────────────────────────────────────────────────────────── */
export default function SupplyChainMap() {
  const [data,           setData]           = useState(null)
  const [error,          setError]          = useState(null)
  const [selected,       setSelected]       = useState(null)
  const [clusterSel,     setClusterSel]     = useState(null)
  const [prevCluster,    setPrevCluster]    = useState(null)
  const [isRefreshing,   setIsRefreshing]   = useState(false)
  const [flyTarget,      setFlyTarget]      = useState(null)

  const loadMap = async () => {
    try {
      setIsRefreshing(true)
      const d = await api.supplyChainMap()
      setData(d)
      setError(null)
    } catch(err) {
      setError(String(err))
    } finally {
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    let alive = true
    loadMap()
    const t = setInterval(() => { if (alive) loadMap() }, 5000)
    return () => { alive = false; clearInterval(t) }
  }, [])

  if (error) return (
    <div style={{ maxWidth:1700, margin:'0 auto', padding:16 }}>
      <div className="panel panel-pad" style={{ color:'var(--danger)' }}>Failed to load map: {error}</div>
    </div>
  )
  if (!data) return (
    <div style={{ maxWidth:1700, margin:'0 auto', padding:16 }}>
      <div className="panel panel-pad"><span className="mono c-dim">Loading your supply network…</span></div>
    </div>
  )

  const { nodes, routes, summary } = data
  const nodeById      = Object.fromEntries(nodes.map(n => [n.id, n]))
  const hqNode        = nodes.find(n => n.type === 'hq') || null
  const supplierNodes = nodes.filter(n => n.type !== 'port' && n.type !== 'hq')
  const portNodes     = nodes.filter(n => n.type === 'port')
  const hqRoutes      = routes.filter(r => r.kind === 'supplier_to_hq')
  const disruptedCount = supplierNodes.filter(n => n.status === 'disrupted').length

  // Group suppliers by zone
  const locationGroups = {}
  supplierNodes.forEach(n => {
    const k = n.zone || `${Math.round(n.lon*10)}_${Math.round(n.lat*10)}`
    if (!locationGroups[k]) locationGroups[k] = []
    locationGroups[k].push(n)
  })

  // Map initial view
  const allLats = nodes.map(n=>n.lat).filter(v=>typeof v==='number')
  const allLons = nodes.map(n=>n.lon).filter(v=>typeof v==='number')
  const center  = allLats.length > 0
    ? [(Math.min(...allLats)+Math.max(...allLats))/2, (Math.min(...allLons)+Math.max(...allLons))/2]
    : [20, 78]
  const initZoom = allLats.length > 0 ? (Math.max(...allLons)-Math.min(...allLons) > 60 ? 2 : 4) : 4

  const handleClusterClick = group => {
    if (group.length === 1) { setSelected(group[0]); setClusterSel(null); setPrevCluster(null) }
    else                    { setClusterSel(group);  setSelected(null);   setPrevCluster(null) }
  }
  const handleNodeFromCluster = (node, cluster) => {
    setPrevCluster(cluster); setSelected(node); setClusterSel(null)
  }
  const clearSelection = () => { setSelected(null); setClusterSel(null); setPrevCluster(null) }

  const hc = summary.overall_health
  const hColor = HEALTH_COLOR[hc] || '#2dd4bf'

  return (
    <div style={{ maxWidth:1700, margin:'0 auto', width:'100%', padding:16, display:'flex', flexDirection:'column', gap:14 }}>

      {/* ── Global CSS injected once ── */}
      <style>{`
        /* Leaflet dark overrides */
        .leaflet-container { background:#04070f !important; font-family: inherit; }
        .leaflet-control-zoom a {
          background:rgba(10,13,36,0.95) !important;
          color:#94a3b8 !important;
          border:1px solid rgba(124,107,255,0.25) !important;
          transition: all .15s;
        }
        .leaflet-control-zoom a:hover { background:rgba(124,107,255,0.2) !important; color:#fff !important; }
        .leaflet-bar { box-shadow:0 4px 20px rgba(0,0,0,0.6) !important; border-radius:8px !important; overflow:hidden; border:none !important; }
        .leaflet-control-attribution {
          background:rgba(4,7,15,0.75) !important; color:rgba(148,163,184,0.4) !important;
          font-size:9px !important; border-radius:6px 0 0 0 !important;
        }
        .leaflet-control-attribution a { color:rgba(124,107,255,0.7) !important; }
        /* Remove default blue Leaflet marker shadow */
        .sc-icon { background:transparent !important; border:none !important; }
        /* Keyframes used inside DivIcon HTML (injected into page scope) */
        @keyframes scPulseRing {
          0%   { r:14; opacity:.7; }
          100% { r:28; opacity:0;  }
        }
        @keyframes scHqHalo {
          0%,100% { opacity:.15; transform:scale(.9); }
          50%     { opacity:.5;  transform:scale(1.15); }
        }
      `}</style>

      {/* ── Header ── */}
      <div style={{
        padding:'16px 20px', borderRadius:14,
        background:'linear-gradient(135deg, rgba(10,13,36,0.9) 0%, rgba(20,14,50,0.9) 100%)',
        border:'1px solid rgba(124,107,255,0.15)',
        boxShadow:'0 8px 32px rgba(0,0,0,0.4)',
        backdropFilter:'blur(12px)',
        display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:14,
      }}>
        <div>
          <div style={{ fontSize:18, fontWeight:800, color:'#f1f5f9', marginBottom:6, letterSpacing:'-0.01em' }}>
            🌐 Supply Chain Digital Twin
          </div>
          <div style={{ fontSize:13, color:'rgba(148,163,184,0.8)', maxWidth:680, lineHeight:1.7 }}>
            Real-world map of your entire supply network.{' '}
            {hqNode && <><strong style={{ color:'#fbbf24' }}>★ Gold star</strong> = HQ.{' '}</>}
            <strong style={{ color:'#ef4444' }}>Red</strong> = disrupted.{' '}
            <strong style={{ color:'#a78bfa' }}>Coloured arcs</strong> = live shipment flows.{' '}
            <strong style={{ color:'#2dd4bf' }}>Hexagons</strong> = supplier clusters — click to explore.
          </div>
        </div>
        <div style={{
          padding:'12px 16px', borderRadius:12, minWidth:230,
          background: hc==='critical' ? 'rgba(239,68,68,0.1)' : hc==='warning' ? 'rgba(245,158,11,0.1)' : 'rgba(45,212,191,0.07)',
          border:`1px solid ${hc==='critical'?'rgba(239,68,68,0.3)':hc==='warning'?'rgba(245,158,11,0.25)':'rgba(45,212,191,0.2)'}`,
        }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
            <div style={{ width:8, height:8, borderRadius:'50%', background: hColor,
              boxShadow:`0 0 8px ${hColor}`, animation: hc!=='healthy' ? 'scPulseRing 2s ease-out infinite' : 'none' }}/>
            <div style={{ fontSize:10, color:'rgba(148,163,184,0.6)', textTransform:'uppercase', letterSpacing:'0.08em', fontWeight:700 }}>{hc.toUpperCase()} STATUS</div>
          </div>
          <div style={{ fontSize:12, color:'rgba(148,163,184,0.8)', lineHeight:1.6 }}>{healthMessage(hc)}</div>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        <StatCard icon="🏥" label="Network Health"      value={hc.toUpperCase()}     color={hColor} sub="Based on active disruptions"/>
        <StatCard icon="⚠️" label="Disrupted Suppliers" value={`${disruptedCount} / ${supplierNodes.length}`}
          color={disruptedCount>0?'#ef4444':'#2dd4bf'} sub={disruptedCount>0?'Currently impacted':'All suppliers active'}/>
        <StatCard icon="🛣️" label="At-Risk Routes"      value={`${summary.at_risk_routes} / ${summary.total_routes}`}
          color={summary.at_risk_routes>0?'#f59e0b':'#2dd4bf'} sub={summary.at_risk_routes>0?'Lanes under stress':'All routes clear'}/>
        <StatCard icon="📋" label="Open Disruptions"   value={summary.active_disruptions}
          color={summary.active_disruptions>0?'#f59e0b':'#94a3b8'} sub={summary.active_disruptions>0?'Events requiring review':'No open events'}/>
      </div>

      {supplierNodes.length === 0 ? (
        <div style={{ textAlign:'center', padding:'80px 20px', borderRadius:14, background:'rgba(255,255,255,0.02)', border:'1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize:48, marginBottom:16 }}>🗺️</div>
          <div style={{ fontSize:16, fontWeight:700, marginBottom:6, color:'#f1f5f9' }}>No suppliers uploaded yet</div>
          <div style={{ fontSize:13, color:'rgba(148,163,184,0.55)', maxWidth:420, margin:'0 auto', lineHeight:1.7 }}>
            Your global supply network will appear here once you upload your suppliers. Head to Account Settings → Supplier Upload to get started.
          </div>
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) 400px', gap:14 }}>

          {/* ── Map panel ── */}
          <div style={{
            borderRadius:14, overflow:'hidden',
            border:'1px solid rgba(96,165,250,0.12)',
            boxShadow:'0 8px 40px rgba(0,0,0,0.5)',
            background:'rgba(4,7,15,0.95)',
          }}>
            {/* Map header */}
            <div style={{
              padding:'12px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8,
              background:'rgba(10,13,36,0.8)', borderBottom:'1px solid rgba(96,165,250,0.1)',
            }}>
              <div style={{ fontSize:13, fontWeight:700, color:'#f1f5f9', display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ fontSize:16 }}>🛰️</span> Live Basemap
                {isRefreshing && <span style={{ fontSize:10, color:'#a78bfa', fontWeight:400 }}>↻ Updating…</span>}
              </div>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                {hqNode && (
                  <button style={{
                    cursor:'pointer', padding:'5px 12px', borderRadius:8, fontSize:11, fontWeight:600,
                    background:'rgba(251,191,36,0.1)', border:'1px solid rgba(251,191,36,0.3)', color:'#fbbf24',
                    transition:'all .15s',
                  }}
                    onMouseEnter={e=>{e.currentTarget.style.background='rgba(251,191,36,0.2)'}}
                    onMouseLeave={e=>{e.currentTarget.style.background='rgba(251,191,36,0.1)'}}
                    onClick={() => setFlyTarget({ lat: hqNode.lat, lon: hqNode.lon, zoom: 6, ts: Date.now() })}
                  >★ Zoom to HQ</button>
                )}
                <button style={{
                  cursor:'pointer', padding:'5px 12px', borderRadius:8, fontSize:11, fontWeight:600,
                  background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', color:'rgba(148,163,184,0.8)',
                  transition:'all .15s',
                }} onClick={loadMap} disabled={isRefreshing}>
                  ↻ Refresh
                </button>
                <span style={{ fontSize:10, color:'rgba(148,163,184,0.4)' }}>
                  {new Date(data.last_updated_utc).toLocaleTimeString()}
                </span>
              </div>
            </div>

            {/* Leaflet container */}
            <div style={{ height:580, position:'relative' }}>
              <MapContainer
                center={center}
                zoom={initZoom}
                scrollWheelZoom
                worldCopyJump
                style={{ height:'100%', width:'100%', background:'#04070f' }}
              >
                <TileLayer attribution={TILE_ATTR} url={TILE_URL} subdomains="abcd" maxZoom={20} />
                <FitBoundsController nodes={nodes} />
                <MapController flyTarget={flyTarget} />
                <MapClickHandler onBgClick={clearSelection} />

                {/* Curved supply routes */}
                {hqNode && hqRoutes.map((route, ri) => {
                  const from = nodeById[route.from]
                  if (!from || typeof from.lat !== 'number') return null
                  const atRisk = route.status === 'at_risk'
                  const color  = regionColor(from.lon, atRisk)
                  const bend   = 0.18 + (ri % 7) * 0.045
                  const wps    = bezierWaypoints([from.lat, from.lon], [hqNode.lat, hqNode.lon], bend, 50)
                  return (
                    <Polyline key={route.id} positions={wps} pathOptions={{
                      color, weight: atRisk ? 2.5 : 1.8,
                      opacity: atRisk ? 0.9 : 0.65,
                      dashArray: atRisk ? '8,6' : undefined,
                    }}/>
                  )
                })}

                {/* Animated shipment dots */}
                {hqNode && (
                  <ShipmentDotsLayer routes={hqRoutes} nodeById={nodeById} hqNode={hqNode} />
                )}

                {/* Port markers */}
                {portNodes.map(node => {
                  if (typeof node.lat !== 'number') return null
                  return (
                    <Marker key={node.id} position={[node.lat, node.lon]}
                      icon={portIcon(node.status === 'disrupted')}
                      eventHandlers={{ click: () => { setSelected(node); setClusterSel(null); setPrevCluster(null) } }}
                    />
                  )
                })}

                {/* Supplier zone hexagons */}
                {Object.entries(locationGroups).map(([key, group]) => {
                  const vg  = group.filter(n => typeof n.lat === 'number')
                  if (!vg.length) return null
                  const lat = vg.reduce((s,n)=>s+n.lat,0)/vg.length
                  const lon = vg.reduce((s,n)=>s+n.lon,0)/vg.length
                  const hasD = vg.some(n=>n.status==='disrupted')
                  const allD = vg.every(n=>n.status==='disrupted')
                  const accent = hasD ? (allD ? '#ef4444':'#f97316') : '#2dd4bf'
                  const icon   = vg.length > 1 ? hexClusterIcon(vg.length, accent, hasD) : hexSingleIcon(accent, hasD)
                  return (
                    <Marker key={key} position={[lat, lon]} icon={icon}
                      eventHandlers={{ click: () => handleClusterClick(vg) }}
                    />
                  )
                })}

                {/* HQ star — highest z-index */}
                {hqNode && typeof hqNode.lat === 'number' && (
                  <Marker
                    position={[hqNode.lat, hqNode.lon]}
                    icon={hqStarIcon(hqNode.status === 'disrupted')}
                    zIndexOffset={1000}
                    eventHandlers={{ click: () => { setSelected(hqNode); setClusterSel(null); setPrevCluster(null) } }}
                  />
                )}
              </MapContainer>
            </div>

            {/* Legend bar */}
            <div style={{
              padding:'10px 16px', display:'flex', gap:14, flexWrap:'wrap', alignItems:'center',
              background:'rgba(6,9,24,0.85)', borderTop:'1px solid rgba(255,255,255,0.05)',
            }}>
              <span style={{ fontSize:9, color:'rgba(148,163,184,0.4)', textTransform:'uppercase', letterSpacing:'0.1em', marginRight:4 }}>Legend</span>
              {[
                ...(hqNode ? [{ c:'#fbbf24', label:'HQ', shape:'star' }] : []),
                { c:'#2dd4bf', label:'Supplier',  shape:'circle' },
                { c:'#ef4444', label:'Disrupted', shape:'pulse'  },
                { c:'#60a5fa', label:'Port hub',  shape:'square' },
                { c:'#f59e0b', label:'Americas',  shape:'arrow'  },
                { c:'#60a5fa', label:'Europe',    shape:'arrow'  },
                { c:'#34d399', label:'Mid-East',  shape:'arrow'  },
                { c:'#2dd4bf', label:'India',     shape:'arrow'  },
                { c:'#a78bfa', label:'Asia-Pac',  shape:'arrow'  },
                { c:'#7c6bff', label:'Cluster',   shape:'ring'   },
              ].map(({c,label,shape}) => (
                <div key={label} style={{ display:'flex', alignItems:'center', gap:5 }}>
                  {shape==='star'   ? <span style={{ color:c, fontSize:13 }}>★</span>
                   :shape==='square' ? <div style={{ width:8, height:8, background:c }}/>
                   :shape==='ring'   ? <div style={{ width:9, height:9, borderRadius:'50%', border:`2px solid ${c}` }}/>
                   :shape==='arrow'  ? <span style={{ color:c, fontSize:13, fontWeight:800 }}>→</span>
                   :shape==='pulse'  ? <div style={{ width:8, height:8, borderRadius:'50%', background:c, boxShadow:`0 0 6px ${c}` }}/>
                                     : <div style={{ width:8, height:8, borderRadius:'50%', background:c }}/>}
                  <span style={{ fontSize:9, color:'rgba(148,163,184,0.55)', fontFamily:'monospace' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Right detail panel ── */}
          <div style={{
            borderRadius:14, overflow:'hidden',
            border:'1px solid rgba(124,107,255,0.15)',
            boxShadow:'0 8px 40px rgba(0,0,0,0.4)',
            background:'rgba(10,13,36,0.92)',
            alignSelf:'flex-start',
            maxHeight:'calc(100vh - 180px)',
            display:'flex', flexDirection:'column',
          }}>
            {/* Panel title */}
            <div style={{
              padding:'14px 18px', borderBottom:'1px solid rgba(255,255,255,0.06)',
              background:'rgba(124,107,255,0.08)',
            }}>
              <div style={{ fontSize:13, fontWeight:700, color:'#f1f5f9' }}>
                {clusterSel
                  ? `📍 ${clusterSel[0].zone} — ${clusterSel.length} Suppliers`
                  : selected
                    ? selected.type==='hq' ? '★ ' + selected.name : selected.name
                    : '🖱️ Click a node to inspect'}
              </div>
              {!selected && !clusterSel && (
                <div style={{ fontSize:11, color:'rgba(148,163,184,0.5)', marginTop:3 }}>
                  Suppliers, ports, and HQ all show health details here
                </div>
              )}
            </div>

            {/* Scrollable content */}
            <div style={{ padding:16, overflowY:'auto', flex:1 }}>
              {!selected && !clusterSel && (
                <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                  <div style={{ padding:'14px', borderRadius:10, background:'rgba(124,107,255,0.06)', border:'1px solid rgba(124,107,255,0.15)' }}>
                    <div style={{ fontSize:12, fontWeight:700, color:'#a78bfa', marginBottom:8 }}>What to look for</div>
                    <ul style={{ margin:0, paddingLeft:16, fontSize:12, color:'rgba(148,163,184,0.65)', lineHeight:2.1 }}>
                      <li>🔴 <strong style={{color:'#f1f5f9'}}>Red pulsing hexes</strong> = disrupted suppliers</li>
                      <li>🟡 <strong style={{color:'#f1f5f9'}}>Dashed arcs</strong> = at-risk shipping lanes</li>
                      <li>🟦 <strong style={{color:'#f1f5f9'}}>Blue ✛ squares</strong> = port hubs</li>
                      <li>🟣 <strong style={{color:'#f1f5f9'}}>Numbered hexes</strong> = supplier clusters</li>
                      <li>🔵 <strong style={{color:'#f1f5f9'}}>Moving dots</strong> = live shipment flows</li>
                    </ul>
                  </div>
                  {/* Mini network summary */}
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                    <MetricBox label="Total Suppliers"   value={supplierNodes.length}    valueColor="#f1f5f9"/>
                    <MetricBox label="Port Hubs"         value={portNodes.length}         valueColor="#60a5fa"/>
                    <MetricBox label="Active Routes"     value={routes.length}            valueColor="#a78bfa"/>
                    <MetricBox label="Zones Covered"     value={Object.keys(locationGroups).length} valueColor="#2dd4bf"/>
                  </div>
                </div>
              )}
              {clusterSel && (
                <ClusterDetail cluster={clusterSel} onSelectNode={n => handleNodeFromCluster(n, clusterSel)} />
              )}
              {selected && !clusterSel && (
                <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                  <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:2 }}>
                    <span style={{ padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:700,
                      background: selected.status==='disrupted' ? 'rgba(239,68,68,0.15)':'rgba(45,212,191,0.12)',
                      color: selected.status==='disrupted' ? '#ef4444':'#2dd4bf',
                      border:`1px solid ${selected.status==='disrupted'?'rgba(239,68,68,0.3)':'rgba(45,212,191,0.25)'}` }}>
                      {selected.status==='disrupted' ? '⚠ Disrupted':'✓ Active'}
                    </span>
                    <span style={{ padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:600,
                      background:'rgba(124,107,255,0.12)', color:'#a78bfa', border:'1px solid rgba(124,107,255,0.25)' }}>
                      {selected.type==='port' ? '⚓ Port Hub' : selected.type==='hq' ? '★ HQ' : '🏭 Supplier'}
                    </span>
                    <span style={{ padding:'3px 10px', borderRadius:20, fontSize:11,
                      background:'rgba(255,255,255,0.05)', color:'rgba(148,163,184,0.6)', border:'1px solid rgba(255,255,255,0.08)' }}>
                      📍 {selected.zone}
                    </span>
                  </div>
                  <NodeDetail
                    node={selected}
                    supplierCount={supplierNodes.length}
                    onBack={prevCluster ? () => { setClusterSel(prevCluster); setSelected(null); setPrevCluster(null) } : null}
                  />
                </div>
              )}
            </div>
          </div>

        </div>
      )}

      {/* Section 8 Sprint — cross-industry benchmark strip (renders above InsightsPanel) */}
      <BenchmarkStrip />

      {supplierNodes.length > 0 && (
        <InsightsPanel
          suppliers={supplierNodes}
          intro="Reading your supplier network above — here's what stands out: concentration, buffer, and reliability risks you should act on." />
      )}

      {/* Section 2 Sprint — supplier financial health (always rendered; shows
          empty-state message when the caller has no suppliers). */}
      <FinancialHealthPanel />

      {/* Section 4 Sprint — ESG & compliance risk scoring */}
      <ESGPanel />
    </div>
  )
}
