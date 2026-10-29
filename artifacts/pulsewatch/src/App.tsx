import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import {
  Activity, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, Bell, Check, CheckCircle2,
  ChevronDown, ExternalLink, Globe2, HeartPulse, History, LayoutDashboard,
  Link2, LogOut, Pause, Play, Plus, Search,
  Settings2, ShieldCheck, Siren, Sparkles, Timer, Trash2, TriangleAlert, Wifi, X,
} from 'lucide-react';
import {
  useAcknowledgeIncident, useCheckMonitorNow, useCreateMonitor, useDeleteMonitor,
  useGetDashboard, useGetIncident, useGetMonitor, useGetPublicStatusPage,
  useGetStatusPageSettings, useHealthCheck, useInvestigateIncident, useListIncidents,
  useListMonitorChecks, useListMonitors, usePauseMonitor, useResolveIncident,
  useResumeMonitor, useSeedDemoMonitors, useUpdateMonitor, useUpdateStatusPageSettings,
  getGetDashboardQueryKey, getGetIncidentQueryKey, getGetMonitorQueryKey,
  getGetPublicStatusPageQueryKey, getGetStatusPageSettingsQueryKey, getHealthCheckQueryKey, getListIncidentsQueryKey,
  getListMonitorChecksQueryKey, getListMonitorsQueryKey,
} from '@workspace/api-client-react';
import { Route, Switch, Link, Redirect, useLocation, Router as WouterRouter } from 'wouter';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } } });
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const stripBase = (path: string) => basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;

const appearance = {
  theme: shadcn, cssLayerName: 'clerk',
  options: { logoPlacement: 'inside' as const, logoLinkUrl: basePath || '/', logoImageUrl: `${window.location.origin}${basePath}/logo.svg` },
  variables: {
    colorPrimary: '#286a59', colorForeground: '#25343a', colorMutedForeground: '#74817b', colorDanger: '#b94f43',
    colorBackground: '#fbfaf6', colorInput: '#fbfaf6', colorInputForeground: '#25343a', colorNeutral: '#ded9ce',
    fontFamily: 'DM Sans', borderRadius: '0.65rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center', cardBox: 'bg-[#fbfaf6] rounded-2xl w-[440px] max-w-full overflow-hidden',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none', footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#25343a] font-semibold', headerSubtitle: 'text-[#74817b]', socialButtonsBlockButtonText: 'text-[#25343a]',
    formFieldLabel: 'text-[#4e5d58]', footerActionLink: 'text-[#286a59]', footerActionText: 'text-[#74817b]',
    dividerText: 'text-[#74817b]', identityPreviewEditButton: 'text-[#286a59]', formFieldSuccessText: 'text-[#286a59]',
    alertText: 'text-[#a64e40]', logoBox: 'rounded-xl', logoImage: 'rounded-lg', socialButtonsBlockButton: 'border-[#ded9ce]',
    formButtonPrimary: 'bg-[#286a59] hover:bg-[#215847]', formFieldInput: 'border-[#ded9ce] bg-[#fbfaf6] text-[#25343a]',
    footerAction: 'border-t border-[#eeeae1]', dividerLine: 'bg-[#e4dfd6]', alert: 'bg-[#f8e9e5]',
    otpCodeFieldInput: 'border-[#ded9ce]', formFieldRow: 'gap-2', main: 'gap-5',
  },
};

type PageProps = { title: string; eyebrow?: string; actions?: ReactNode; children: ReactNode };
function Page({ title, eyebrow = 'Operations / PulseWatch', actions, children }: PageProps) {
  return <div className="main-content fade-up"><div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1></div>{actions}</div>{children}</div>;
}
function ErrorBox({ retry }: { retry: () => void }) {
  return <div className="panel error-state"><div className="empty-mark"><TriangleAlert size={18} /></div><h3>We couldn't load this view</h3><p className="subtle">The signal is temporarily unavailable. Try again in a moment.</p><button className="btn" onClick={retry} data-testid="button-retry"><Activity size={14} /> Retry</button></div>;
}
function LoadingBox() {
  return <div className="panel loading-state"><div className="skeleton-line" /><div className="skeleton-line short" /><div className="skeleton-line" /></div>;
}
function EmptyBox({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="panel empty-state"><div className="empty-mark"><Activity size={18} /></div><h3>{title}</h3><p className="subtle">{detail}</p>{action}</div>;
}
function StatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase().replaceAll(' ', '_');
  return <span className={`badge ${normalized}`}><i className={`status-dot ${normalized}`} />{status.replaceAll('_', ' ')}</span>;
}
function DemoTag() {
  return <span style={{ display: 'inline-block', marginLeft: 7, padding: '2px 6px', borderRadius: 5, background: '#f2e7d1', color: '#785b24', fontSize: 9, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase' }}>Sample</span>;
}
function Shell({ children }: { children: ReactNode }) {
  const [path] = useLocation();
  const dashboard = useGetDashboard({ period: '24h' });
  const activeIncidents = dashboard.data?.openIncidents ?? 0;
  const { user } = useUser();
  const { signOut } = useClerk();
  const nav = [
    { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
    { href: '/monitors', label: 'Monitors', icon: HeartPulse },
    { href: '/incidents', label: 'Incidents', icon: Siren, count: activeIncidents },
    { href: '/settings', label: 'Status page', icon: Globe2 },
  ];
  return <div className="shell">
    <aside className="sidebar">
      <Link href="/dashboard" className="brand" data-testid="link-brand-dashboard"><span className="brand-mark"><Activity size={17} strokeWidth={2.6} /></span><span>pulsewatch</span></Link>
      <div className="nav-label">Command desk</div>
      <nav>{nav.map(item => <Link href={item.href} key={item.href} className={`nav-link ${path === item.href || (item.href !== '/dashboard' && path.startsWith(`${item.href}/`)) ? 'active' : ''}`} data-testid={`link-nav-${item.label.toLowerCase().replace(' ', '-')}`}><item.icon size={16} />{item.label}{item.count ? <span className="nav-count">{item.count}</span> : null}</Link>)}</nav>
      <div className="nav-label" style={{ marginTop: 20 }}>Workspace</div>
      <Link href="/settings" className="nav-link"><Settings2 size={16} />Settings</Link>
      <div className="sidebar-bottom">
        <div className="workspace-chip"><span className="workspace-avatar">{user?.firstName?.slice(0, 1) || 'P'}</span><div><div style={{ fontSize: 11, fontWeight: 700 }}>{user?.firstName || 'Engineering team'}</div><div style={{ fontSize: 10, color: '#92a19b', marginTop: 3 }}>Personal workspace</div></div><ChevronDown size={13} style={{ marginLeft: 'auto', color: '#92a19b' }} /></div>
        <button className="nav-link" style={{ width: '100%', border: 0, background: 'transparent', cursor: 'pointer' }} onClick={() => signOut({ redirectUrl: basePath || '/' })} data-testid="button-sign-out"><LogOut size={16} />Sign out</button>
      </div>
    </aside>
    <section className="main-area">
      <header className="topbar"><div className="topbar-caption">MONITORING REGION <span style={{ color: '#286a59' }}>●</span> US EAST · 1 MINUTE INTERVAL</div><div style={{ display: 'flex', alignItems: 'center', gap: 14 }}><span className="topbar-caption">ALL SYSTEMS NOMINAL</span><span style={{ width: 29, height: 29, borderRadius: 9, background: '#e1e9de', color: '#286a59', display: 'grid', placeItems: 'center', font: '11px DM Mono' }}>{user?.firstName?.slice(0, 1) || 'P'}</span></div></header>
      {children}
    </section>
  </div>;
}
function Private({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div className="auth-wrap"><LoadingBox /></div>;
  if (!isSignedIn) return <Redirect to="/" />;
  return <Shell>{children}</Shell>;
}
function ClerkCacheReset() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const previous = useRef<string | null | undefined>(undefined);
  useEffect(() => addListener(({ user }) => {
    const next = user?.id ?? null;
    if (previous.current !== undefined && previous.current !== next) client.clear();
    previous.current = next;
  }), [addListener, client]);
  return null;
}

function AuthPage({ kind }: { kind: 'in' | 'up' }) {
  return <div className="auth-wrap pulse-grid"><div style={{ position: 'relative', zIndex: 1, width: 'min(440px,100%)' }}>
    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 22 }}><Link href="/" className="brand" style={{ color: '#203138', padding: 0 }}><span className="brand-mark"><Activity size={17} /></span><span>pulsewatch</span></Link></div>
    {kind === 'in' ? <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /> : <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />}
  </div><div className="auth-aside">CALM SIGNALS FOR THE MOMENT THAT MATTERS.</div></div>;
}

function Landing() {
  const { isSignedIn, isLoaded } = useAuth();
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey() } });
  if (isLoaded && isSignedIn) return <Redirect to="/dashboard" />;
  return <main className="landing">
    <nav className="landing-nav"><Link href="/" className="brand"><span className="brand-mark"><Activity size={17} /></span><span>pulsewatch</span></Link><div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Link href="/sign-in" className="btn btn-ghost">Sign in</Link><Link href="/sign-up" className="btn btn-primary">Start monitoring <ArrowRight size={14} /></Link></div></nav>
    <section className="hero">
      <div className="fade-up"><div className="eyebrow"><span className="status-dot" /> A quieter kind of on-call</div><h1>Know when it matters. <span>Ignore the rest.</span></h1><p className="hero-copy">PulseWatch keeps a steady eye on the services your team depends on. Clear signals, useful context, and a status page your customers can trust.</p><div className="hero-actions"><Link href="/sign-up" className="btn btn-primary">Create your workspace <ArrowRight size={15} /></Link><a className="btn" href="#how-it-works">See how it works <ArrowDownRight size={15} /></a></div><div className="subtle" style={{ fontSize: 11, marginTop: 18 }}>Built for small teams. No alert theater.</div></div>
      <div className="hero-visual pulse-grid"><div className="hero-window"><div className="window-top"><i /><i /><i /><span className="window-title">pulsewatch / public status</span><ExternalLink size={12} style={{ marginLeft: 'auto', color: '#9aa29b' }} /></div><div className="mock-status"><div className="mock-ok"><CheckCircle2 size={18} /> All systems operational <span className="mono" style={{ fontSize: 10, marginLeft: 'auto' }}>UPDATED JUST NOW</span></div>{[['Core API','99.98%','48 ms'],['Checkout','99.94%','112 ms'],['Edge network','100%','31 ms']].map(([name,up,latency]) => <div className="mock-row" key={name}><div><div style={{ color: '#34423e', fontWeight: 700 }}>{name}</div><div className="mono" style={{ color: '#8c958e', fontSize: 9, marginTop: 5 }}>30 DAY UPTIME {up}</div></div><div className="mock-pips">{Array.from({ length: 24 }, (_, i) => <span key={i} />)}</div><span className="mono">{latency}</span></div>)}</div></div><div className="hero-stamp">LESS NOISE<br />MORE SIGNAL</div></div>
    </section>
    <section className="landing-section" id="how-it-works"><div className="section-heading"><div className="eyebrow">The signal, not the noise</div><h2>Reliability starts with knowing what changed.</h2><p>Catch the important moment, give it a name, and keep your team and customers on the same page.</p></div><div className="feature-grid">
      <article className="feature"><div className="feature-icon"><Activity size={18} /></div><h3>Checks with context</h3><p>Watch HTTP endpoints on a cadence that fits your service. Response time, status, and failure cause stay together in one readable history.</p></article>
      <article className="feature"><div className="feature-icon"><Bell size={18} /></div><h3>Incidents that tell a story</h3><p>A clean audit trail makes handoffs easier, from first detection to the moment things settle.</p></article>
      <article className="feature"><div className="feature-icon"><Globe2 size={18} /></div><h3>Keep customers informed</h3><p>Publish a sanitized status page with service health and incident updates. No internal detail leaks through.</p></article>
    </div></section>
    <div className="quote-strip"><div className="quote-inner"><blockquote>“At 2 a.m., the best alert is the one that tells you exactly where to look.”</blockquote><div className="quote-source">Designed for the on-call rotation</div></div></div>
    <section className="landing-section landing-story"><div><div className="eyebrow">A desk, not another dashboard</div><h2 className="display" style={{ fontSize: 37, letterSpacing: -1.5, lineHeight: 1.08, color: '#203138' }}>Everything important at a glance. Nothing fighting for attention.</h2><p className="subtle" style={{ lineHeight: 1.7 }}>A health overview, incident history, monitor controls, and response-time patterns share one calm command desk. The details are there when you need to go deeper.</p></div><div className="panel" style={{ padding: 20 }}><div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 15 }}><b className="display">Live service pulse</b><span className="badge operational">Healthy now</span></div><div className="chart-bars" style={{ height: 115 }}>{Array.from({ length: 34 }, (_, i) => <div className={`chart-bar ${i === 23 ? 'fail' : ''}`} key={i} style={{ height: `${24 + ((i * 23 + 13) % 58)}%` }} />)}</div><div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}><span className="mono subtle">09:00</span><span className="mono subtle">12:00</span><span className="mono subtle">15:00</span><span className="mono subtle">NOW</span></div></div></section>
    <footer className="landing-footer"><Link href="/" className="brand" style={{ color: '#26343a', padding: 0, fontSize: 15 }}><span className="brand-mark"><Activity size={15} /></span><span>pulsewatch</span></Link><span>Quiet confidence for every release.</span><span className="mono">SERVICE SIGNAL {health.data?.status || 'READY'}</span></footer>
  </main>;
}

function MonitorModal({ onClose, onCreated, initial }: { onClose: () => void; onCreated?: () => void; initial?: any }) {
  const create = useCreateMonitor();
  const update = useUpdateMonitor();
  const client = useQueryClient();
  const [name, setName] = useState(initial?.name || '');
  const [url, setUrl] = useState(initial?.url || 'https://');
  const [method, setMethod] = useState<'GET' | 'HEAD'>(initial?.method || 'GET');
  const [interval, setInterval] = useState(String(initial?.intervalSeconds || 60));
  const [timeoutMs, setTimeoutMs] = useState(String(initial?.timeoutMs ?? 10000));
  const [expectedCodes, setExpectedCodes] = useState((initial?.expectedStatusCodes || [200]).join(', '));
  const [failureThreshold, setFailureThreshold] = useState(String(initial?.failureThreshold ?? 3));
  const [isPublic, setIsPublic] = useState(Boolean(initial?.isPublic));
  const [validationError, setValidationError] = useState('');
  const busy = create.isPending || update.isPending;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const codes = [...new Set(expectedCodes.split(',').map(code => Number(code.trim())))];
    if (!codes.length || codes.some(code => !Number.isInteger(code) || code < 100 || code > 599)) {
      setValidationError('Enter one or more HTTP status codes from 100 to 599.');
      return;
    }
    const data = {
      name: name.trim(),
      url: url.trim(),
      method,
      intervalSeconds: Number(interval) as 30 | 60 | 300 | 600,
      timeoutMs: Number(timeoutMs),
      expectedStatusCodes: codes,
      failureThreshold: Number(failureThreshold),
      isPublic,
    };
  const done = () => { client.invalidateQueries({ queryKey: getListMonitorsQueryKey() }); client.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); onCreated?.(); onClose(); };
    if (initial) update.mutate({ monitorId: initial.id, data }, { onSuccess: done });
    else create.mutate({ data }, { onSuccess: done });
  };
  return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}><div className="modal"><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}><div><div className="eyebrow">{initial ? 'Monitor configuration' : 'Add a signal'}</div><h2>{initial ? 'Edit monitor' : 'Create a monitor'}</h2><p className="subtle" style={{ marginTop: 0 }}>Choose the endpoint and cadence PulseWatch should watch.</p></div><button className="btn btn-ghost" onClick={onClose} aria-label="Close dialog"><X size={16} /></button></div>
    <form onSubmit={submit}><div className="form-grid">
      <div className="field full"><label htmlFor="monitor-name">SERVICE NAME</label><input id="monitor-name" className="input" required maxLength={100} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Checkout API" data-testid="input-monitor-name" /></div>
      <div className="field full"><label htmlFor="monitor-url">URL TO CHECK</label><input id="monitor-url" className="input mono" type="url" required value={url} onChange={e => setUrl(e.target.value)} placeholder="https://api.example.com/health" data-testid="input-monitor-url" /></div>
      <div className="field"><label htmlFor="monitor-method">REQUEST METHOD</label><select id="monitor-method" className="select" value={method} onChange={e => setMethod(e.target.value as 'GET' | 'HEAD')}><option>GET</option><option>HEAD</option></select></div>
      <div className="field"><label htmlFor="monitor-interval">CHECK EVERY</label><select id="monitor-interval" className="select" value={interval} onChange={e => setInterval(e.target.value)}><option value="30">30 seconds</option><option value="60">1 minute</option><option value="300">5 minutes</option><option value="600">10 minutes</option></select></div>
      <div className="field"><label htmlFor="monitor-timeout">TIMEOUT (MS)</label><input id="monitor-timeout" className="input" type="number" min={1000} max={30000} step={1000} required value={timeoutMs} onChange={e => setTimeoutMs(e.target.value)} data-testid="input-monitor-timeout" /></div>
      <div className="field"><label htmlFor="monitor-failure-threshold">FAIL AFTER</label><input id="monitor-failure-threshold" className="input" type="number" min={1} max={10} required value={failureThreshold} onChange={e => setFailureThreshold(e.target.value)} data-testid="input-monitor-failure-threshold" /></div>
      <div className="field full"><label htmlFor="monitor-expected-codes">EXPECTED HTTP STATUS CODES</label><input id="monitor-expected-codes" className="input mono" required value={expectedCodes} onChange={e => setExpectedCodes(e.target.value)} placeholder="200, 204" data-testid="input-monitor-expected-codes" /></div>
      <label className="field full" style={{ flexDirection: 'row', alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={isPublic} onChange={e => setIsPublic(e.target.checked)} /> <span style={{ fontSize: 12 }}>Show this service on my public status page</span></label>
    </div>{(validationError || create.isError || update.isError) && <p style={{ color: '#aa4d40', fontSize: 12 }}>{validationError || 'Could not save this monitor. Check the URL and try again.'}</p>}<div className="modal-footer"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} data-testid="button-save-monitor">{busy ? 'Saving…' : initial ? 'Save changes' : 'Create monitor'} <ArrowRight size={14} /></button></div></form></div></div>;
}

function DashboardPage() {
  const [period, setPeriod] = useState<'24h' | '7d' | '30d' | '90d'>('24h');
  const query = useGetDashboard({ period });
  const [createOpen, setCreateOpen] = useState(false);
  const data = query.data;
  if (query.isLoading) return <Page title="Overview"><div className="metric-grid">{[0,1,2,3].map(x => <div className="panel metric" key={x}><div className="skeleton-line" /><div className="skeleton-line short" /></div>)}</div><LoadingBox /></Page>;
  if (query.isError || !data) return <Page title="Overview"><ErrorBox retry={() => query.refetch()} /></Page>;
  const points = data.responseTimeSeries || [];
  return <Page title="Your command desk" eyebrow="Overview / Live workspace" actions={<div style={{ display: 'flex', gap: 9 }}><select aria-label="Analytics period" className="select" value={period} onChange={e => setPeriod(e.target.value as typeof period)}>{['24h','7d','30d','90d'].map(value => <option key={value} value={value}>{value === '24h' ? 'Last 24 hours' : `Last ${value}`}</option>)}</select><button className="btn btn-primary" onClick={() => setCreateOpen(true)} data-testid="button-add-monitor"><Plus size={14} /> Add monitor</button></div>}>
    <div className="metric-grid">
      <div className="panel metric"><div className="eyebrow">Service uptime</div><div className="metric-value">{data.uptimePercent.toFixed(2)}%</div><div className="metric-meta">across {data.totalMonitors} monitors <ArrowUpRight size={12} style={{ verticalAlign: 'middle', color: '#43866a' }} /></div></div>
      <div className="panel metric"><div className="eyebrow">Operational</div><div className="metric-value">{data.operationalMonitors}<span style={{ color: '#87918a', fontSize: 16 }}> / {data.totalMonitors}</span></div><div className="metric-meta">services responding</div></div>
      <div className="panel metric"><div className="eyebrow">Open incidents</div><div className="metric-value" style={{ color: data.openIncidents ? '#b65b48' : undefined }}>{data.openIncidents}</div><div className="metric-meta">{data.failingMonitors} failing · {data.pausedMonitors} paused</div></div>
      <div className="panel metric"><div className="eyebrow">Average response</div><div className="metric-value">{data.averageLatencyMs == null ? '—' : `${Math.round(data.averageLatencyMs)} ms`}</div><div className="metric-meta">measured over {period}</div></div>
    </div>
    <div className="chart-grid">
      <div className="panel chart-panel"><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}><div><div className="panel-title">Response time</div><div className="subtle" style={{ marginTop: 4 }}>Average latency across all monitored services</div></div><span className="badge"><Timer size={11} style={{ marginRight: 5 }} />{period}</span></div>
        {points.length ? <div className="chart-bars" aria-label="Response time chart">{points.map((point, i) => { const max = Math.max(1, ...points.map(p => p.averageLatencyMs || 0)); return <div key={`${point.timestamp}-${i}`} className={`chart-bar ${point.failures ? 'fail' : ''}`} title={`${point.averageLatencyMs ?? 'No'} ms · ${point.failures} failures`} style={{ height: `${Math.max(6, ((point.averageLatencyMs || 0) / max) * 85)}%` }} />; })}</div> : <div className="empty-state" style={{ padding: 30 }}>No response-time history for this period yet.</div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}><span className="mono subtle">EARLIER</span><span className="mono subtle">NOW</span></div>
      </div>
      <div className="panel" style={{ padding: 20 }}><div className="eyebrow">Service posture</div><div className="metric-value" style={{ fontSize: 22, marginTop: 14 }}>{data.operationalMonitors} healthy</div><div className="subtle">A quick read on your workspace</div><div style={{ marginTop: 20, height: 7, borderRadius: 8, background: '#eeeae0', overflow: 'hidden' }}><div style={{ height: '100%', width: `${data.totalMonitors ? 100 * data.operationalMonitors / data.totalMonitors : 0}%`, background: '#62a384', borderRadius: 8 }} /></div><div className="mono subtle" style={{ marginTop: 11 }}>{data.failingMonitors} DOWN · {data.pausedMonitors} PAUSED</div><Link href="/monitors" className="btn btn-small" style={{ marginTop: 20 }}>View monitors <ArrowRight size={12} /></Link></div>
    </div>
    <div className="panel" style={{ marginTop: 17 }}><div className="panel-head"><div><div className="panel-title">Monitored services</div><div className="subtle" style={{ marginTop: 3 }}>Current signal from every endpoint</div></div><Link href="/monitors" className="btn btn-small">All monitors <ArrowRight size={12} /></Link></div>
      {data.monitors.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Service</th><th>Status</th><th>Uptime</th><th>Latency</th><th>Last checked</th></tr></thead><tbody>{data.monitors.slice(0, 6).map(m => <tr key={m.id}><td><Link href={`/monitors/${m.id}`} style={{ color: 'inherit', textDecoration: 'none' }} data-testid={`link-monitor-${m.id}`}>{m.name}</Link>{m.isDemo && <DemoTag />}<div className="mono-url" style={{ marginTop: 4 }}>{m.url}</div></td><td><StatusBadge status={m.status} /></td><td className="mono">{m.uptimePercent.toFixed(2)}%</td><td className="mono">{m.lastLatencyMs == null ? '—' : `${m.lastLatencyMs} ms`}</td><td className="mono">{m.lastCheckedAt ? relative(m.lastCheckedAt) : 'Not checked'}</td></tr>)}</tbody></table></div> : <EmptyBox title="No monitors yet" detail="Add your first endpoint to start building a clear picture of service health." action={<button className="btn btn-primary" onClick={() => setCreateOpen(true)}><Plus size={14} /> Add a monitor</button>} />}
    </div>
    <div className="panel" style={{ marginTop: 17 }}><div className="panel-head"><div><div className="panel-title">Recent incidents</div><div className="subtle" style={{ marginTop: 3 }}>The latest moments that needed attention</div></div><Link href="/incidents" className="btn btn-small">Incident log <ArrowRight size={12} /></Link></div>
      {data.recentIncidents.length ? <div className="event-list">{data.recentIncidents.slice(0, 4).map(incident => <Link href={`/incidents/${incident.id}`} className="event-row" key={incident.id} style={{ textDecoration: 'none' }}><span className="event-time">{relative(incident.detectedAt)}</span><div><div className="event-name">{incident.monitorName}</div><div className="event-desc">{incident.durationSeconds ? `Lasted ${duration(incident.durationSeconds)}` : 'Awaiting resolution'}</div></div><StatusBadge status={incident.state} /></Link>)}</div> : <div className="subtle" style={{ padding: 23, textAlign: 'center' }}>No incidents recorded in this period.</div>}
    </div>
    {createOpen && <MonitorModal onClose={() => setCreateOpen(false)} />}
  </Page>;
}

function MonitorsPage() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [modal, setModal] = useState<any>(false);
  const params = useMemo(() => ({ search: search || undefined, status: filter as 'all' | 'up' | 'down' | 'paused' | 'unknown' }), [search, filter]);
  const query = useListMonitors(params);
  const client = useQueryClient();
  const pause = usePauseMonitor();
  const resume = useResumeMonitor();
  const remove = useDeleteMonitor();
  const check = useCheckMonitorNow();
  const refresh = () => { client.invalidateQueries({ queryKey: getListMonitorsQueryKey() }); client.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); };
  const monitors = query.data || [];
  return <Page title="Monitors" eyebrow="Command desk / Services" actions={<button className="btn btn-primary" onClick={() => setModal(true)} data-testid="button-create-monitor"><Plus size={14} /> New monitor</button>}>
    <div className="panel"><div className="panel-head" style={{ gap: 12, flexWrap: 'wrap' }}><div><div className="panel-title">All endpoints</div><div className="subtle" style={{ marginTop: 4 }}>{monitors.length} services in this view</div></div><div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}><div className="search-wrap"><Search size={14} /><input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search services" aria-label="Search monitors" data-testid="input-search-monitors" /></div><select className="select" aria-label="Filter monitor status" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All statuses</option><option value="up">Operational</option><option value="down">Failing</option><option value="paused">Paused</option><option value="unknown">Unknown</option></select></div></div>
      {query.isLoading ? <LoadingBox /> : query.isError ? <ErrorBox retry={() => query.refetch()} /> : monitors.length === 0 ? <EmptyBox title={search || filter !== 'all' ? 'No matching monitors' : 'Your monitor list is quiet'} detail={search || filter !== 'all' ? 'Try another search or status filter.' : 'Add an endpoint to start receiving dependable signals.'} action={<button className="btn btn-primary" onClick={() => setModal(true)}><Plus size={14} /> Create monitor</button>} /> :
       <div className="table-wrap"><table className="data-table"><thead><tr><th>Service</th><th>State</th><th>Uptime</th><th>Latency</th><th>Interval</th><th>Last checked</th><th>Actions</th></tr></thead><tbody>{monitors.map(m => <tr key={m.id}><td><Link href={`/monitors/${m.id}`} style={{ color: 'inherit', textDecoration: 'none' }}><span data-testid={`text-monitor-name-${m.id}`}>{m.name}</span></Link>{m.isDemo && <DemoTag />}<div className="mono-url" style={{ marginTop: 4 }}>{m.method} · {m.url}</div></td><td><StatusBadge status={m.status} /></td><td className="mono">{m.uptimePercent.toFixed(2)}%</td><td className="mono">{m.lastLatencyMs == null ? '—' : `${m.lastLatencyMs} ms`}</td><td className="mono">{m.intervalSeconds}s</td><td className="mono">{m.lastCheckedAt ? relative(m.lastCheckedAt) : 'Not checked'}</td><td><div style={{ display: 'flex', gap: 4 }}><button className="btn btn-small" title="Check now" disabled={check.isPending} onClick={() => check.mutate({ monitorId: m.id }, { onSuccess: refresh })} data-testid={`button-check-${m.id}`}><Activity size={12} /></button><button className="btn btn-small" title={m.isPaused ? 'Resume' : 'Pause'} onClick={() => (m.isPaused ? resume : pause).mutate({ monitorId: m.id }, { onSuccess: refresh })} data-testid={`button-toggle-${m.id}`}>{m.isPaused ? <Play size={12} /> : <Pause size={12} />}</button><button className="btn btn-small" title="Edit" onClick={() => setModal(m)} data-testid={`button-edit-${m.id}`}><Settings2 size={12} /></button><button className="btn btn-small btn-danger" title="Delete" onClick={() => { if (window.confirm(`Delete ${m.name} and its check history?`)) remove.mutate({ monitorId: m.id }, { onSuccess: refresh }); }} data-testid={`button-delete-${m.id}`}><Trash2 size={12} /></button></div></td></tr>)}</tbody></table></div>}
    </div>{modal && <MonitorModal initial={modal === true ? undefined : modal} onClose={() => setModal(false)} />}
  </Page>;
}

function MonitorDetailPage({ id }: { id: string }) {
  const query = useGetMonitor(id, { query: { enabled: !!id, queryKey: getGetMonitorQueryKey(id) } });
  const checksQuery = useListMonitorChecks({ monitorId: id, period: '24h', page: 1, pageSize: 50 }, { query: { enabled: !!id, queryKey: getListMonitorChecksQueryKey({ monitorId: id, period: '24h', page: 1, pageSize: 50 }) } });
  const [editing, setEditing] = useState(false);
  const check = useCheckMonitorNow();
  const client = useQueryClient();
  if (query.isLoading) return <Page title="Monitor details"><LoadingBox /></Page>;
  if (query.isError || !query.data) return <Page title="Monitor details"><ErrorBox retry={() => query.refetch()} /></Page>;
  const m = query.data;
  const checks = checksQuery.data?.items || [];
  return <Page title={m.name} eyebrow="Monitors / Service detail" actions={<div style={{ display: 'flex', gap: 8 }}><Link href="/monitors" className="btn"><ArrowLeft size={14} /> All monitors</Link><button className="btn btn-primary" disabled={check.isPending} onClick={() => check.mutate({ monitorId: id }, { onSuccess: () => { client.invalidateQueries({ queryKey: getListMonitorChecksQueryKey({ monitorId: id, period: '24h', page: 1, pageSize: 50 }) }); client.invalidateQueries({ queryKey: getGetMonitorQueryKey(id) }); } })}><Activity size={14} /> Check now</button><button className="btn" onClick={() => setEditing(true)}><Settings2 size={14} /> Edit</button></div>}>
    <div className="metric-grid"><div className="panel metric"><div className="eyebrow">Current state</div><div style={{ marginTop: 15 }}><StatusBadge status={m.status} /></div><div className="metric-meta" style={{ marginTop: 12 }}>{m.consecutiveFailures} consecutive failures</div></div><div className="panel metric"><div className="eyebrow">Uptime</div><div className="metric-value">{m.uptimePercent.toFixed(2)}%</div><div className="metric-meta">rolling performance</div></div><div className="panel metric"><div className="eyebrow">Response time</div><div className="metric-value">{m.lastLatencyMs == null ? '—' : `${m.lastLatencyMs}`}<span style={{ fontSize: 14 }}> ms</span></div><div className="metric-meta">latest successful check</div></div><div className="panel metric"><div className="eyebrow">Check interval</div><div className="metric-value">{m.intervalSeconds}<span style={{ fontSize: 14 }}> sec</span></div><div className="metric-meta">{m.method} · timeout {m.timeoutMs} ms</div></div></div>
    <div className="chart-grid"><div className="panel chart-panel"><div className="panel-title">Recent checks <span className="subtle" style={{ fontWeight: 400 }}>· last 24 hours</span></div>{checksQuery.isLoading ? <LoadingBox /> : checksQuery.isError ? <ErrorBox retry={() => checksQuery.refetch()} /> : checks.length ? <div className="chart-bars">{checks.slice().reverse().map((c, i) => <div key={c.id} className={`chart-bar ${c.state === 'down' ? 'fail' : ''}`} title={`${new Date(c.checkedAt).toLocaleString()} · ${c.httpStatus || c.errorCategory || 'No response'} · ${c.latencyMs ?? '—'} ms`} style={{ height: `${c.latencyMs ? Math.max(12, Math.min(92, c.latencyMs / 6)) : 22}%` }} />)}</div> : <div className="empty-state">No check results yet. Run a check to start your history.</div>}<div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10 }}><span className="mono subtle">OLDER</span><span className="mono subtle">LATEST</span></div></div><div className="panel" style={{ padding: 20 }}><div className="panel-title">Configuration</div><div className="subtle mono" style={{ overflowWrap: 'anywhere', marginTop: 12 }}>{m.url}</div><div className="service-row" style={{ paddingInline: 0 }}><span className="subtle">Expected codes</span><b className="mono">{m.expectedStatusCodes.join(', ')}</b></div><div className="service-row" style={{ paddingInline: 0 }}><span className="subtle">Failure threshold</span><b className="mono">{m.failureThreshold} checks</b></div><div className="service-row" style={{ paddingInline: 0 }}><span className="subtle">Public status</span><b>{m.isPublic ? 'Visible' : 'Hidden'}</b></div></div></div>
    <div className="panel" style={{ marginTop: 17 }}><div className="panel-head"><div><div className="panel-title">Check history</div><div className="subtle" style={{ marginTop: 3 }}>{checksQuery.data?.total || 0} checks · latest first</div></div><History size={16} color="#7e8b83" /></div>{checks.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Checked at</th><th>Result</th><th>HTTP status</th><th>Latency</th><th>Details</th></tr></thead><tbody>{checks.map(c => <tr key={c.id}><td className="mono">{new Date(c.checkedAt).toLocaleString()}</td><td><StatusBadge status={c.state} /></td><td className="mono">{c.httpStatus || '—'}</td><td className="mono">{c.latencyMs == null ? '—' : `${c.latencyMs} ms`}</td><td>{c.errorMessage || c.errorCategory || '—'}</td></tr>)}</tbody></table></div> : <div className="subtle" style={{ padding: 20 }}>No results have been recorded.</div>}</div>
    {editing && <MonitorModal initial={m} onClose={() => { setEditing(false); client.invalidateQueries({ queryKey: getGetMonitorQueryKey(id) }); }} />}
  </Page>;
}

function IncidentsPage() {
  const [state, setState] = useState('all');
  const query = useListIncidents({ state: state as 'all' | 'open' | 'acknowledged' | 'investigating' | 'resolved', page: 1, pageSize: 50 });
  return <Page title="Incident log" eyebrow="Command desk / Incident response" actions={<select className="select" aria-label="Filter incidents" value={state} onChange={e => setState(e.target.value)}><option value="all">All incidents</option><option value="open">Open</option><option value="acknowledged">Acknowledged</option><option value="investigating">Investigating</option><option value="resolved">Resolved</option></select>}>
    <div className="panel"><div className="panel-head"><div><div className="panel-title">Timeline of record</div><div className="subtle" style={{ marginTop: 3 }}>{query.data?.total ?? 0} incidents · audit trail retained</div></div><History size={16} color="#7e8b83" /></div>
      {query.isLoading ? <LoadingBox /> : query.isError || !query.data ? <ErrorBox retry={() => query.refetch()} /> : query.data.items.length ? <div className="event-list">{query.data.items.map(item => <Link href={`/incidents/${item.id}`} className="event-row" key={item.id} style={{ textDecoration: 'none' }}><span className="event-time">{new Date(item.detectedAt).toLocaleString()}</span><div><div className="event-name">{item.monitorName}</div><div className="event-desc">Detected {relative(item.detectedAt)}{item.durationSeconds ? ` · lasted ${duration(item.durationSeconds)}` : ''}</div></div><StatusBadge status={item.state} /></Link>)}</div> : <EmptyBox title="No incidents to report" detail="When a monitor crosses its failure threshold, the full story will appear here." />}
    </div>
  </Page>;
}

function IncidentDetailPage({ id }: { id: string }) {
  const query = useGetIncident(id, { query: { enabled: !!id, queryKey: getGetIncidentQueryKey(id) } });
  const ack = useAcknowledgeIncident();
  const investigate = useInvestigateIncident();
  const resolve = useResolveIncident();
  const client = useQueryClient();
  const [note, setNote] = useState('');
  const incident = query.data;
  const refresh = () => { client.invalidateQueries({ queryKey: getGetIncidentQueryKey(id) }); client.invalidateQueries({ queryKey: getListIncidentsQueryKey() }); client.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); };
  if (query.isLoading) return <Page title="Incident details"><LoadingBox /></Page>;
  if (query.isError || !incident) return <Page title="Incident details"><ErrorBox retry={() => query.refetch()} /></Page>;
  const running = ack.isPending || investigate.isPending || resolve.isPending;
  return <Page title={incident.monitorName} eyebrow="Incidents / Response record" actions={<Link href="/incidents" className="btn"><ArrowLeft size={14} /> Incident log</Link>}>
    <div className="panel" style={{ padding: 22, marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' }}><div><div className="eyebrow">Incident state</div><div style={{ marginTop: 10 }}><StatusBadge status={incident.state} /></div></div><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{incident.state === 'open' && <button className="btn" disabled={running} onClick={() => ack.mutate({ incidentId: id }, { onSuccess: refresh })}><Check size={14} /> Acknowledge</button>}{incident.state !== 'resolved' && incident.state !== 'investigating' && <button className="btn" disabled={running} onClick={() => { const message = window.prompt('Add a short investigation note (optional):') || ''; investigate.mutate({ incidentId: id, data: { message: message || 'Investigation started.' } }, { onSuccess: refresh }); }}><Search size={14} /> Investigate</button>}{incident.state !== 'resolved' && <button className="btn btn-primary" disabled={running} onClick={() => { const message = window.prompt('Resolution note (optional):') || ''; resolve.mutate({ incidentId: id, data: message ? { message } : undefined }, { onSuccess: refresh }); }}><CheckCircle2 size={14} /> Resolve incident</button>}</div></div>
    <div className="metric-grid"><div className="panel metric"><div className="eyebrow">Detected</div><div className="metric-value" style={{ fontSize: 19 }}>{new Date(incident.detectedAt).toLocaleDateString()}</div><div className="metric-meta">{new Date(incident.detectedAt).toLocaleTimeString()}</div></div><div className="panel metric"><div className="eyebrow">Acknowledged</div><div className="metric-value" style={{ fontSize: 19 }}>{incident.acknowledgedAt ? new Date(incident.acknowledgedAt).toLocaleTimeString() : '—'}</div><div className="metric-meta">{incident.acknowledgedAt ? relative(incident.acknowledgedAt) : 'Awaiting response'}</div></div><div className="panel metric"><div className="eyebrow">Duration</div><div className="metric-value" style={{ fontSize: 19 }}>{incident.durationSeconds ? duration(incident.durationSeconds) : 'Ongoing'}</div><div className="metric-meta">{incident.resolvedAt ? `Resolved ${relative(incident.resolvedAt)}` : 'Incident still active'}</div></div><div className="panel metric"><div className="eyebrow">Affected service</div><div className="metric-value" style={{ fontSize: 19, overflow: 'hidden', textOverflow: 'ellipsis' }}>{incident.monitorName}</div><Link href={`/monitors/${incident.monitorId}`} className="metric-meta">View monitor <ArrowRight size={11} /></Link></div></div>
    <div className="panel"><div className="panel-head"><div><div className="panel-title">Incident timeline</div><div className="subtle" style={{ marginTop: 3 }}>Every state change, in order</div></div><History size={16} color="#7e8b83" /></div>
      {incident.events.length ? <div className="timeline">{incident.events.map(event => <div className="timeline-item" key={event.id}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><b style={{ fontSize: 12, textTransform: 'capitalize' }}>{event.type}</b><span className="event-time">{new Date(event.createdAt).toLocaleString()}</span></div><p>{event.message}{event.actorLabel ? ` · ${event.actorLabel}` : ''}</p></div>)}</div> : <div className="empty-state">No timeline events yet.</div>}
    </div>
  </Page>;
}

function SettingsPage() {
  const query = useGetStatusPageSettings();
  const update = useUpdateStatusPageSettings();
  const client = useQueryClient();
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [initialized, setInitialized] = useState(false);
  useEffect(() => { if (query.data && !initialized) { setTitle(query.data.title); setSlug(query.data.slug); setInitialized(true); } }, [query.data, initialized]);
  const save = (e: FormEvent) => { e.preventDefault(); update.mutate({ data: { title, slug } }, { onSuccess: next => { client.invalidateQueries({ queryKey: getGetStatusPageSettingsQueryKey() }); client.invalidateQueries({ queryKey: getGetPublicStatusPageQueryKey(next.slug) }); } }); };
  if (query.isLoading) return <Page title="Status page settings"><LoadingBox /></Page>;
  if (query.isError || !query.data) return <Page title="Status page settings"><ErrorBox retry={() => query.refetch()} /></Page>;
  const publicUrl = `${window.location.origin}${basePath}/status/${slug}`;
  return <Page title="Status page" eyebrow="Workspace / Public presence">
    <div className="settings-layout">
      <form className="panel" style={{ padding: 22 }} onSubmit={save}><div className="eyebrow">Public status page</div><h2 className="display" style={{ fontSize: 22, margin: '8px 0 5px' }}>A clear update, on your terms.</h2><p className="subtle" style={{ lineHeight: 1.6, marginBottom: 22 }}>Only monitors marked public are shown. Internal checks, URLs, and operational notes stay private.</p><div className="field"><label htmlFor="status-title">PAGE TITLE</label><input id="status-title" className="input" maxLength={100} required value={title} onChange={e => setTitle(e.target.value)} data-testid="input-status-title" /></div><div className="field" style={{ marginTop: 16 }}><label htmlFor="status-slug">PUBLIC URL SLUG</label><div style={{ display: 'flex', alignItems: 'center', gap: 0 }}><span className="mono subtle" style={{ background: '#f0eee7', padding: '10px 9px', border: '1px solid #ddd9ce', borderRight: 0, borderRadius: '8px 0 0 8px', fontSize: 11 }}>/status/</span><input id="status-slug" className="input mono" required minLength={3} maxLength={48} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={slug} onChange={e => setSlug(e.target.value)} style={{ borderRadius: '0 8px 8px 0', flex: 1 }} data-testid="input-status-slug" /></div><span className="subtle" style={{ fontSize: 11 }}>Lowercase letters, numbers, and hyphens.</span></div><div className="modal-footer"><button className="btn btn-primary" disabled={update.isPending} data-testid="button-save-status-settings">{update.isPending ? 'Saving…' : 'Save settings'} <ArrowRight size={14} /></button></div>{update.isError && <p style={{ color: '#aa4d40', fontSize: 12 }}>Settings could not be saved. Please retry.</p>}</form>
      <div><div className="panel" style={{ padding: 22 }}><div style={{ width: 38, height: 38, display: 'grid', placeItems: 'center', borderRadius: 10, color: '#34755f', background: '#e4efe5', marginBottom: 17 }}><Globe2 size={19} /></div><div className="eyebrow">Live preview link</div><h3 className="display" style={{ fontSize: 18, margin: '8px 0 6px' }}>{query.data.title}</h3><p className="mono subtle" style={{ overflowWrap: 'anywhere' }}>{publicUrl}</p><div style={{ display: 'flex', gap: 8, marginTop: 18 }}><Link href={`/status/${slug}`} className="btn btn-primary"><ExternalLink size={13} /> Preview page</Link><button className="btn" onClick={() => navigator.clipboard?.writeText(publicUrl)}><Link2 size={13} /> Copy link</button></div></div><div className="panel" style={{ padding: 20, marginTop: 14 }}><div className="eyebrow">On the public page</div><div className="service-row" style={{ paddingInline: 0 }}><span>Public services</span><b className="mono">{query.data.publicMonitorCount}</b></div><div className="service-row" style={{ paddingInline: 0 }}><span>Internal details</span><b style={{ color: '#34755f' }}>Always private</b></div></div></div>
    </div>
  </Page>;
}

function OnboardingPage() {
  const [saved, setSaved] = useState(false);
  const [, setLocation] = useLocation();
  return <Page title={saved ? 'You’re on watch.' : 'Set up your first monitor'} eyebrow="First run / One good signal">
    <div className="panel" style={{ maxWidth: 740, padding: 26 }}><div className="empty-mark" style={{ marginLeft: 0, marginBottom: 17 }}><Sparkles size={18} /></div>{saved ? <><h2 className="display">Your command desk is ready.</h2><p className="subtle">The first monitor is in place. Take a look at the live workspace.</p><button className="btn btn-primary" onClick={() => setLocation('/dashboard')}>Go to dashboard <ArrowRight size={14} /></button></> : <><h2 className="display" style={{ fontSize: 23, margin: '0 0 5px' }}>Start with the service you care about most.</h2><p className="subtle" style={{ marginBottom: 20 }}>One endpoint is enough to make the desk useful. You can fine-tune everything later.</p><MonitorModal onClose={() => setLocation('/dashboard')} onCreated={() => setSaved(true)} /></>}</div>
  </Page>;
}

function PublicStatusPage({ slug }: { slug: string }) {
  const query = useGetPublicStatusPage(slug, { query: { enabled: !!slug, queryKey: getGetPublicStatusPageQueryKey(slug) } });
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey() } });
  if (query.isLoading) return <div className="public-status"><LoadingBox /></div>;
  if (query.isError || !query.data) return <div className="public-status"><ErrorBox retry={() => query.refetch()} /></div>;
  const data = query.data;
  const isHealthy = data.overallStatus === 'operational';
  return <main className="landing" style={{ minHeight: '100dvh' }}><div className="public-status">
    <div className="public-header"><Link href="/" className="brand" style={{ color: '#203138', padding: 0 }}><span className="brand-mark"><Activity size={16} /></span><span>pulsewatch</span></Link><span className="mono subtle">PUBLIC STATUS</span></div>
    <div className="eyebrow">Service health / {data.slug}</div><h1 style={{ marginTop: 9 }}>{data.title}</h1>
    <div className={`public-banner ${isHealthy ? '' : 'down'}`}><span className="status-dot" style={{ width: 11, height: 11 }} /><div><b style={{ fontSize: 15 }}>{overallLabel(data.overallStatus)}</b><div style={{ fontSize: 11, opacity: .8, marginTop: 3 }}>Last updated {relative(data.updatedAt)}</div></div><span className="mono" style={{ marginLeft: 'auto', fontSize: 12 }}>{data.uptimePercent.toFixed(2)}% uptime</span></div>
    <div className="panel"><div className="panel-head"><div><div className="panel-title">Services</div><div className="subtle" style={{ marginTop: 3 }}>Current status and recent history</div></div><ShieldCheck size={17} color="#478569" /></div>{data.services.length ? data.services.map(service => <div className="service-row" key={service.name}><div style={{ flex: 1 }}><b style={{ fontSize: 13 }}>{service.name}</b><div className="history-pips" aria-label="Recent daily service history">{service.history.slice(-30).map((point, i) => <i key={`${point.date}-${i}`} className={point.status === 'outage' ? 'outage' : point.status === 'unknown' ? 'unknown' : ''} title={`${point.date}: ${point.status}`} />)}</div></div><div style={{ textAlign: 'right', paddingLeft: 18 }}><StatusBadge status={service.status} /><div className="mono subtle" style={{ marginTop: 8 }}>{service.uptimePercent.toFixed(2)}%</div></div></div>) : <div className="empty-state">No public services are currently configured.</div>}</div>
    <div className="panel" style={{ marginTop: 16 }}><div className="panel-head"><div><div className="panel-title">Incident updates</div><div className="subtle" style={{ marginTop: 3 }}>Public-safe service notices</div></div><Bell size={16} color="#78867e" /></div>{data.incidents.length ? data.incidents.map((incident, i) => <div className="event-row" key={`${incident.startedAt}-${i}`}><span className="event-time">{new Date(incident.startedAt).toLocaleDateString()}</span><div><div className="event-name">{incident.title}</div><div className="event-desc">{incident.resolvedAt ? `Resolved ${relative(incident.resolvedAt)}` : `Started ${relative(incident.startedAt)}`}</div></div><StatusBadge status={incident.status} /></div>) : <div className="subtle" style={{ padding: 22, textAlign: 'center' }}>No recent incident updates.</div>}</div>
    <footer className="landing-footer" style={{ paddingInline: 0 }}><span>Updates are sanitized for public visibility.</span><span className="mono">STATUS ENGINE {health.data?.status || 'ONLINE'}</span></footer>
  </div></main>;
}

function RoutedPages() {
  return <Switch>
    <Route path="/"><Landing /></Route>
    <Route path="/sign-in/*?"><AuthPage kind="in" /></Route>
    <Route path="/sign-up/*?"><AuthPage kind="up" /></Route>
    <Route path="/status/:slug">{params => <PublicStatusPage slug={params.slug} />}</Route>
    <Route path="/dashboard">{() => <Private><DashboardPage /></Private>}</Route>
    <Route path="/onboarding">{() => <Private><OnboardingPage /></Private>}</Route>
    <Route path="/monitors">{() => <Private><MonitorsPage /></Private>}</Route>
    <Route path="/monitors/:monitorId">{params => <Private><MonitorDetailPage id={params.monitorId} /></Private>}</Route>
    <Route path="/incidents">{() => <Private><IncidentsPage /></Private>}</Route>
    <Route path="/incidents/:incidentId">{params => <Private><IncidentDetailPage id={params.incidentId} /></Private>}</Route>
    <Route path="/settings">{() => <Private><SettingsPage /></Private>}</Route>
    <Route component={NotFound} />
  </Switch>;
}
function ClerkRoot() {
  const [location, setLocation] = useLocation();
  if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={appearance}
    signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}
    localization={{ signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to your PulseWatch workspace' } }, signUp: { start: { title: 'Create your workspace', subtitle: 'A calmer on-call starts here' } } }}
    routerPush={to => setLocation(stripBase(to))} routerReplace={to => setLocation(stripBase(to), { replace: true })}>
    <ErrorBoundary resetKey={location}><ClerkCacheReset /><RoutedPages /></ErrorBoundary>
  </ClerkProvider>;
}
function App() {
  return <QueryClientProvider client={queryClient}><WouterRouter base={basePath}><ClerkRoot /></WouterRouter></QueryClientProvider>;
}
function relative(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
function duration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}
function overallLabel(status: string) {
  return ({ operational: 'All systems operational', partial_outage: 'Partial service disruption', major_outage: 'Major service disruption', no_services: 'No services configured' } as Record<string, string>)[status] || status;
}
export default App;
