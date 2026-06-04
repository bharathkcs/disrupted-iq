import { useState, useEffect, useRef } from 'react'

const MANUAL_SECONDS = 4.5 * 3600  // 4.5 hours baseline for manual coordination

function fmtElapsed(sec) {
  if (sec < 60) return `${sec.toFixed(1)}s`
  const m = Math.floor(sec / 60)
  const s = (sec % 60).toFixed(1)
  return `${m}m ${s < 10 ? '0' : ''}${s}s`
}

function fmtSaved(sec) {
  const saved = MANUAL_SECONDS - sec
  if (saved <= 0) return null
  const h = Math.floor(saved / 3600)
  const m = Math.floor((saved % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function completionMessage(sec) {
  const speedup = Math.round(MANUAL_SECONDS / Math.max(sec, 1))
  if (sec < 30)
    return `Recovery options generated in ${fmtElapsed(sec)} — ${speedup}× faster than a manual war-room.`
  if (sec < 60)
    return `All 9 agents coordinated and surfaced ranked recovery options in ${fmtElapsed(sec)}.`
  if (sec < 120)
    return `Recovery options ready in ${fmtElapsed(sec)} — a human team would take ~4.5h to reach the same result.`
  return `9-agent swarm completed analysis and generated recovery options in ${fmtElapsed(sec)}.`
}

function HelpTooltip() {
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)

  const show = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    const tipW = 300
    const margin = 12
    let left = r.left
    if (left + tipW > window.innerWidth - margin) left = window.innerWidth - tipW - margin
    if (left < margin) left = margin
    setPos({ top: r.bottom + 8, left })
  }
  const hide = () => setPos(null)

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onMouseEnter={show}
        onMouseLeave={hide}
        onClick={e => { e.stopPropagation(); pos ? hide() : show() }}
        style={{
          width: 18, height: 18, borderRadius: '50%',
          background: 'rgba(124,107,255,0.15)',
          border: '1px solid rgba(124,107,255,0.40)',
          color: '#7c6bff',
          fontSize: 10, fontWeight: 700, cursor: 'help',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          padding: 0, lineHeight: 1, flexShrink: 0,
        }}
        aria-label="About this panel"
      >?</button>
      {pos && (
        <div
          onMouseEnter={show}
          onMouseLeave={hide}
          style={{
            position: 'fixed', top: pos.top, left: pos.left,
            width: 300, padding: '14px 16px', borderRadius: 10,
            background: 'rgba(6,9,24,0.98)',
            border: '1px solid rgba(124,107,255,0.30)',
            boxShadow: '0 10px 30px rgba(0,0,0,0.55)',
            zIndex: 9999, textAlign: 'left',
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: '#a78bfa', marginBottom: 8 }}>Performance Benchmark</div>
          <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.65 }}>
            <b style={{ color: '#cbd5e1' }}>What this measures:</b> Real wall-clock time from triggering a disruption event to when the AI swarm delivers ranked recovery options — ready for human review.
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.65, marginTop: 8 }}>
            <b style={{ color: '#cbd5e1' }}>The 4.5h baseline</b> is the industry-average time for a human supply-chain team to manually detect, coordinate stakeholders, model scenarios, and surface recommendations.
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.65, marginTop: 8 }}>
            <b style={{ color: '#cbd5e1' }}>Timer stops</b> the instant Recommended Actions appear on screen — not at a fixed cap. Every run reflects your actual swarm performance.
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.65, marginTop: 8 }}>
            <b style={{ color: '#cbd5e1' }}>Speedup (N×)</b> = 4.5h ÷ actual elapsed time, updated live during the run.
          </div>
        </div>
      )}
    </>
  )
}

export default function BeforeAfterPanel({ swarmStartTime, swarmComplete }) {
  const [elapsed, setElapsed] = useState(0)
  const rafRef = useRef(null)

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)

    if (!swarmStartTime) { setElapsed(0); return }

    if (swarmComplete) {
      setElapsed((Date.now() - swarmStartTime) / 1000)
      return
    }

    const tick = () => {
      setElapsed((Date.now() - swarmStartTime) / 1000)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [swarmStartTime, swarmComplete])

  const started = !!swarmStartTime
  const done    = started && swarmComplete
  const running = started && !done

  const speedup = started && elapsed > 1
    ? Math.round(MANUAL_SECONDS / Math.max(elapsed, 1))
    : null

  const saved = done ? fmtSaved(elapsed) : null

  return (
    <div style={{
      position: 'relative',
      background: 'linear-gradient(145deg, #0d0f24 0%, #100b2e 100%)',
      border: `1px solid ${done ? 'rgba(52,211,153,0.35)' : running ? 'rgba(139,92,246,0.30)' : 'rgba(51,65,85,0.40)'}`,
      borderRadius: 16,
      padding: '20px 22px',
      overflow: 'hidden',
      transition: 'border-color 0.6s ease',
    }}>

      {/* Corner glow */}
      <div style={{
        position: 'absolute', top: 0, right: 0,
        width: 180, height: 180, pointerEvents: 'none',
        background: done
          ? 'radial-gradient(circle at top right, rgba(52,211,153,0.10) 0%, transparent 65%)'
          : running
          ? 'radial-gradient(circle at top right, rgba(139,92,246,0.10) 0%, transparent 65%)'
          : 'none',
        transition: 'background 0.7s ease',
      }} />

      {/* Top row: label + status + help */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div>
            <p style={{ margin: 0, fontSize: 9, fontWeight: 700, letterSpacing: '0.13em', textTransform: 'uppercase', color: '#475569' }}>
              Performance Benchmark
            </p>
            <p style={{ margin: '3px 0 0', fontSize: 13, fontWeight: 700, color: '#cbd5e1', letterSpacing: '-0.01em' }}>
              AI Swarm vs. Manual Analysis
            </p>
          </div>
          <HelpTooltip />
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 7,
          padding: '5px 12px', borderRadius: 100,
          background: done ? 'rgba(52,211,153,0.12)' : running ? 'rgba(139,92,246,0.12)' : 'rgba(51,65,85,0.20)',
          border: `1px solid ${done ? 'rgba(52,211,153,0.35)' : running ? 'rgba(167,139,250,0.35)' : 'rgba(51,65,85,0.40)'}`,
          transition: 'all 0.5s ease',
        }}>
          <span style={{
            display: 'inline-block',
            width: 6, height: 6, borderRadius: '50%',
            background: done ? '#34d399' : running ? '#a78bfa' : '#475569',
            boxShadow: done ? '0 0 8px #34d399' : running ? '0 0 8px #a78bfa' : 'none',
            animation: running ? 'bap-dot 1.4s ease-in-out infinite' : 'none',
            transition: 'background 0.4s, box-shadow 0.4s',
          }} />
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
            color: done ? '#34d399' : running ? '#a78bfa' : '#475569',
            transition: 'color 0.4s',
          }}>
            {done ? 'Completed' : running ? 'Running' : 'Standby'}
          </span>
        </div>
      </div>

      {/* Main three-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 72px 1fr', gap: 10, alignItems: 'stretch' }}>

        {/* Manual side */}
        <div style={{
          background: 'rgba(239,68,68,0.06)',
          border: '1px solid rgba(239,68,68,0.15)',
          borderRadius: 12, padding: '16px 14px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 9, color: '#f87171', letterSpacing: '0.10em', textTransform: 'uppercase', marginBottom: 10, fontWeight: 600 }}>
            ⏳ Without DisruptIQ
          </div>
          <div style={{ fontSize: 36, fontWeight: 900, color: '#fca5a5', lineHeight: 1, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>
            4.5h
          </div>
          <div style={{ fontSize: 10, color: '#475569', marginTop: 7 }}>
            Manual coordination
          </div>
        </div>

        {/* Speedup centre */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
          {speedup ? (
            <>
              <div style={{
                fontSize: 20, fontWeight: 900, lineHeight: 1,
                fontVariantNumeric: 'tabular-nums',
                color: done ? '#34d399' : '#5eead4',
                textShadow: done ? '0 0 20px rgba(52,211,153,0.6)' : '0 0 14px rgba(94,234,212,0.45)',
                transition: 'color 0.5s, text-shadow 0.5s',
              }}>
                {speedup}×
              </div>
              <div style={{ fontSize: 7, letterSpacing: '0.12em', color: done ? '#6ee7b7' : '#5eead4', opacity: 0.75 }}>
                FASTER
              </div>
            </>
          ) : (
            <div style={{ fontSize: 18, color: '#1e293b', userSelect: 'none' }}>→</div>
          )}
        </div>

        {/* AI swarm side */}
        <div style={{
          background: done
            ? 'rgba(52,211,153,0.07)'
            : running
            ? 'rgba(139,92,246,0.07)'
            : 'rgba(51,65,85,0.06)',
          border: done
            ? '1px solid rgba(52,211,153,0.28)'
            : running
            ? '1px solid rgba(139,92,246,0.25)'
            : '1px solid rgba(51,65,85,0.20)',
          borderRadius: 12, padding: '16px 14px', textAlign: 'center',
          transition: 'background 0.5s, border-color 0.5s',
        }}>
          <div style={{
            fontSize: 9, letterSpacing: '0.10em', textTransform: 'uppercase', marginBottom: 10, fontWeight: 600,
            color: done ? '#6ee7b7' : running ? '#a78bfa' : '#475569',
            transition: 'color 0.4s',
          }}>
            ⚡ With DisruptIQ
          </div>
          <div style={{
            fontSize: started ? 30 : 24, fontWeight: 900, lineHeight: 1,
            fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em',
            color: done ? '#34d399' : running ? '#c4b5fd' : '#334155',
            transition: 'color 0.5s',
          }}>
            {started ? fmtElapsed(elapsed) : '—'}
          </div>
          <div style={{ fontSize: 10, color: '#475569', marginTop: 7 }}>
            {done ? '9-agent swarm ✓' : running ? '9-agent swarm' : 'Awaiting event'}
          </div>
        </div>
      </div>

      {/* Progress track */}
      {started && (
        <div style={{ marginTop: 16 }}>
          <div style={{ height: 3, background: 'rgba(255,255,255,0.04)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 3,
              background: done
                ? 'linear-gradient(90deg, #10b981, #34d399, #6ee7b7)'
                : 'linear-gradient(90deg, #6d28d9, #8b5cf6, #5eead4)',
              width: done ? '100%' : '60%',
              transition: done
                ? 'width 0.7s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.5s'
                : 'none',
              boxShadow: done
                ? '0 0 8px rgba(52,211,153,0.6)'
                : running
                ? '0 0 8px rgba(139,92,246,0.5)'
                : 'none',
              animation: running ? 'bap-shimmer 2.2s ease-in-out infinite' : 'none',
            }} />
          </div>
        </div>
      )}

      {/* Completion message banner */}
      {done && (
        <div style={{
          marginTop: 14,
          padding: '10px 14px',
          borderRadius: 10,
          background: 'rgba(52,211,153,0.08)',
          border: '1px solid rgba(52,211,153,0.22)',
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          <span style={{ fontSize: 14, lineHeight: 1, marginTop: 1, flexShrink: 0 }}>✅</span>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#34d399', marginBottom: 3 }}>
              {completionMessage(elapsed)}
            </div>
            {saved && (
              <div style={{ fontSize: 10, color: '#64748b' }}>
                Equivalent to saving <span style={{ color: '#6ee7b7', fontWeight: 600 }}>{saved}</span> of manual analyst time per disruption event.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Running footer */}
      {running && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
          <span style={{ fontSize: 10, color: '#475569' }}>Generating recovery options…</span>
          <span style={{ fontSize: 10, color: '#334155', fontVariantNumeric: 'tabular-nums' }}>
            {fmtElapsed(elapsed)} elapsed
          </span>
        </div>
      )}

      <style>{`
        @keyframes bap-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.35; transform: scale(0.75); }
        }
        @keyframes bap-shimmer {
          0%   { opacity: 0.85; }
          50%  { opacity: 1; }
          100% { opacity: 0.85; }
        }
      `}</style>
    </div>
  )
}
