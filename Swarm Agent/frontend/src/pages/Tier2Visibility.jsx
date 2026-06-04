import React, { useEffect, useState } from 'react'
import { api } from '../services/api.js'
import { InfoTooltip } from '../components/ui.jsx'

const CONFIDENCE_BANDS = [
  { min: 0.85, label: 'High',   color: '#22c55e' },
  { min: 0.70, label: 'Medium', color: '#f59e0b' },
  { min: 0.0,  label: 'Low',    color: '#94a3b8' },
]

function confidenceBand(c) {
  return CONFIDENCE_BANDS.find(b => c >= b.min) || CONFIDENCE_BANDS[CONFIDENCE_BANDS.length - 1]
}

function ConfidenceBar({ confidence }) {
  const band = confidenceBand(confidence)
  const pct  = Math.round(confidence * 100)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 160 }}>
      <div style={{
        flex: 1,
        height: 8,
        background: 'rgba(255,255,255,0.06)',
        borderRadius: 6,
        overflow: 'hidden',
        position: 'relative',
        border: `1px solid ${band.color}30`,
      }}>
        <div style={{
          width: `${pct}%`,
          height: '100%',
          background: `linear-gradient(90deg, ${band.color}, ${band.color}dd)`,
          transition: 'width 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
          boxShadow: `0 0 8px ${band.color}60`,
          borderRadius: 5,
        }} />
      </div>
      <span style={{
        fontSize: 12,
        color: band.color,
        fontWeight: 800,
        minWidth: 40,
        textAlign: 'right',
      }}>{pct}%</span>
    </div>
  )
}

function Tier2Card({ node }) {
  const isSpof = !!node.is_spof
  const band = confidenceBand(node.confidence)
  return (
    <div style={{
      padding: '18px 20px',
      borderRadius: 12,
      background: isSpof
        ? 'linear-gradient(135deg, rgba(239,68,68,0.12), rgba(239,68,68,0.05))'
        : 'linear-gradient(135deg, rgba(124,107,255,0.08), rgba(96,165,250,0.03))',
      border: `1px solid ${isSpof ? 'rgba(239,68,68,0.35)' : 'rgba(124,107,255,0.25)'}`,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      transition: 'all 0.3s ease',
      position: 'relative',
      overflow: 'hidden',
      animation: 'slideUp 0.4s ease-out',
    }}
    onMouseOver={(e) => {
      e.currentTarget.style.transform = 'translateY(-3px)'
      e.currentTarget.style.boxShadow = isSpof
        ? '0 8px 24px rgba(239,68,68,0.2)'
        : '0 8px 24px rgba(124,107,255,0.15)'
      e.currentTarget.style.borderColor = isSpof ? 'rgba(239,68,68,0.5)' : 'rgba(124,107,255,0.4)'
    }}
    onMouseOut={(e) => {
      e.currentTarget.style.transform = 'translateY(0)'
      e.currentTarget.style.boxShadow = 'none'
      e.currentTarget.style.borderColor = isSpof ? 'rgba(239,68,68,0.35)' : 'rgba(124,107,255,0.25)'
    }}
    >
      {/* Background glow effect */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: isSpof
          ? 'radial-gradient(circle at 100% 0%, rgba(239,68,68,0.15), transparent 60%)'
          : 'radial-gradient(circle at 100% 0%, rgba(124,107,255,0.1), transparent 60%)',
        pointerEvents: 'none',
      }} />

      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text-pri)' }}>
            {isSpof && <span style={{ marginRight: 6, fontSize: 14 }}>⚠️</span>}
            {node.tier2_category}
          </div>
          {isSpof && (
            <span style={{
              fontSize: 10,
              fontWeight: 800,
              color: '#ef4444',
              background: 'linear-gradient(135deg, rgba(239,68,68,0.2), rgba(239,68,68,0.1))',
              border: '1px solid rgba(239,68,68,0.5)',
              padding: '3px 10px',
              borderRadius: 12,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}>
              SPOF
            </span>
          )}
        </div>

        <div style={{
          fontSize: 11,
          color: 'var(--text-dim)',
          marginBottom: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}>
          📍 {node.probable_zones}
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 12,
          flexWrap: 'wrap',
        }}>
          <div style={{
            fontSize: 13,
            color: 'var(--text-sec)',
            background: 'rgba(255,255,255,0.05)',
            padding: '4px 10px',
            borderRadius: 6,
            fontWeight: 600,
          }}>
            Affects <span style={{ color: band.color, fontWeight: 800 }}>{node.exposure_count}</span> Tier-1
          </div>
          <ConfidenceBar confidence={node.confidence} />
        </div>

        <details style={{
          fontSize: 12,
          color: 'var(--text-sec)',
          cursor: 'pointer',
        }}>
          <summary style={{
            cursor: 'pointer',
            color: 'var(--primary)',
            fontWeight: 600,
            padding: '6px 0',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            userSelect: 'none',
          }}>
            <span style={{ fontSize: 14 }}>▸</span>
            Dependent suppliers ({node.dependent_tier1_suppliers.length})
          </summary>
          <div style={{
            marginTop: 10,
            paddingLeft: 12,
            lineHeight: 1.7,
            fontSize: 12,
            color: 'var(--text-sec)',
            borderLeft: `2px solid ${band.color}40`,
            animation: 'slideDown 0.3s ease-out',
          }}>
            {node.dependent_tier1_suppliers.join(', ')}
          </div>
        </details>
      </div>
    </div>
  )
}

function InlineUpload({ onUploaded }) {
  const [file, setFile]         = useState(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult]     = useState(null)
  const [err, setErr]           = useState(null)

  const upload = async () => {
    if (!file) return
    setUploading(true); setResult(null); setErr(null)
    try {
      const res = await api.uploadSupplierExcel(file)
      setResult(res)
      setFile(null)
      if (res.suppliers_added > 0) onUploaded()
    } catch (e) {
      setErr(e.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div style={{
      marginTop: 18,
      padding: '24px',
      borderRadius: 14,
      background: 'linear-gradient(135deg, rgba(124,107,255,0.12), rgba(96,165,250,0.06))',
      border: '1px solid rgba(124,107,255,0.3)',
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
    }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-pri)', marginBottom: 6 }}>
          📤 Upload your Tier-1 suppliers to activate Tier-2 inference
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-sec)', lineHeight: 1.65 }}>
          DisruptIQ automatically infers your probable Tier-2 (and structural Tier-3) dependencies using an industry knowledge graph.
          No manual survey needed — just upload and let the inference engine map your supply network.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 16px',
          background: 'rgba(255,255,255,0.08)',
          border: '1px solid rgba(124,107,255,0.4)',
          borderRadius: 8,
          cursor: 'pointer',
          fontSize: 13,
          color: 'var(--text-pri)',
          fontWeight: 600,
          transition: 'all 0.3s ease',
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.12)'
          e.currentTarget.style.borderColor = 'rgba(124,107,255,0.6)'
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
          e.currentTarget.style.borderColor = 'rgba(124,107,255,0.4)'
        }}
        >
          {file ? `📄 ${file.name}` : '📁 Choose Excel file (.xlsx)'}
          <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={e => { setFile(e.target.files?.[0] || null); setResult(null) }} />
        </label>
        <button
          onClick={upload}
          disabled={!file || uploading}
          style={{
            padding: '10px 20px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 700,
            cursor: file && !uploading ? 'pointer' : 'not-allowed',
            background: file && !uploading
              ? 'linear-gradient(135deg, var(--primary), #2dd4bf)'
              : 'rgba(124,107,255,0.3)',
            border: 'none',
            color: '#fff',
            transition: 'all 0.3s ease',
            boxShadow: file && !uploading ? '0 4px 16px rgba(124,107,255,0.3)' : 'none',
          }}
          onMouseOver={(e) => {
            if (file && !uploading) {
              e.currentTarget.style.boxShadow = '0 6px 20px rgba(124,107,255,0.4)'
              e.currentTarget.style.transform = 'translateY(-1px)'
            }
          }}
          onMouseOut={(e) => {
            if (file && !uploading) {
              e.currentTarget.style.boxShadow = '0 4px 16px rgba(124,107,255,0.3)'
              e.currentTarget.style.transform = 'translateY(0)'
            }
          }}
        >
          {uploading ? '⏳ Uploading…' : '🚀 Upload Suppliers'}
        </button>
        <a
          href="#"
          onClick={async e => { e.preventDefault(); const blob = await api.downloadSupplierTemplate(); const url = URL.createObjectURL(blob); Object.assign(document.createElement('a'), { href: url, download: 'disruptiq_template.xlsx' }).click(); URL.revokeObjectURL(url) }}
          style={{
            fontSize: 13,
            color: 'var(--primary)',
            textDecoration: 'none',
            fontWeight: 600,
            padding: '6px 0',
            borderBottom: '1px dotted var(--primary)',
            transition: 'all 0.3s ease',
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.borderBottom = '1px solid var(--primary)'
            e.currentTarget.style.opacity = '0.8'
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.borderBottom = '1px dotted var(--primary)'
            e.currentTarget.style.opacity = '1'
          }}
        >
          ⬇️ Download template
        </a>
      </div>

      {result && result.suppliers_added > 0 && (
        <div style={{
          fontSize: 13,
          color: 'var(--success)',
          fontWeight: 700,
          padding: '10px 12px',
          background: 'rgba(34,197,94,0.12)',
          border: '1px solid rgba(34,197,94,0.3)',
          borderRadius: 8,
          animation: 'slideIn 0.3s ease-out',
        }}>
          ✅ {result.suppliers_added} supplier{result.suppliers_added !== 1 ? 's' : ''} uploaded. Tier-2 inference will appear momentarily.
        </div>
      )}
      {result && result.suppliers_added === 0 && (
        <div style={{
          fontSize: 13,
          color: 'var(--warning)',
          padding: '10px 12px',
          background: 'rgba(245,158,11,0.12)',
          border: '1px solid rgba(245,158,11,0.3)',
          borderRadius: 8,
        }}>
          ⚠️ {result.message || 'No new suppliers imported.'}
        </div>
      )}
      {err && <div style={{
        fontSize: 13,
        color: 'var(--danger)',
        padding: '10px 12px',
        background: 'rgba(239,68,68,0.12)',
        border: '1px solid rgba(239,68,68,0.3)',
        borderRadius: 8,
      }}>
        ❌ {err}
      </div>}
    </div>
  )
}

export default function Tier2Visibility() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  const load = () => {
    setLoading(true)
    api.tier2Visibility()
      .then(res => setData(res))
      .catch(err => setError(err?.message || 'Failed to load Tier-2 visibility'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  if (loading) return <div className="panel panel-pad"><div style={{ color: 'var(--text-dim)' }}>Loading Tier-2 inference…</div></div>
  if (error)   return <div className="panel panel-pad"><div style={{ color: 'var(--danger)' }}>{error}</div></div>
  if (!data)   return null

  const nodes = Array.isArray(data.tier2_nodes) ? data.tier2_nodes : []
  const spofs = Array.isArray(data.single_points_of_failure) ? data.single_points_of_failure : []
  const noSuppliers = (data.tier1_count || 0) === 0

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', width: '100%', padding: '16px 16px 40px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header card */}
      <div className="panel" style={{
        background: 'linear-gradient(135deg, rgba(124,107,255,0.1) 0%, rgba(45,212,191,0.05) 100%)',
        border: '1px solid rgba(124,107,255,0.2)',
        borderRadius: 16,
        overflow: 'hidden',
      }}>
        <div style={{ padding: '32px 28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-pri)' }}>🔗 Tier-2 Visibility</span>
            <InfoTooltip
              title="Probabilistic Tier-2 inference"
              description={
                'DisruptIQ infers probable Tier-2 dependencies from each Tier-1 supplier\'s categories using an industry knowledge graph. '
                + 'Results are estimated, not surveyed — confidence scores show reliability. '
                + 'Single-points-of-failure (SPOFs) are Tier-2 categories that affect many of your Tier-1 suppliers simultaneously. '
                + 'Upload your Tier-1 suppliers below to activate this analysis.'
              }
            />
          </div>
          <div style={{ color: 'var(--text-sec)', fontSize: 14, lineHeight: 1.6, marginBottom: 20, maxWidth: 680 }}>
            {data.disclaimer || 'Tier-2 dependencies are probabilistically inferred from industry knowledge graphs, not supplier surveys. Confidence scores indicate inference reliability.'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
            <Stat label="Tier-1 suppliers" value={data.tier1_count || 0} icon="📦" />
            <Stat label="Tier-2 inferred" value={data.tier2_inferred_count || 0} icon="🔗" />
            <Stat label="Single Points of Failure" value={spofs.length} color={spofs.length > 0 ? '#ef4444' : undefined} icon={spofs.length > 0 ? '⚠️' : '✓'} />
          </div>
        </div>

        {/* Upload section when no suppliers */}
        {noSuppliers && (
          <div style={{ padding: '0 28px 28px' }}>
            <InlineUpload onUploaded={load} />
          </div>
        )}
      </div>

      {/* Empty state when suppliers exist but no inferences yet */}
      {!noSuppliers && nodes.length === 0 && (
        <div className="panel" style={{
          padding: '32px 28px',
          background: 'linear-gradient(135deg, rgba(124,107,255,0.08), rgba(96,165,250,0.03))',
          border: '1px solid rgba(124,107,255,0.25)',
          borderRadius: 14,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
          <div style={{ color: 'var(--text-sec)', fontSize: 15, lineHeight: 1.7, marginBottom: 12, maxWidth: 520, margin: '0 auto 12px' }}>
            {data.message || 'No Tier-2 inferences generated yet. Make sure your suppliers have category information — the inference engine maps supplier categories to known Tier-2 dependencies.'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6, maxWidth: 520, margin: '0 auto' }}>
            💡 <strong>Tip:</strong> Ensure each supplier has at least one category (e.g., "Air Freight", "Automotive", "Electronics").
            Go to <strong>Config</strong> to edit supplier details and add missing categories.
          </div>
        </div>
      )}

      {nodes.length > 0 && (
        <>
          {spofs.length > 0 && (
            <div className="panel" style={{
              background: 'linear-gradient(135deg, rgba(239,68,68,0.12), rgba(239,68,68,0.05))',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 14,
            }}>
              <div style={{
                padding: '20px 28px',
                background: 'rgba(239,68,68,0.15)',
                borderBottom: '1px solid rgba(239,68,68,0.3)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <span style={{ fontSize: 20 }}>⚠️</span>
                  <span style={{ fontSize: 18, fontWeight: 800, color: '#ef4444' }}>Structural Single-Points-of-Failure</span>
                </div>
                <div style={{ color: 'var(--text-sec)', fontSize: 13, lineHeight: 1.6 }}>
                  These Tier-2 categories are critical dependencies — disrupting them would impact many of your Tier-1 suppliers simultaneously.
                  Mitigate these risks by diversifying suppliers or building additional buffers.
                </div>
              </div>
              <div style={{ padding: '20px 28px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
                  {spofs.map((node, i) => (
                    <div key={node.tier2_category} style={{ animation: `slideUp ${0.4 + i * 0.05}s ease-out` }}>
                      <Tier2Card node={node} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="panel" style={{
            background: 'linear-gradient(135deg, rgba(124,107,255,0.08), rgba(96,165,250,0.03))',
            border: '1px solid rgba(124,107,255,0.25)',
            borderRadius: 14,
          }}>
            <div style={{
              padding: '20px 28px',
              background: 'rgba(124,107,255,0.12)',
              borderBottom: '1px solid rgba(124,107,255,0.25)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <span style={{ fontSize: 20 }}>🔗</span>
                <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-pri)' }}>All Inferred Tier-2 Dependencies</span>
              </div>
              <div style={{ color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.6 }}>
                Complete map of your inferred dependencies, sorted by exposure count and confidence score.
                <span style={{ display: 'block', marginTop: 4, fontSize: 12, color: 'var(--text-sec)' }}>💡 Hover cards for lift effect | Click triangles to see dependent suppliers</span>
              </div>
            </div>
            <div style={{ padding: '20px 28px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
                {nodes.map((node, i) => (
                  <div key={node.tier2_category} style={{ animation: `slideUp ${0.4 + i * 0.03}s ease-out` }}>
                    <Tier2Card node={node} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, color, icon }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 12,
      padding: '16px 14px',
      transition: 'all 0.3s ease',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}
    onMouseOver={(e) => {
      e.currentTarget.style.background = color ? `${color}12` : 'rgba(124,107,255,0.12)'
      e.currentTarget.style.borderColor = color ? `${color}40` : 'rgba(124,107,255,0.3)'
      e.currentTarget.style.transform = 'translateY(-2px)'
    }}
    onMouseOut={(e) => {
      e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
      e.currentTarget.style.transform = 'translateY(0)'
    }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {icon && <span style={{ fontSize: 16 }}>{icon}</span>}
        <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: color || 'var(--primary)' }}>{value}</div>
    </div>
  )
}
