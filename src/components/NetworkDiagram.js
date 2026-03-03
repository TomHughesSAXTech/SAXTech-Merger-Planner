import React, { useMemo, useCallback } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap
} from 'react-flow-renderer';
import dagre from 'dagre';

/* ──────────────────────────────────────────────────
   SVG icon helpers – inline so we don't need extra deps
   ────────────────────────────────────────────────── */
const icon = (paths, color = '#fff') =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24">${paths}</svg>`
  )}`;

const ICONS = {
  internet:  icon('<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20"/>'),
  firewall:  icon('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18M3 12h18"/>'),
  switch_:   icon('<rect x="2" y="7" width="20" height="10" rx="2"/><circle cx="6" cy="12" r="1" fill="#fff"/><circle cx="10" cy="12" r="1" fill="#fff"/><circle cx="14" cy="12" r="1" fill="#fff"/><circle cx="18" cy="12" r="1" fill="#fff"/>'),
  server:    icon('<rect x="4" y="2" width="16" height="6" rx="1"/><rect x="4" y="10" width="16" height="6" rx="1"/><rect x="4" y="18" width="16" height="4" rx="1"/><circle cx="7" cy="5" r="0.5" fill="#fff"/><circle cx="7" cy="13" r="0.5" fill="#fff"/>'),
  cloud:     icon('<path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/>'),
  laptop:    icon('<rect x="2" y="4" width="20" height="12" rx="2"/><path d="M1 18h22"/>'),
  phone:     icon('<rect x="5" y="2" width="14" height="20" rx="2"/><circle cx="12" cy="18" r="1" fill="#fff"/>'),
  lock:      icon('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>'),
  app:       icon('<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12h8M12 8v8"/>'),
  vpn:       icon('<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>'),
  user:      icon('<circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 00-16 0"/>'),
  printer:   icon('<rect x="5" y="14" width="14" height="6" rx="1"/><path d="M5 14V4h14v10"/><rect x="8" y="17" width="8" height="2" fill="#fff"/>'),
  wifi:      icon('<path d="M5 12.55a11 11 0 0114 0"/><path d="M8.53 16.11a6 6 0 016.95 0"/><circle cx="12" cy="20" r="1" fill="#fff"/>'),
  backup:    icon('<path d="M21 12a9 9 0 11-6.2-8.6"/><path d="M21 3v5h-5"/>'),
  vendor:    icon('<path d="M20 21V5a2 2 0 00-2-2H6a2 2 0 00-2 2v16"/><path d="M1 21h22"/><path d="M9 7h6M9 11h6M9 15h6"/>'),
  site:      icon('<path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/>'),
  database:  icon('<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 5v6c0 1.66-4 3-9 3s-9-1.34-9-3V5"/><path d="M21 11v6c0 1.66-4 3-9 3s-9-1.34-9-3v-6"/>'),
};

/* ──────────────────────────────────────────────────
   Colour palette by category type
   ────────────────────────────────────────────────── */
const COLORS = {
  internet:  { bg: '#1a1a2e', border: '#374151' },
  network:   { bg: '#0078D4', border: '#005A9E' },
  server:    { bg: '#2563EB', border: '#1D4ED8' },
  cloud:     { bg: '#059669', border: '#047857' },
  saas:      { bg: '#7C3AED', border: '#6D28D9' },
  user:      { bg: '#0891B2', border: '#0E7490' },
  security:  { bg: '#DC2626', border: '#B91C1C' },
  telephony: { bg: '#EA580C', border: '#C2410C' },
  backup:    { bg: '#4338CA', border: '#3730A3' },
  vendor:    { bg: '#78716C', border: '#57534E' },
  app:       { bg: '#7C3AED', border: '#6D28D9' },
  general:   { bg: '#0F766E', border: '#115E59' },
  rmm:       { bg: '#B45309', border: '#92400E' },
  device:    { bg: '#64748B', border: '#475569' },
};

/* ──────────────────────────────────────────────────
   Custom node renderer
   ────────────────────────────────────────────────── */
const DiagramNode = ({ data }) => {
  const colorSet = COLORS[data.colorKey] || COLORS.general;
  return (
    <div
      style={{
        background: colorSet.bg,
        border: `2px solid ${colorSet.border}`,
        borderRadius: 10,
        padding: '8px 14px',
        color: '#fff',
        minWidth: 150,
        maxWidth: 240,
        fontSize: '0.78rem',
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        cursor: 'default',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        {data.icon && (
          <img
            src={data.icon}
            alt=""
            style={{ width: 22, height: 22, flexShrink: 0 }}
          />
        )}
        <strong style={{ fontSize: '0.85rem' }}>{data.label}</strong>
      </div>
      {data.details && (
        <div style={{ opacity: 0.85, fontSize: '0.72rem', lineHeight: '1.3', whiteSpace: 'pre-line' }}>
          {data.details}
        </div>
      )}
      {data.badge && (
        <span
          style={{
            display: 'inline-block',
            marginTop: 4,
            background: 'rgba(255,255,255,0.2)',
            borderRadius: 6,
            padding: '1px 8px',
            fontSize: '0.68rem',
          }}
        >
          {data.badge}
        </span>
      )}
    </div>
  );
};

const nodeTypes = { diagram: DiagramNode };

/* ──────────────────────────────────────────────────
   Layout helper (dagre)
   ────────────────────────────────────────────────── */
const layoutElements = (nodes, edges) => {
  if (nodes.length === 0) return { nodes: [], edges: [] };
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', ranksep: 100, nodesep: 50 });
  nodes.forEach(n => g.setNode(n.id, { width: 200, height: 90 }));
  edges.forEach(e => g.setEdge(e.source, e.target));
  dagre.layout(g);
  const laid = nodes.map(n => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - 100, y: pos.y - 45 } };
  });
  return { nodes: laid, edges };
};

/* ──────────────────────────────────────────────────
   Helpers to safely extract text from discovery values
   ────────────────────────────────────────────────── */
const stringify = (v) => {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    return v.map(item => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') return item.name || item.label || JSON.stringify(item);
      return String(item);
    }).join(', ');
  }
  if (typeof v === 'object') {
    if (v.name) return v.role ? `${v.name} (${v.role})` : v.name;
    return Object.entries(v).map(([k, val]) => `${k}: ${stringify(val)}`).join('\n');
  }
  return String(v);
};

/* ──────────────────────────────────────────────────
   Build the full network graph from discovery data
   ────────────────────────────────────────────────── */
const buildNetworkGraph = (discoveryData) => {
  const nodes = [];
  const edges = [];
  let nodeId = 0;
  const nid = (prefix) => `${prefix}-${nodeId++}`;

  const general    = discoveryData.general || {};
  const server     = discoveryData.server || {};
  const workstation= discoveryData.workstation || {};
  const security   = discoveryData.security || {};
  const backup     = discoveryData.backup || {};
  const rmm        = discoveryData.rmm || {};
  const apps       = discoveryData.applications || {};
  const telephony  = discoveryData.telephony || {};
  const vendor     = discoveryData.vendor || {};
  const network    = discoveryData.network || {};

  // Check if we have any data at all
  const hasData = Object.values(discoveryData).some(
    cat => cat && typeof cat === 'object' && Object.keys(cat).length > 0
  );

  if (!hasData) {
    nodes.push({
      id: 'empty', type: 'diagram', position: { x: 200, y: 200 },
      data: { label: 'Awaiting Discovery Data', icon: ICONS.internet, colorKey: 'general',
              details: 'Answer questions in the chat to\nbuild the network diagram.' }
    });
    return { nodes, edges: [] };
  }

  // ─── INTERNET NODE ───
  const internetId = nid('internet');
  nodes.push({
    id: internetId, type: 'diagram', position: { x: 0, y: 0 },
    data: { label: 'Internet / WAN', icon: ICONS.internet, colorKey: 'internet',
            details: [network.isp_primary, network.isp_secondary].filter(Boolean).join('\n') || undefined,
            badge: network.isp_primary ? 'ISP' : undefined }
  });

  // ─── FIREWALL ───
  const fwBrand = network.firewall_brand || network.firewall_type;
  const fwModel = network.firewall_model;
  let firewallId = null;
  if (fwBrand || Object.keys(network).length > 0) {
    firewallId = nid('fw');
    nodes.push({
      id: firewallId, type: 'diagram', position: { x: 0, y: 0 },
      data: { label: fwBrand ? `${fwBrand} Firewall` : 'Firewall', icon: ICONS.firewall, colorKey: 'security',
              details: fwModel || undefined, badge: 'Security Edge' }
    });
    edges.push({ id: `e-inet-fw`, source: internetId, target: firewallId, animated: true,
                 style: { stroke: '#DC2626', strokeWidth: 2 } });
  }

  // ─── VPN ───
  const vpnBrand = network.vpn_brand || network.vpn_type;
  if (vpnBrand) {
    const vpnId = nid('vpn');
    nodes.push({
      id: vpnId, type: 'diagram', position: { x: 0, y: 0 },
      data: { label: `VPN: ${vpnBrand}`, icon: ICONS.vpn, colorKey: 'security',
              details: network.vpn_type !== vpnBrand ? network.vpn_type : undefined, badge: 'Remote Access' }
    });
    edges.push({ id: `e-fw-vpn-${vpnId}`, source: firewallId || internetId, target: vpnId,
                 animated: true, style: { stroke: '#7C3AED', strokeDasharray: '5 3' } });
  }

  // ─── SWITCHES ───
  const switchParent = firewallId || internetId;
  const switchCount = network.switch_count || 0;
  const switchBrands = network.switch_brands;
  let primarySwitchId = null;
  if (switchCount || switchBrands || network.switches) {
    primarySwitchId = nid('sw');
    const details = [];
    if (switchBrands) details.push(stringify(switchBrands));
    if (switchCount) details.push(`${switchCount} switches`);
    nodes.push({
      id: primarySwitchId, type: 'diagram', position: { x: 0, y: 0 },
      data: { label: 'Core Switching', icon: ICONS.switch_, colorKey: 'network',
              details: details.join('\n') || undefined }
    });
    edges.push({ id: `e-fw-sw`, source: switchParent, target: primarySwitchId,
                 style: { stroke: '#0078D4', strokeWidth: 2 } });
  }

  // ─── WIFI ───
  const wifiSystem = network.wifi_system;
  const wifiAps = network.wifi_ap_count;
  if (wifiSystem || wifiAps) {
    const wifiId = nid('wifi');
    nodes.push({
      id: wifiId, type: 'diagram', position: { x: 0, y: 0 },
      data: { label: wifiSystem ? `WiFi: ${wifiSystem}` : 'WiFi', icon: ICONS.wifi, colorKey: 'network',
              details: wifiAps ? `${wifiAps} APs` : undefined }
    });
    edges.push({ id: `e-sw-wifi-${wifiId}`, source: primarySwitchId || switchParent, target: wifiId });
  }

  const lanParent = primarySwitchId || switchParent;

  // ─── SERVERS ───
  const serverList = Array.isArray(server.servers) ? server.servers : [];
  const serverCount = server.server_count || server.total || serverList.length;
  if (serverCount || serverList.length || Object.keys(server).length > 1) {
    if (serverList.length > 0) {
      serverList.forEach((s, i) => {
        const sId = nid('srv');
        const sName = typeof s === 'string' ? s : (s.name || `Server ${i + 1}`);
        const sDetails = [];
        if (typeof s === 'object') {
          if (s.role) sDetails.push(s.role);
          if (s.os) sDetails.push(s.os);
          if (s.location) sDetails.push(s.location);
        }
        const isCloud = typeof s === 'object' && s.type === 'cloud';
        nodes.push({
          id: sId, type: 'diagram', position: { x: 0, y: 0 },
          data: { label: sName, icon: ICONS.server, colorKey: isCloud ? 'cloud' : 'server',
                  details: sDetails.join(' | ') || undefined,
                  badge: isCloud ? 'Cloud' : 'On-Prem' }
        });
        edges.push({ id: `e-lan-srv-${sId}`, source: lanParent, target: sId });
      });
    } else {
      const sId = nid('srv');
      const details = [];
      if (serverCount) details.push(`${serverCount} servers`);
      if (server.cloud_provider) details.push(`Cloud: ${server.cloud_provider}`);
      if (server.virtualization_platform) details.push(`Virt: ${server.virtualization_platform}`);
      nodes.push({
        id: sId, type: 'diagram', position: { x: 0, y: 0 },
        data: { label: 'Servers', icon: ICONS.server, colorKey: 'server',
                details: details.join('\n') || `${serverCount || '?'} servers` }
      });
      edges.push({ id: `e-lan-srv-${sId}`, source: lanParent, target: sId });
    }
  }

  // ─── CLOUD SERVICES ───
  if (server.cloud_provider) {
    const cloudId = nid('cloud');
    nodes.push({
      id: cloudId, type: 'diagram', position: { x: 0, y: 0 },
      data: { label: `Cloud: ${server.cloud_provider}`, icon: ICONS.cloud, colorKey: 'cloud' }
    });
    edges.push({ id: `e-inet-cloud-${cloudId}`, source: internetId, target: cloudId,
                 style: { strokeDasharray: '8 4', stroke: '#059669' } });
  }

  // ─── WORKSTATIONS ───
  const wsCount = workstation.workstation_count || workstation.total;
  if (wsCount || Object.keys(workstation).length > 0) {
    const wsId = nid('ws');
    const details = [];
    if (wsCount) details.push(`${wsCount} workstations`);
    if (workstation.workstation_types) details.push(stringify(workstation.workstation_types));
    if (workstation.domain_join_type) details.push(`Domain: ${workstation.domain_join_type}`);
    nodes.push({
      id: wsId, type: 'diagram', position: { x: 0, y: 0 },
      data: { label: 'Workstations', icon: ICONS.laptop, colorKey: 'user',
              details: details.join('\n') || undefined }
    });
    edges.push({ id: `e-lan-ws-${wsId}`, source: lanParent, target: wsId });
  }

  // ─── USERS (from general) ───
  const totalUsers = general.total_users;
  if (totalUsers) {
    const userId = nid('users');
    nodes.push({
      id: userId, type: 'diagram', position: { x: 0, y: 0 },
      data: { label: `${totalUsers} Users`, icon: ICONS.user, colorKey: 'user',
              details: general.company_name || undefined }
    });
    edges.push({ id: `e-lan-users-${userId}`, source: lanParent, target: userId });
  }

  // ─── SECURITY ───
  if (Object.keys(security).length > 0) {
    const secId = nid('sec');
    const details = [];
    if (security.edr_vendor) details.push(`EDR: ${security.edr_vendor}`);
    if (security.email_filter) details.push(`Email: ${security.email_filter}`);
    if (security.mfa_enabled) details.push(`MFA: ${stringify(security.mfa_enabled)}`);
    if (security.dns_filtering) details.push(`DNS: ${security.dns_filtering}`);
    if (security.compliance_requirements) details.push(`Compliance: ${stringify(security.compliance_requirements)}`);
    nodes.push({
      id: secId, type: 'diagram', position: { x: 0, y: 0 },
      data: { label: 'Security Stack', icon: ICONS.lock, colorKey: 'security',
              details: details.join('\n') || undefined }
    });
    edges.push({ id: `e-fw-sec-${secId}`, source: firewallId || internetId, target: secId });
  }

  // ─── BACKUP ───
  if (Object.keys(backup).length > 0) {
    const bkId = nid('bk');
    const details = [];
    if (backup.backup_platform) details.push(backup.backup_platform);
    if (backup.backup_frequency) details.push(`Freq: ${backup.backup_frequency}`);
    if (backup.total_backup_volume) details.push(`Volume: ${backup.total_backup_volume}`);
    if (backup.backup_retention) details.push(`Retention: ${backup.backup_retention}`);
    nodes.push({
      id: bkId, type: 'diagram', position: { x: 0, y: 0 },
      data: { label: 'Backup', icon: ICONS.backup, colorKey: 'backup',
              details: details.join('\n') || undefined }
    });
    edges.push({ id: `e-lan-bk-${bkId}`, source: lanParent, target: bkId });
  }

  // ─── APPLICATIONS (SaaS) ───
  const appList = Array.isArray(apps.applications) ? apps.applications : [];
  const hasAppInfo = appList.length > 0 || apps.document_storage || apps.tax_platform || apps.accounting_platform || apps.time_billing;
  if (hasAppInfo) {
    const appNodeId = nid('apps');
    const details = [];
    if (apps.document_storage) details.push(`Docs: ${apps.document_storage}`);
    if (apps.tax_platform) details.push(`Tax: ${apps.tax_platform}`);
    if (apps.accounting_platform) details.push(`Acct: ${apps.accounting_platform}`);
    if (apps.time_billing) details.push(`T&B: ${apps.time_billing}`);
    if (appList.length > 0) {
      details.push(`+ ${appList.length} apps`);
    }
    nodes.push({
      id: appNodeId, type: 'diagram', position: { x: 0, y: 0 },
      data: { label: 'SaaS / Applications', icon: ICONS.app, colorKey: 'saas',
              details: details.join('\n') || undefined, badge: 'Cloud Apps' }
    });
    edges.push({ id: `e-inet-apps-${appNodeId}`, source: internetId, target: appNodeId,
                 style: { strokeDasharray: '8 4', stroke: '#7C3AED' } });
  }

  // ─── TELEPHONY ───
  if (Object.keys(telephony).length > 0) {
    const phId = nid('phone');
    const details = [];
    if (telephony.phone_provider) details.push(telephony.phone_provider);
    if (telephony.phone_system_type) details.push(telephony.phone_system_type);
    if (telephony.phone_numbers_to_port) details.push(`Port: ${telephony.phone_numbers_to_port} numbers`);
    nodes.push({
      id: phId, type: 'diagram', position: { x: 0, y: 0 },
      data: { label: 'Telephony', icon: ICONS.phone, colorKey: 'telephony',
              details: details.join('\n') || undefined }
    });
    edges.push({ id: `e-lan-phone-${phId}`, source: lanParent, target: phId });
  }

  // ─── RMM / MONITORING ───
  if (Object.keys(rmm).length > 0) {
    const rmmId = nid('rmm');
    const details = [];
    if (rmm.rmm_vendor) details.push(`RMM: ${rmm.rmm_vendor}`);
    if (rmm.ticketing_system) details.push(`Tickets: ${rmm.ticketing_system}`);
    if (rmm.patching_method) details.push(`Patching: ${rmm.patching_method}`);
    nodes.push({
      id: rmmId, type: 'diagram', position: { x: 0, y: 0 },
      data: { label: 'RMM / Monitoring', icon: ICONS.vendor, colorKey: 'rmm',
              details: details.join('\n') || undefined }
    });
    edges.push({ id: `e-lan-rmm-${rmmId}`, source: lanParent, target: rmmId });
  }

  // ─── VENDORS / MSPs ───
  const mspList = Array.isArray(vendor.msps) ? vendor.msps : [];
  if (mspList.length > 0 || Object.keys(vendor).length > 0) {
    const vendorId = nid('vendor');
    const details = mspList.map(m => typeof m === 'string' ? m : (m.name || 'MSP')).join(', ');
    nodes.push({
      id: vendorId, type: 'diagram', position: { x: 0, y: 0 },
      data: { label: 'Vendors / MSPs', icon: ICONS.vendor, colorKey: 'vendor',
              details: details || stringify(vendor.vendor_partnerships) || undefined }
    });
    edges.push({ id: `e-inet-vendor-${vendorId}`, source: internetId, target: vendorId,
                 style: { strokeDasharray: '4 4', stroke: '#78716C' } });
  }

  // ─── PRINTERS / CAMERAS / IOT ───
  const printerCount = network.printer_count;
  const cameraCount = network.camera_count;
  if (printerCount || cameraCount) {
    const iotId = nid('iot');
    const details = [];
    if (printerCount) details.push(`${printerCount} printers`);
    if (cameraCount) details.push(`${cameraCount} cameras`);
    nodes.push({
      id: iotId, type: 'diagram', position: { x: 0, y: 0 },
      data: { label: 'Printers / Cameras', icon: ICONS.printer, colorKey: 'device',
              details: details.join('\n') || undefined }
    });
    edges.push({ id: `e-lan-iot-${iotId}`, source: lanParent, target: iotId });
  }

  // ─── DNS / DOMAIN ───
  const dnsHost = network.dns_host;
  const registrar = network.domain_registrar;
  if (dnsHost || registrar) {
    const dnsId = nid('dns');
    const details = [];
    if (dnsHost) details.push(`DNS: ${dnsHost}`);
    if (registrar) details.push(`Registrar: ${registrar}`);
    nodes.push({
      id: dnsId, type: 'diagram', position: { x: 0, y: 0 },
      data: { label: 'DNS / Domains', icon: ICONS.internet, colorKey: 'network',
              details: details.join('\n') }
    });
    edges.push({ id: `e-inet-dns-${dnsId}`, source: internetId, target: dnsId });
  }

  // ─── SITES (multi-location) ───
  const siteList = Array.isArray(network.sites) ? network.sites : [];
  siteList.forEach((s, i) => {
    const siteId = nid('site');
    const sName = typeof s === 'string' ? s : (s.name || `Site ${i + 1}`);
    const sType = typeof s === 'object' ? s.type : undefined;
    nodes.push({
      id: siteId, type: 'diagram', position: { x: 0, y: 0 },
      data: { label: sName, icon: ICONS.site, colorKey: 'general',
              details: sType || undefined, badge: 'Location' }
    });
    edges.push({ id: `e-fw-site-${siteId}`, source: firewallId || internetId, target: siteId,
                 style: { strokeDasharray: '6 3' } });
  });

  return layoutElements(nodes, edges);
};

/* ──────────────────────────────────────────────────
   Main component
   ────────────────────────────────────────────────── */
const NetworkDiagram = ({ discoveryData }) => {
  const { nodes, edges } = useMemo(
    () => buildNetworkGraph(discoveryData || {}),
    [discoveryData]
  );

  const onNodeClick = useCallback(() => {}, []);

  return (
    <div className="tree-container" style={{ background: '#0f172a' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        attributionPosition="bottom-left"
        minZoom={0.3}
        maxZoom={2}
      >
        <Background color="#334155" gap={24} size={1} />
        <Controls
          style={{
            background: '#1e293b',
            borderRadius: 8,
            border: '1px solid #334155',
          }}
        />
        <MiniMap
          nodeColor={(node) => {
            const ck = node.data?.colorKey;
            return COLORS[ck]?.bg || '#475569';
          }}
          style={{ background: '#1e293b', borderRadius: 8 }}
          maskColor="rgba(15,23,42,0.7)"
        />
      </ReactFlow>
    </div>
  );
};

export default NetworkDiagram;
