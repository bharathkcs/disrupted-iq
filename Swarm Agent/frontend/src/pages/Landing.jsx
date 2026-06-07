import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../services/api.js'
import './Landing.css'

const CONTACT_EMAIL = 'kcsbadp@gmail.com'

/* ─── Scroll-reveal wrapper ─── */
function Reveal({ children, className = '', delay = 0, as: Tag = 'div' }) {
  const ref = useRef(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setInView(true); obs.disconnect() }
    }, { threshold: 0.12 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return (
    <Tag ref={ref} className={`reveal ${inView ? 'in' : ''} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </Tag>
  )
}

function SectionHead({ eyebrow, title, sub }) {
  return (
    <div className="section-head">
      {eyebrow && <span className="eyebrow-pill">{eyebrow}</span>}
      <h2>{title}</h2>
      {sub && <p className="section-sub">{sub}</p>}
    </div>
  )
}

/* ─── Animated 9-agent swarm (on-theme hero visual) ─── */
const AGENTS = [
  { icon: '🛰️', name: 'Monitor' },
  { icon: '🧠', name: 'Memory' },
  { icon: '🔗', name: 'Cascade' },
  { icon: '📈', name: 'Forecast' },
  { icon: '⚠️', name: 'Risk' },
  { icon: '🎯', name: 'Action' },
  { icon: '⚖️', name: 'Validator' },
  { icon: '🎲', name: 'Sim' },
  { icon: '🔄', name: 'Learn' },
]

function SwarmVisual() {
  const size = 400
  const c = size / 2
  const R = 158
  const pts = AGENTS.map((a, i) => {
    const ang = (-90 + i * (360 / AGENTS.length)) * (Math.PI / 180)
    return { ...a, x: c + R * Math.cos(ang), y: c + R * Math.sin(ang), i }
  })
  return (
    <div className="swarm" style={{ width: size, height: size }}>
      <div className="swarm-orbit" />
      <div className="swarm-orbit swarm-orbit-2" />
      <svg className="swarm-lines" viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        {pts.map(p => (
          <line key={p.i} x1={c} y1={c} x2={p.x} y2={p.y} className="swarm-line" style={{ animationDelay: `${p.i * 0.18}s` }} />
        ))}
      </svg>
      <div className="swarm-core">
        <span className="swarm-core-icon">⚡</span>
        <span className="swarm-core-label">Disruption</span>
        <span className="swarm-core-pulse" />
      </div>
      {pts.map(p => (
        <div key={p.i} className="swarm-node" style={{ left: p.x, top: p.y, animationDelay: `${p.i * 0.18}s` }}>
          <span className="swarm-node-icon">{p.icon}</span>
          <span className="swarm-node-name">{p.name}</span>
        </div>
      ))}
    </div>
  )
}

function HeroSection({ onDemoClick, onSignupClick }) {
  return (
    <section className="hero">
      <div className="lp-container hero-grid">
        <div className="hero-content">
          <div className="hero-badge">
            <span className="dot" /> Live disruption response · 24/7 autonomous monitoring
          </div>
          <h1>
            Supply chain disruptions don't wait.<br />
            <span className="gradient-text">Neither should your response.</span>
          </h1>
          <p className="hero-subtitle">9 AI agents. 90 seconds. One confident, human-approved decision.</p>
          <p className="hero-description">
            DisruptIQ detects supply-chain disruptions in real time and coordinates a 9-agent AI swarm
            to deliver ranked recovery options with probabilistic outcomes — in under 90 seconds. It
            forecasts demand, scores supplier risk, maps hidden Tier-2 exposure, flags financial &amp; ESG
            weak points, and learns from every event. A human approves every action.
          </p>
          <div className="hero-stats">
            {[
              { num: '90s', label: 'Response time' },
              { num: '9', label: 'AI agents' },
              { num: '3', label: 'Ranked options' },
              { num: '100%', label: 'Human-approved' },
            ].map(s => (
              <div className="hero-stat" key={s.label}>
                <div className="hero-stat-num">{s.num}</div>
                <div className="hero-stat-label">{s.label}</div>
              </div>
            ))}
          </div>
          <div className="hero-ctas">
            <button className="btn-cta btn-cta-primary" onClick={onDemoClick}>▶ Try Live Demo</button>
            <button className="btn-cta btn-cta-secondary" onClick={onSignupClick}>Start Free — Onboard Your Company</button>
          </div>
          <p className="hero-hint">Free forever up to 30 suppliers · no credit card · no signup needed for the demo · scroll to explore ↓</p>
        </div>

        <div className="hero-visual">
          <SwarmVisual />
        </div>
      </div>
    </section>
  )
}

function TrustBar() {
  const items = [
    { icon: '🛰️', text: 'Real-time NewsAPI + Open-Meteo monitoring' },
    { icon: '🔒', text: 'AES-256 encryption · full audit trail' },
    { icon: '🤝', text: 'Server-enforced human-in-the-loop' },
    { icon: '🧠', text: 'Memory-calibrated — learns from every disruption' },
  ]
  return (
    <div className="trust">
      <div className="lp-container trust-inner">
        {items.map(i => (
          <div className="trust-item" key={i.text}><span>{i.icon}</span><span>{i.text}</span></div>
        ))}
      </div>
    </div>
  )
}

function ProblemSection() {
  const story = [
    { icon: '🌊', label: 'Red Sea · Geopolitical Crisis', title: 'Strait of Hormuz blocked', detail: 'Houthi attacks escalate. Major shipping lanes through the Strait of Hormuz are closed. 40% of your components move through this route.', color: '#f87171', tag: 'Geopolitics' },
    { icon: '🌀', label: 'Bay of Bengal · Severe Weather', title: 'Cyclone Michaung makes landfall', detail: 'Category 4 cyclone hits Chennai coast. Your 3 critical auto-parts suppliers are in the direct impact zone. Ports closed indefinitely.', color: '#fb923c', tag: 'Natural disaster' },
    { icon: '✈️', label: 'Delhi · Regulatory', title: 'Customs hold on air freight', detail: 'New compliance directive freezes air cargo clearances for 48 hrs. Your emergency reroute option just disappeared.', color: '#facc15', tag: 'Regulatory' },
  ]
  const manual = [
    { t: '06:00', e: 'Someone reads the news', d: 'No automated monitoring — you found out by chance', icon: '📰' },
    { t: '07:30', e: 'Manually map affected suppliers', d: '~90 min of spreadsheet work', icon: '🗂️' },
    { t: '10:00', e: 'Call suppliers one by one', d: '~3 hours of phone calls and emails', icon: '📞' },
    { t: '13:00', e: 'Try to forecast impact', d: 'Guesswork — no Monte Carlo, no data', icon: '📉' },
    { t: '15:30', e: 'Brainstorm recovery options', d: 'Executive war-room convened', icon: '🧩' },
    { t: '18:00', e: 'Decision — finally', d: 'After 12 hours. Competitors already acted.', icon: '🏁', final: true },
  ]
  const smart = [
    { t: '0s', e: 'All 3 threats detected simultaneously', d: 'NewsAPI · Open-Meteo · geopolitical feeds', icon: '🛰️' },
    { t: '8s', e: '6 affected suppliers identified & scored', d: 'Cross-referenced against your uploaded network', icon: '🗺️' },
    { t: '30s', e: 'Cascade risk mapped across Tier-1 & Tier-2', d: 'Compound severity calculated — 3 threats, 1 response', icon: '🔗' },
    { t: '60s', e: '3 ranked recovery options generated', d: 'Monte Carlo outcomes · cost impact · RTO tagged', icon: '🤖' },
    { t: '85s', e: 'You review, approve, act', d: 'Full risk explained · every gate cleared', icon: '👤', final: true },
  ]
  const Row = ({ s, win }) => (
    <li className={`ptl-item ${s.final ? 'final' : ''}`}>
      <span className={`ptl-dot ${win ? 'win-dot' : 'loss-dot'}`}>{s.icon}</span>
      <div className="ptl-body">
        <div className="ptl-head">
          <span className="ptl-time">{s.t}</span>
          <span className="ptl-event">{s.e}</span>
        </div>
        <span className={`ptl-meta ${win ? '' : 'loss-meta'}`}>{win ? '› ' : '⏱ '}{s.d}</span>
      </div>
    </li>
  )
  return (
    <section className="lp-section problem">
      <div className="lp-container">
        <Reveal>
          <SectionHead
            eyebrow="Real-world scenario"
            title="Three threats hit simultaneously. What happens next?"
            sub="It's 6 AM. Geopolitics, weather and regulation just collided against your supply chain. DisruptIQ already knows."
          />
        </Reveal>

        <Reveal className="story-grid" delay={60}>
          {story.map((s, i) => (
            <div className="story-card" key={i} style={{ '--story-color': s.color }}>
              <div className="story-card-top">
                <span className="story-icon">{s.icon}</span>
                <span className="story-tag" style={{ color: s.color, borderColor: `${s.color}55`, background: `${s.color}14` }}>{s.tag}</span>
              </div>
              <div className="story-label">{s.label}</div>
              <div className="story-title">{s.title}</div>
              <p className="story-detail">{s.detail}</p>
            </div>
          ))}
        </Reveal>

        <Reveal className="story-connector" delay={100}>
          <div className="story-connector-line">
            <span className="story-connector-dot" />
            <span className="story-connector-text">DisruptIQ detects all three. Simultaneously. In seconds.</span>
            <span className="story-connector-dot" />
          </div>
        </Reveal>

        <Reveal className="vs-band" delay={140}>
          <div className="vs-stat vs-loss">
            <div className="vs-num">12 hrs</div>
            <div className="vs-label">Manual response time</div>
          </div>
          <div className="vs-divider"><span>VS</span></div>
          <div className="vs-stat vs-win">
            <div className="vs-num">85 sec</div>
            <div className="vs-label">With DisruptIQ — <strong>500× faster</strong></div>
          </div>
        </Reveal>

        <Reveal className="problem-grid" delay={180}>
          <div className="problem-column loss">
            <div className="problem-tag negative">⏰ Without DisruptIQ</div>
            <ol className="ptl">{manual.map((s, i) => <Row key={i} s={s} win={false} />)}</ol>
            <div className="timeline-metric negative">💸 ₹4.8Cr revenue at risk · competitors already moved</div>
          </div>
          <div className="problem-column win">
            <div className="problem-tag positive">⚡ With DisruptIQ</div>
            <ol className="ptl">{smart.map((s, i) => <Row key={i} s={s} win={true} />)}</ol>
            <div className="timeline-metric positive">✅ Decision made in 85 seconds · supply chain secured</div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

function SolutionSection() {
  const steps = [
    { num: '1', icon: '🔍', title: 'Event Detected', desc: 'We monitor news, weather and ports 24/7. Detection is instant and automatic.' },
    { num: '2', icon: '🤖', title: 'Swarm Analyses', desc: '9 agents run in parallel: Monitor, Memory, Cascade, Forecast, Risk, Action, Validator, Simulation.' },
    { num: '3', icon: '📊', title: 'Options Ranked', desc: '3 recovery options with Monte Carlo scenarios and probability forecasts.' },
    { num: '4', icon: '👤', title: 'Human Approves', desc: 'You review, understand and decide. No autonomous execution — ever. Severity ≥9 needs a co-reviewer.' },
    { num: '5', icon: '📈', title: 'Execute & Learn', desc: 'The system records the real outcome and calibrates. Next disruption = smarter.' },
  ]
  return (
    <section id="how-it-works" className="lp-section steps">
      <div className="lp-container">
        <Reveal><SectionHead eyebrow="How it works" title="From signal to decision in five steps" sub="A coordinated pipeline that turns a raw disruption signal into a board-ready decision." /></Reveal>
        <div className="steps-grid">
          {steps.map((s, idx) => (
            <Reveal key={s.num} className="step-card" delay={idx * 90}>
              <div className="step-number">{s.num}</div>
              <div className="step-icon">{s.icon}</div>
              <h3>{s.title}</h3>
              <p>{s.desc}</p>
              {idx < steps.length - 1 && <div className="step-arrow">→</div>}
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

function FeaturesSection() {
  const features = [
    { icon: '📡', title: 'Always Watching', desc: 'We monitor news, weather and ports 24/7. The moment something affects your supply chain, you know — and the swarm can auto-trigger above your threshold.', color: '#7c6bff' },
    { icon: '👥', title: 'Expert Team of 9', desc: 'Nine AI specialists work together — each an expert in forecasting, risk, cascade detection or finding solutions.', color: '#2dd4bf' },
    { icon: '🎯', title: 'Smart Ranked Options', desc: 'We test 3 solutions with Monte Carlo and show best-case, expected and worst-case outcomes — each with a plain-English WHY · HOW · RISK rationale.', color: '#f59e0b' },
    { icon: '✓', title: 'You Make the Call', desc: 'We recommend, you decide. Every action requires your approval — server-enforced gates mean the UI can never bypass a human.', color: '#60a5fa' },
    { icon: '🧠', title: 'Gets Smarter (MCAS)', desc: 'Our Memory-Calibrated Agent Swarm feeds real outcomes back into forecasts. Predictions and solutions sharpen with every event you handle.', color: '#f472b6' },
    { icon: '🗺️', title: 'See Your Network', desc: 'A live twin map of every supplier, route, port hub and vulnerability — so you spot risk before it bites.', color: '#34d399' },
  ]
  return (
    <section id="features" className="lp-section features">
      <div className="lp-container">
        <Reveal><SectionHead eyebrow="Why DisruptIQ" title="Built for the moment everything goes wrong" sub="Every feature exists to compress your response time and sharpen your decision." /></Reveal>
        <div className="features-grid">
          {features.map((f, idx) => (
            <Reveal key={f.title} className="feature-card" delay={(idx % 3) * 90} >
              <div className="feature-card-inner" style={{ borderTopColor: f.color }}>
                <div className="feature-icon" style={{ background: `${f.color}1f`, color: f.color }}>{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ─── NEW: full platform capabilities (every tab / module in the product) ─── */
function CapabilitiesSection() {
  const caps = [
    { icon: '🔮', title: 'Predictive Threat Intelligence', tag: 'Proactive', desc: 'Forward-looking disruption-risk scoring (0–100) that surfaces emerging threats to your specific suppliers before they escalate.', color: '#a78bfa' },
    { icon: '🕸️', title: 'Tier-2 Dependency Visibility', tag: 'Hidden risk', desc: 'Probabilistic inference of the sub-suppliers behind your Tier-1s — exposing single points of failure you never had on a map.', color: '#60a5fa' },
    { icon: '💰', title: 'Supplier Financial Health', tag: 'Early warning', desc: 'Composite financial-stability scoring per supplier so you can act on insolvency risk weeks ahead of a failure.', color: '#2dd4bf' },
    { icon: '🌱', title: 'ESG & Compliance Risk', tag: 'Governance', desc: 'Environmental, social and compliance exposure scored per supplier — keep your network audit-ready and reputation-safe.', color: '#34d399' },
    { icon: '📊', title: 'Cross-Industry Benchmarks', tag: 'Context', desc: 'See how your resilience compares to anonymised industry baselines — federated learning, none of your data exposed.', color: '#f59e0b' },
    { icon: '📋', title: 'Daily Risk Briefing', tag: 'Stay ahead', desc: 'A concise daily disruption-risk briefing for your network, with 30-day history so you can track the trend.', color: '#f472b6' },
    { icon: '🧭', title: 'Resilience Score & Insights', tag: 'Self-aware', desc: 'A 0–100 resilience dial plus algorithmic insights (single-source risk, geo concentration, low-buffer zones) from your own data — no LLM, no guesswork.', color: '#7c6bff' },
    { icon: '🔥', title: 'Dependency Heatmap', tag: 'Concentration', desc: 'A category × zone concentration matrix that pinpoints exactly where you are over-exposed.', color: '#fb7185' },
    { icon: '💬', title: 'Ask-the-Assistant (NL)', tag: 'Conversational', desc: 'Interrogate any event in plain English — get ChatGPT-quality answers citing your actual numbers and supplier names.', color: '#38bdf8' },
    { icon: '✉️', title: 'Supplier Outreach Drafter', tag: 'Action-ready', desc: 'One click drafts a tailored supplier outreach email for the recovery option you choose — content-safety filtered.', color: '#c084fc' },
    { icon: '📑', title: '9 Audit-Ready Reports', tag: 'Governance', desc: 'Event log, swarm performance, memory accuracy, dissent, simulation, cascade, counterfactual, HIL decisions & forecast accuracy — all exportable.', color: '#22d3ee' },
    { icon: '🔁', title: 'Counterfactual Learning Loop', tag: 'MCAS', desc: 'After you confirm what actually happened, the system records actual-vs-predicted deltas and calibrates the next forecast.', color: '#fcd34d' },
  ]
  return (
    <section id="platform" className="lp-section capabilities">
      <div className="lp-container">
        <Reveal><SectionHead eyebrow="The full platform" title="Far more than alerts — a complete resilience cockpit" sub="Every module is built into the dashboard. Onboard your suppliers once and unlock all of it." /></Reveal>
        <div className="cap-grid">
          {caps.map((c, idx) => (
            <Reveal key={c.title} className="cap-card" delay={(idx % 4) * 70}>
              <div className="cap-card-inner" style={{ '--cap': c.color }}>
                <div className="cap-top">
                  <span className="cap-icon" style={{ background: `${c.color}1f`, color: c.color }}>{c.icon}</span>
                  <span className="cap-tag" style={{ color: c.color, borderColor: `${c.color}55`, background: `${c.color}14` }}>{c.tag}</span>
                </div>
                <h3>{c.title}</h3>
                <p>{c.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={120}>
          <p className="cap-foot">
            Plus: real-time twin map, custom &amp; auto-seeded disruption scenarios, chaos-mode stress testing,
            Ctrl-K global search, per-device session control, CSAT feedback, in-app support tickets and a full owner admin console.
          </p>
        </Reveal>
      </div>
    </section>
  )
}

function IndustryCasesSection() {
  const [activeTab, setActiveTab] = useState('Automotive')
  const cases = {
    Automotive: { description: 'One vehicle carries ~30,000 parts sourced through hundreds of Tier-1 and thousands of Tier-2 suppliers. A single fab or stamping-plant outage stops the assembly line within hours.', metrics: [['Typical Tier-1 network', '250+'], ['Avg. cost per disruption', '$1M+'], ['Detect → decide', '90 sec']] },
    Electronics: { description: 'Contract manufacturers compete on 7-day lead times. A port strike, customs hold or a single component shortage compounds across the entire build instantly.', metrics: [['Component suppliers', '180+'], ['Sector loss / year', '$16B'], ['Detect → decide', '90 sec']] },
    Pharmaceutical: { description: 'APIs are frequently single- or dual-sourced and cold-chain dependent. A supplier failure or regulatory delay hits patient supply and compliance directly.', metrics: [['API & excipient suppliers', '120+'], ['Suppliers at high financial risk', '24%'], ['Detect → decide', '90 sec']] },
    Logistics: { description: 'Fleet- and lane-dependent networks must absorb fuel spikes, driver shortages and border closures within hours — or face cascading downstream stockouts.', metrics: [['Carriers & lanes', '150+'], ['Avg. disruption cost / firm', '$1M+/yr'], ['Detect → decide', '90 sec']] },
  }
  const active = cases[activeTab]
  return (
    <section className="lp-section industry">
      <div className="lp-container">
        <Reveal><SectionHead eyebrow="Industry fit" title="Tuned to your supply chain's weak points" sub="DisruptIQ adapts to the vulnerabilities that matter most in your industry." /></Reveal>
        <Reveal delay={80}>
          <div className="industry-tabs">
            {Object.keys(cases).map(ind => (
              <button key={ind} className={`industry-tab ${activeTab === ind ? 'active' : ''}`} onClick={() => setActiveTab(ind)}>{ind}</button>
            ))}
          </div>
          <div className="industry-body">
            <p className="industry-desc">{active.description}</p>
            <div className="industry-metrics">
              {active.metrics.map(([label, value]) => (
                <div className="industry-metric" key={label}>
                  <div className="industry-metric-label">{label}</div>
                  <div className="industry-metric-value">{value}</div>
                </div>
              ))}
            </div>
          </div>
          <p className="industry-sources">
            Benchmarks from McKinsey supply-chain risk research, DP World and Air Cargo Week disruption-cost studies (2024–25).
            Your own figures are calculated live from the suppliers you upload.
          </p>
        </Reveal>
      </div>
    </section>
  )
}

function SurveyModal({ onClose }) {
  const [step, setStep] = useState(1)
  const [answers, setAnswers] = useState({ role: '', challenge: '', feature: '', email: '', extra: '' })
  const [submitted, setSubmitted] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const roles = ['Supply Chain Manager', 'Operations Director', 'Procurement Lead', 'Logistics Head', 'C-Suite / Founder', 'IT / Tech', 'Other']
  const challenges = ['Slow disruption response', 'Lack of supplier visibility', 'Too many manual processes', 'No risk forecasting', 'Poor data quality', 'Other']
  const features = ['Real-time alerts', 'AI-generated action plans', 'Supplier risk scoring', 'Demand forecasting', 'Simulation / what-if', 'ERP integration']
  const inputStyle = { width: '100%', padding: '10px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)', borderRadius: 8, color: 'var(--text-pri)', fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit' }
  const chip = (sel) => ({ padding: '8px 14px', borderRadius: 20, fontSize: 12, cursor: 'pointer', border: sel ? '1px solid var(--primary)' : '1px solid var(--glass-border)', background: sel ? 'rgba(124,107,255,0.15)' : 'transparent', color: sel ? '#c3b9ff' : 'var(--text-sec)', transition: 'all 0.15s' })

  const submit = async () => {
    setSending(true)
    setError('')
    try {
      await api.submitSurvey({
        role: answers.role,
        challenge: answers.challenge,
        feature: answers.feature,
        comment: answers.extra,
        email: answers.email,
      })
      setSubmitted(true)
    } catch (e) {
      // Don't trap the user — thank them anyway; their click still counted.
      setError('We could not reach the server, but thank you for your time!')
      setSubmitted(true)
    } finally {
      setSending(false)
    }
  }

  return (
    <div onClick={onClose} className="modal-overlay">
      <div onClick={e => e.stopPropagation()} className="survey-modal">
        {submitted ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-pri)', margin: '0 0 8px' }}>Thank you!</h3>
            <p style={{ fontSize: 13, color: 'var(--text-sec)', margin: '0 0 20px' }}>Your feedback helps us build a better platform for supply chain teams. We read every response.</p>
            <button className="btn-cta btn-cta-primary" onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-pri)' }}>Product Survey</h3>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-dim)' }}>Step {step} of 3 · ~2 minutes</p>
              </div>
              <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div style={{ height: 3, background: 'var(--glass-border)', borderRadius: 2, marginBottom: 22 }}>
              <div style={{ height: '100%', width: `${(step / 3) * 100}%`, background: 'linear-gradient(90deg,#7c6bff,#2dd4bf)', borderRadius: 2, transition: 'width 0.3s' }} />
            </div>
            {step === 1 && (
              <div>
                <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-pri)', marginBottom: 14 }}>What best describes your role?</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{roles.map(r => <button key={r} onClick={() => setAnswers(a => ({ ...a, role: r }))} style={chip(answers.role === r)}>{r}</button>)}</div>
                <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-pri)', margin: '20px 0 12px' }}>Biggest supply chain challenge?</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{challenges.map(c => <button key={c} onClick={() => setAnswers(a => ({ ...a, challenge: c }))} style={chip(answers.challenge === c)}>{c}</button>)}</div>
              </div>
            )}
            {step === 2 && (
              <div>
                <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-pri)', marginBottom: 14 }}>Which feature matters most to you?</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{features.map(f => <button key={f} onClick={() => setAnswers(a => ({ ...a, feature: f }))} style={chip(answers.feature === f)}>{f}</button>)}</div>
              </div>
            )}
            {step === 3 && (
              <div>
                <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-pri)', marginBottom: 4 }}>Anything else you'd like us to build?</p>
                <p style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12 }}>Optional — but we read every response.</p>
                <textarea value={answers.extra} onChange={e => setAnswers(a => ({ ...a, extra: e.target.value }))} placeholder="e.g. SAP integration, mobile alerts, custom reports…" style={{ ...inputStyle, height: 90, resize: 'vertical' }} />
                <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-pri)', margin: '16px 0 8px' }}>Email for follow-up? <span style={{ fontWeight: 400, color: 'var(--text-dim)' }}>(optional)</span></p>
                <input type="email" value={answers.email} onChange={e => setAnswers(a => ({ ...a, email: e.target.value }))} placeholder="you@company.com" style={inputStyle} />
                {error && <p style={{ fontSize: 12, color: '#fca5a5', marginTop: 10 }}>{error}</p>}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24, gap: 12 }}>
              {step > 1 ? <button onClick={() => setStep(s => s - 1)} className="btn-cta btn-cta-secondary" style={{ padding: '10px 20px' }}>← Back</button> : <div />}
              {step < 3
                ? <button onClick={() => setStep(s => s + 1)} className="btn-cta btn-cta-primary" style={{ padding: '10px 24px' }}>Next →</button>
                : <button onClick={submit} disabled={sending} className="btn-cta btn-cta-primary" style={{ padding: '10px 24px', background: 'linear-gradient(120deg,#16a34a,#22c55e)', opacity: sending ? 0.6 : 1 }}>{sending ? 'Submitting…' : 'Submit →'}</button>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function SurveyBannerSection() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <section className="survey">
        <div className="lp-container survey-inner">
          <h3>Help us build the platform you need</h3>
          <p>Tell us your biggest supply chain challenge — it takes 2 minutes, and we read every response.</p>
          <button className="btn-cta btn-cta-primary" onClick={() => setOpen(true)}>Take our 2-minute survey →</button>
        </div>
      </section>
      {open && <SurveyModal onClose={() => setOpen(false)} />}
    </>
  )
}

function PricingSection({ onSignupClick, onDemoClick }) {
  const tiers = [
    {
      name: 'EXPLORER',
      price: 'Free',
      subtitle: 'forever',
      ideal: 'Teams evaluating the platform',
      features: ['Full demo mode access', 'Live 9-agent swarm simulation', 'All dashboards & reports', 'Twin map, heatmap & trends', 'Learn with pre-loaded scenarios'],
      limitations: ['Read-only · no data import', 'No email support'],
      cta: 'Try Demo — No Signup',
      primary: false,
      onClick: onDemoClick,
    },
    {
      name: 'BUSINESS',
      price: 'Free',
      subtitle: 'up to 30 suppliers',
      ideal: 'Growing teams & supply chain leads',
      features: ['Everything in Explorer', 'Upload up to 30 suppliers', 'Custom disruption scenarios', 'Unlimited swarm runs', 'Tier-2, financial & ESG risk', 'Full map, heatmap & 9 reports', 'Email support (24h response)', 'API access'],
      limitations: [],
      cta: 'Sign Up Free',
      primary: true,
      onClick: onSignupClick,
      afterNote: true,
    },
    {
      name: 'ENTERPRISE',
      price: 'Custom',
      subtitle: 'tailored to your scale',
      ideal: 'Large & complex supply chains',
      features: ['Unlimited suppliers', 'Dedicated onboarding & training', 'Account manager + priority SLA', 'Custom integrations & SSO', '99.9% uptime guarantee', 'Compliance-ready audit logs'],
      limitations: [],
      cta: 'Talk to Us',
      primary: false,
      onClick: () => { window.location.href = `mailto:${CONTACT_EMAIL}?subject=DisruptIQ Enterprise Enquiry` },
      enterpriseNote: true,
    },
  ]
  return (
    <section id="pricing" className="lp-section pricing">
      <div className="lp-container">
        <Reveal><SectionHead eyebrow="Pricing" title="Start free. Scale as you grow." sub="No credit card required. No surprise billing. Upgrade only when you're ready." /></Reveal>
        <div className="pricing-grid">
          {tiers.map((t, idx) => (
            <Reveal key={t.name} className={`pricing-card ${t.primary ? 'primary' : ''}`} delay={idx * 90}>
              <h3>{t.name}</h3>
              <div className="price">{t.price}</div>
              <div className="price-sub">{t.subtitle}</div>
              <p className="ideal">{t.ideal}</p>
              <div className="features">
                {t.features.map(f => <div className="feature" key={f}><span className="check">✓</span> {f}</div>)}
                {t.limitations.map(l => <div className="limitation" key={l}><span className="cross">✕</span> {l}</div>)}
              </div>
              <button className={`btn-cta ${t.primary ? 'btn-cta-primary' : 'btn-cta-secondary'}`} style={{ width: '100%' }} onClick={t.onClick}>{t.cta}</button>
              {t.afterNote && (
                <p style={{ fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', marginTop: 12, lineHeight: 1.6 }}>
                  Hit the 30-supplier limit? Request a Pro upgrade in one click from inside the app —
                  selected accounts are granted free Pro access on a first-come, first-served basis. ✨
                </p>
              )}
              {t.enterpriseNote && (
                <div className="enterprise-fcfs">
                  <span className="fcfs-badge">✨ Feeling lucky?</span>
                  <p>
                    Exceed 30 suppliers and you can <strong>request a free Pro upgrade</strong> straight from the app.
                    We grant complimentary Pro access — unlimited suppliers — to a limited number of accounts on a
                    <strong> first-come, first-served</strong> basis. Request early, and you might just be one of the
                    lucky few unlocked on us before you ever talk to sales.
                  </p>
                </div>
              )}
            </Reveal>
          ))}
        </div>
        <Reveal delay={200}>
          <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-dim)', marginTop: 28, lineHeight: 1.6 }}>
            Questions about pricing or your specific use case?{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 500 }}>
              {CONTACT_EMAIL}
            </a>
          </p>
        </Reveal>
      </div>
    </section>
  )
}

function FAQSection() {
  const [expanded, setExpanded] = useState(0)
  const faqs = [
    { q: 'What data do you need from me?', a: 'Just supplier names, locations and categories. No contracts, pricing or confidential details. For demo mode, we provide sample data so you can explore everything risk-free.' },
    { q: 'How is my data protected?', a: 'Azure Cosmos DB encryption at rest (AES-256), TLS in transit, full audit logs, RBAC, per-device session control and strict per-client isolation — one tenant can never see another tenant\'s data.' },
    { q: 'What happens if I exceed 30 suppliers?', a: 'The free Business plan covers up to 30 suppliers. When you hit the limit, you can request a Pro upgrade in one click from inside the app. We grant free Pro (unlimited suppliers) to a limited number of accounts on a first-come, first-served basis — so request early.' },
    { q: 'What can the platform actually see?', a: 'Beyond real-time alerts: Tier-2 hidden dependencies, per-supplier financial health, ESG & compliance risk, a resilience score, a dependency heatmap, cross-industry benchmarks, a daily risk briefing, and a conversational AI assistant — all from the suppliers you upload.' },
    { q: 'What if I disagree with the AI recommendation?', a: 'You\'re always in control. Don\'t approve it, pick a different option, or create a custom action. Human approval is server-enforced — the system can never act without you, and severity ≥9 events require a co-reviewer.' },
    { q: 'How does the learning system work?', a: 'Our Memory-Calibrated Agent Swarm (MCAS) records predictions and actual outcomes. The next similar disruption gets recommendations calibrated by real-world experience — your supply chain genuinely gets smarter over time.' },
    { q: 'Do I need to be a data scientist?', a: 'No. It\'s built to be simple: see alerts, review ranked options, approve. Complexity is hidden, with deep detail (and a plain-English "Why?" on every score) available whenever you want it.' },
  ]
  return (
    <section id="faq" className="lp-section faq">
      <div className="lp-container">
        <Reveal><SectionHead eyebrow="FAQ" title="Questions, answered" /></Reveal>
        <Reveal className="faq-list" delay={80}>
          {faqs.map((item, idx) => (
            <div key={idx} className={`faq-item ${expanded === idx ? 'expanded' : ''}`} onClick={() => setExpanded(expanded === idx ? null : idx)}>
              <h4>{item.q}</h4>
              {expanded === idx && <p>{item.a}</p>}
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  )
}

function FinalCTASection({ onDemoClick, onSignupClick }) {
  return (
    <section className="lp-section final-cta">
      <div className="lp-container">
        <Reveal>
          <h2>Ready to transform your supply chain?</h2>
          <p>Join supply chain leaders responding to disruptions 10× faster — free up to 30 suppliers.</p>
          <div className="final-ctas">
            <button className="btn-cta btn-cta-primary" onClick={onSignupClick}>Start Free — Create Account</button>
            <button className="btn-cta btn-cta-secondary" onClick={onDemoClick}>▶ Try Demo (no signup)</button>
          </div>
          <p className="cta-hint">Free forever up to 30 suppliers · no credit card required · cancel anytime</p>
        </Reveal>
      </div>
    </section>
  )
}

function CreatorSection() {
  return (
    <section className="lp-section creator">
      <div className="lp-container creator-inner">
        <Reveal className="creator-content">
          <div className="creator-header">
            <span className="eyebrow-pill">About the developer</span>
            <h2>Bharath Kumar KCS</h2>
            <p className="creator-subtitle">Associate Product Manager · Enterprise AI/ML Platforms · 3.5+ years</p>
          </div>
        </Reveal>

        <Reveal className="creator-body" delay={80}>
          <div className="creator-card">
            <div className="creator-photo-section">
              <div className="creator-photo-wrap">
                <img src="/bharath-founder.jpg" alt="Bharath Kumar KCS" className="creator-photo" />
              </div>
              <p className="creator-photo-caption">Bharath Kumar KCS</p>
            </div>

            <div className="creator-info">
              <div className="creator-section-box creator-section-box-first">
                <h4>Education</h4>
                <div className="creator-item">
                  <div className="creator-degree">PGDM — General Management</div>
                  <div className="creator-school">XLRI Jamshedpur <span className="creator-year">2025 – 2026</span></div>
                </div>
                <div className="creator-item">
                  <div className="creator-degree">B.Tech — Computer Science & Engineering</div>
                  <div className="creator-school">SASTRA Deemed University <span className="creator-year">2017 – 2021</span></div>
                </div>
              </div>

              <div className="creator-section-box">
                <h4>Professional Experience</h4>
                <div className="creator-item">
                  <div className="creator-role">Advanced Application Engineering Analyst</div>
                  <div className="creator-company">Accenture · Apr 2022 – Apr 2025</div>
                  <div className="creator-desc">Product Owner for ML & Conversational AI platforms; delivered $2.1M ROI, optimized anomaly detection (18% → 6% false positives), reduced response time 45min → 8min, and built GenAI RAG POC.</div>
                </div>
                <div className="creator-item">
                  <div className="creator-role">Technical Support Specialist</div>
                  <div className="creator-company">ADP · Jul 2021 – Mar 2022</div>
                  <div className="creator-desc">Drove HRMS product improvement across 11 enterprise clients; boosted feature adoption 34%, reduced downtime 30%, and achieved 96.4% stakeholder satisfaction.</div>
                </div>
              </div>

              <p className="creator-vision">
                This platform automatically identifies supply chain disruptions affecting your suppliers, pinpoints their geographic locations, and alerts you instantly. It analyzes impact across your entire network and provides ranked recommendations on what actions to take — all within 90 seconds. Human judgment remains central; every decision is yours to approve.
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

function Footer({ onDemoClick }) {
  return (
    <footer className="lp-footer">
      <div className="lp-container footer-grid">
        <div className="footer-brand-col">
          <div className="footer-brand"><span className="footer-logo">◆</span> DisruptIQ</div>
          <p>Real-time supply-chain disruption response, powered by a 9-agent AI swarm. A human approves every action.</p>
        </div>
        <div className="footer-col">
          <h5>Product</h5>
          <a href="#how-it-works">How it works</a>
          <a href="#features">Features</a>
          <a href="#platform">Platform</a>
          <a href="#pricing">Pricing</a>
        </div>
        <div className="footer-col">
          <h5>Resources</h5>
          <a href="#faq">FAQ</a>
          <button className="footer-link" onClick={onDemoClick}>Live demo</button>
          <a href={`mailto:${CONTACT_EMAIL}`}>Contact us</a>
        </div>
        <div className="footer-col">
          <h5>Get in touch</h5>
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ fontWeight: 600, color: '#c3b9ff' }}>{CONTACT_EMAIL}</a>
          <span className="footer-note">🔒 AES-256 encrypted</span>
          <span className="footer-note">🤝 Human-approved AI</span>
        </div>
      </div>
      <div className="footer-bottom">
        © {new Date().getFullYear()} DisruptIQ · Built for supply-chain resilience ·
        <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 500, marginLeft: 4 }}>
          {CONTACT_EMAIL}
        </a>
      </div>
    </footer>
  )
}

export default function Landing() {
  const navigate = useNavigate()
  const startDemo = (clientId = 'demo') => {
    try { sessionStorage.setItem('demo_client_id', clientId) } catch (_) {}
    navigate('/demo')
  }
  const onDemoClick = () => startDemo('demo')
  const onSignupClick = () => navigate('/signup-register')

  return (
    <div className="landing-page">
      <HeroSection onDemoClick={onDemoClick} onSignupClick={onSignupClick} />
      <TrustBar />
      <ProblemSection />
      <SolutionSection />

      <CapabilitiesSection />

      <PricingSection onSignupClick={onSignupClick} onDemoClick={onDemoClick} />
      <FAQSection />

      <CreatorSection />
      <Footer onDemoClick={onDemoClick} />
    </div>
  )
}
