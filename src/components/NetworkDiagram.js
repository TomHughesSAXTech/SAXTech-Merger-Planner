import React, { useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap
} from 'react-flow-renderer';
import dagre from 'dagre';

const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const nodeWidth = 180;
const nodeHeight = 60;

const layoutElements = (nodes, edges, direction = 'LR') => {
  dagreGraph.setGraph({ rankdir: direction, ranksep: 120, nodesep: 60 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  nodes.forEach((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    node.position = {
      x: nodeWithPosition.x - nodeWidth / 2,
      y: nodeWithPosition.y - nodeHeight / 2,
    };
  });

  return { nodes, edges };
};

const buildNetworkGraph = (discoveryData) => {
  const nodes = [];
  const edges = [];

  const network = discoveryData.network || {};
  const server = discoveryData.server || {};
  const workstation = discoveryData.workstation || {};

  // Sites
  const sites = Array.isArray(network.sites)
    ? network.sites
    : (network.sites && typeof network.sites === 'object')
      ? Object.values(network.sites)
      : [];

  sites.forEach((site, index) => {
    const id = `site-${index}`;
    nodes.push({
      id,
      type: 'default',
      data: { label: typeof site === 'string' ? site : site.name || `Site ${index + 1}` },
      position: { x: 0, y: 0 },
    });
  });

  // Firewalls
  const firewalls = Array.isArray(network.firewalls)
    ? network.firewalls
    : (network.firewalls && typeof network.firewalls === 'object')
      ? Object.values(network.firewalls)
      : [];

  firewalls.forEach((fw, index) => {
    const id = `fw-${index}`;
    nodes.push({
      id,
      type: 'default',
      data: { label: typeof fw === 'string' ? fw : fw.name || `Firewall ${index + 1}` },
      position: { x: 0, y: 0 },
    });

    if (sites[index % Math.max(sites.length, 1)]) {
      edges.push({
        id: `edge-site-fw-${index}`,
        source: `site-${index % Math.max(sites.length, 1)}`,
        target: id,
        animated: true,
      });
    }
  });

  // Switches / routers
  const switches = Array.isArray(network.switches) ? network.switches : [];
  const routers = Array.isArray(network.routers) ? network.routers : [];

  switches.forEach((sw, index) => {
    const id = `sw-${index}`;
    nodes.push({
      id,
      type: 'default',
      data: { label: typeof sw === 'string' ? sw : sw.name || `Switch ${index + 1}` },
      position: { x: 0, y: 0 },
    });

    if (firewalls[index % Math.max(firewalls.length, 1)]) {
      edges.push({
        id: `edge-fw-sw-${index}`,
        source: `fw-${index % Math.max(firewalls.length, 1)}`,
        target: id,
      });
    }
  });

  routers.forEach((rt, index) => {
    const id = `rt-${index}`;
    nodes.push({
      id,
      type: 'default',
      data: { label: typeof rt === 'string' ? rt : rt.name || `Router ${index + 1}` },
      position: { x: 0, y: 0 },
    });

    if (firewalls[index % Math.max(firewalls.length, 1)]) {
      edges.push({
        id: `edge-fw-rt-${index}`,
        source: `fw-${index % Math.max(firewalls.length, 1)}`,
        target: id,
      });
    }
  });

  // Servers summary node
  const serverCount = server.server_count || server.server_total || server.total || 0;
  if (serverCount || Object.keys(server).length) {
    nodes.push({
      id: 'servers-summary',
      type: 'default',
      data: { label: `Servers: ${serverCount || 'see details'}` },
      position: { x: 0, y: 0 },
    });

    if (switches.length > 0) {
      edges.push({ id: 'edge-sw-servers', source: 'sw-0', target: 'servers-summary' });
    }
  }

  // Workstations / printers summary nodes
  const workstationCount = workstation.workstation_count || workstation.total || 0;
  if (workstationCount || Object.keys(workstation).length) {
    nodes.push({
      id: 'workstations-summary',
      type: 'default',
      data: { label: `Workstations: ${workstationCount || 'see details'}` },
      position: { x: 0, y: 0 },
    });

    if (switches.length > 0) {
      edges.push({ id: 'edge-sw-workstations', source: 'sw-0', target: 'workstations-summary' });
    }
  }

  return layoutElements(nodes, edges);
};

const NetworkDiagram = ({ discoveryData }) => {
  const { nodes, edges } = useMemo(
    () => buildNetworkGraph(discoveryData || {}),
    [discoveryData]
  );

  return (
    <div className="tree-container">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        attributionPosition="bottom-left"
      >
        <Background color="#aaa" gap={16} />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
};

export default NetworkDiagram;
