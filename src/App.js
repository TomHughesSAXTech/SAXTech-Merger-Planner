import React, { useState, useCallback, useEffect } from 'react';
import ReactFlow, {
  Node,
  Edge,
  addEdge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Position
} from 'react-flow-renderer';
import dagre from 'dagre';
import { MessageSquare, GitBranch, Download, Play } from 'lucide-react';
import ChatInterface from './components/ChatInterface';
import DiscoveryPanel from './components/DiscoveryPanel';
import NetworkDiagram from './components/NetworkDiagram';
import FileUploadPanel from './components/FileUploadPanel';
import AdminPanel from './components/AdminPanel';
import './App.css';
const API_BASE = '/api';

const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const nodeWidth = 200;
const nodeHeight = 80;

const getLayoutedElements = (nodes, edges, direction = 'TB') => {
  dagreGraph.setGraph({ rankdir: direction });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  nodes.forEach((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    node.targetPosition = Position.Top;
    node.sourcePosition = Position.Bottom;
    
    node.position = {
      x: nodeWithPosition.x - nodeWidth / 2,
      y: nodeWithPosition.y - nodeHeight / 2,
    };

    return node;
  });

  return { nodes, edges };
};

function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [discoveryData, setDiscoveryData] = useState({});
  const [currentPhase, setCurrentPhase] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showAdmin, setShowAdmin] = useState(
    window.location.pathname === '/admin' ||
    window.location.pathname === '/admin.html'
  );
  const [config, setConfig] = useState(null);
  const [viewMode, setViewMode] = useState('network'); // 'plan' | 'network'
  const [planHistory, setPlanHistory] = useState([]);
  const [showPlanHistory, setShowPlanHistory] = useState(false);
  const [isSavingPlan, setIsSavingPlan] = useState(false);

  const clearPersistedSession = () => {
    try {
      window.localStorage.removeItem('maonboarding-session-id');
      const url = new URL(window.location.href);
      if (url.searchParams.has('sessionId')) {
        url.searchParams.delete('sessionId');
        window.history.replaceState({}, '', url.toString());
      }
    } catch (err) {
      console.error('Failed to clear persisted session:', err);
    }
  };

  const startFreshSession = async () => {
    clearPersistedSession();
    setSessionId(null);
    setDiscoveryData({});
    setCurrentPhase(null);
    setPlanHistory([]);
    setShowPlanHistory(false);
    setViewMode('network');
    setNodes([]);
    setEdges([]);
    await initializeSession();
  };

  useEffect(() => {
    startFreshSession();

    // Load configuration
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const response = await fetch(`${API_BASE}/config-get`);
      if (!response.ok) {
        console.error('Failed to load config: HTTP', response.status);
        return;
      }
      const data = await response.json().catch((err) => {
        console.error('Failed to parse config-get response:', err);
        return null;
      });
      if (!data) return;
      setConfig(data);
    } catch (error) {
      console.error('Failed to load config:', error);
    }
  };

  const initializeSession = async () => {
    try {
      const response = await fetch(`${API_BASE}/session-init`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!response.ok) {
        console.error('Failed to initialize session: HTTP', response.status);
        return;
      }
      const data = await response.json().catch((err) => {
        console.error('Failed to parse session-init response:', err);
        return null;
      });
      if (!data || !data.sessionId) {
        console.error('Session-init response missing sessionId');
        return;
      }
      setSessionId(data.sessionId);
      
      // Set initial root node
      const initialNodes = [{
        id: 'root',
        type: 'input',
        data: { 
          label: 'M&A Discovery',
          status: 'active',
          description: 'Starting point for IT infrastructure discovery'
        },
        position: { x: 0, y: 0 },
        style: {
          background: '#0078D4',
          color: 'white',
          border: '2px solid #005A9E',
          borderRadius: '8px',
          padding: '10px'
        }
      }];
      
      setNodes(initialNodes);
    } catch (error) {
      console.error('Failed to initialize session:', error);
    }
  };

  const updateCategoryNode = (category, data) => {
    if (!data || Object.keys(data).length === 0) return;

    const entries = Object.entries(data || {});

    const deepStringify = (v) => {
      if (v == null) return '';
      if (typeof v === 'string') return v;
      if (typeof v === 'number' || typeof v === 'boolean') return String(v);
      if (Array.isArray(v)) {
        return v.map(item => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object') {
            if (item.name) return item.role ? `${item.name} (${item.role})` : item.name;
            return Object.entries(item).map(([k2, v2]) => `${k2}: ${deepStringify(v2)}`).join(', ');
          }
          return String(item);
        }).join(', ');
      }
      if (typeof v === 'object') {
        if (v.name) return v.role ? `${v.name} (${v.role})` : v.name;
        return Object.entries(v).map(([k2, v2]) => `${k2}: ${deepStringify(v2)}`).join(', ');
      }
      return String(v);
    };

    const summaryParts = entries.slice(0, 4).map(([key, value]) => {
      const formattedKey = key.replace(/_/g, ' ');
      return `${formattedKey}: ${deepStringify(value)}`;
    });
    const summary = summaryParts.join('\n');

    const newNode = {
      id: `${category}-node`,
      type: 'custom',
      data: {
        label: category.charAt(0).toUpperCase() + category.slice(1),
        status: 'completed',
        description: summary || `${Object.keys(data).length} items discovered`,
        raw: data,
      },
      position: { x: 0, y: 0 },
    };

    const newEdge = {
      id: `root-${category}`,
      source: 'root',
      target: `${category}-node`,
      animated: true,
    };

    const updatedNodes = [...nodes.filter((n) => n.id !== newNode.id), newNode];
    const updatedEdges = [...edges.filter((e) => e.id !== newEdge.id), newEdge];

    const layouted = getLayoutedElements(updatedNodes, updatedEdges);
    setNodes(layouted.nodes);
    setEdges(layouted.edges);
  };

  const handleDiscoveryResponse = (category, data) => {
    // Update discovery data when chat extracts info
    if (data && Object.keys(data).length > 0) {
      setDiscoveryData((prev) => ({
        ...prev,
        [category]: data,
      }));
      updateCategoryNode(category, data);
      setViewMode('network');
    }
  };

  const syncDiscoveryUpdate = async (category, data) => {
    if (!sessionId) return;
    try {
      await fetch(`${API_BASE}/discovery-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, category, data }),
      });
    } catch (error) {
      console.error('Failed to sync discovery update:', error);
    }
  };

  const handleDiscoveryEdit = (category, key, value) => {
    const previousCategoryData = discoveryData[category] || {};
    const updatedCategoryData = { ...previousCategoryData, [key]: value };

    setDiscoveryData((prev) => ({
      ...prev,
      [category]: updatedCategoryData,
    }));

    updateCategoryNode(category, updatedCategoryData);
    syncDiscoveryUpdate(category, updatedCategoryData);
  };

  const handleDiscoveryMergeFromFile = (allDiscoveryData) => {
    setDiscoveryData(allDiscoveryData || {});
    setViewMode('network');
    Object.entries(allDiscoveryData || {}).forEach(([category, data]) => {
      updateCategoryNode(category, data);
    });
  };

  const handleCategoryChange = (categoryId) => {
    setCurrentPhase(categoryId);
  };

  const filterBaseGraph = () => {
    // Keep non-plan nodes/edges (root + discovery categories), drop previous phases/tasks
    const baseNodes = nodes.filter((n) => {
      const t = n.data?.type;
      if (t === 'phase' || t === 'task') return false;
      if (n.id.startsWith('phase-') || n.id.startsWith('task-')) return false;
      return true;
    });
    const baseNodeIds = new Set(baseNodes.map((n) => n.id));
    const baseEdges = edges.filter((e) => baseNodeIds.has(e.source) && baseNodeIds.has(e.target));
    return { baseNodes, baseEdges };
  };

  const generateExecutionPlan = async () => {
    if (!sessionId) return;
    setIsProcessing(true);
    try {
      const response = await fetch(`${API_BASE}/plan-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          discoveryData,
          decisionTree: { nodes, edges }
        })
      });
      const raw = await response.text();
      let plan = null;
      try {
        plan = raw ? JSON.parse(raw) : null;
      } catch {
        plan = null;
      }
      if (!response.ok) {
        throw new Error(plan?.details || plan?.error || raw || `Plan generation failed (${response.status})`);
      }
      if (!plan) {
        throw new Error('Plan generation returned an empty response');
      }
      
      // Replace any existing plan nodes with the new plan
      if (plan.planNodes) {
        const { baseNodes, baseEdges } = filterBaseGraph();
        const updatedNodes = [...baseNodes, ...(plan.planNodes || [])];
        const updatedEdges = [...baseEdges, ...(plan.planEdges || [])];
        const layouted = getLayoutedElements(updatedNodes, updatedEdges);
        setNodes(layouted.nodes);
        setEdges(layouted.edges);
      }
      
    } catch (error) {
      console.error('Failed to generate execution plan:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const resetPlan = async () => {
    await startFreshSession();
  };

  const saveCurrentPlan = async () => {
    if (!sessionId) return;
    const name = window.prompt('Save plan as (name):', 'Execution Plan');
    if (!name) return;
    setIsSavingPlan(true);
    try {
      const response = await fetch(`${API_BASE}/plan-history-save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, name, nodes, edges })
      });
      const data = await response.json().catch(() => null);
      if (response.ok && data && Array.isArray(data.history)) {
        setPlanHistory(data.history);
        setShowPlanHistory(true);
      } else {
        console.error('Failed to save plan history:', data);
      }
    } catch (error) {
      console.error('Error saving plan history:', error);
    } finally {
      setIsSavingPlan(false);
    }
  };

  const loadPlanHistory = async () => {
    if (!sessionId) return;
    try {
      const response = await fetch(`${API_BASE}/plan-history-list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });
      const data = await response.json().catch(() => null);
      if (response.ok && data && Array.isArray(data.history)) {
        setPlanHistory(data.history);
        setShowPlanHistory(true);
      } else {
        console.error('Failed to load plan history list:', data);
      }
    } catch (error) {
      console.error('Error loading plan history list:', error);
    }
  };

  const applyHistoryEntry = async (planId) => {
    if (!sessionId || !planId) return;
    try {
      const response = await fetch(`${API_BASE}/plan-history-load`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, planId })
      });
      const data = await response.json().catch(() => null);
      if (response.ok && data) {
        const { nodes: histNodes = [], edges: histEdges = [] } = data;
        const { baseNodes, baseEdges } = filterBaseGraph();
        const updatedNodes = [...baseNodes, ...histNodes];
        const updatedEdges = [...baseEdges, ...histEdges];
        const layouted = getLayoutedElements(updatedNodes, updatedEdges);
        setNodes(layouted.nodes);
        setEdges(layouted.edges);
        setShowPlanHistory(false);
      } else {
        console.error('Failed to load plan history entry:', data);
      }
    } catch (error) {
      console.error('Error applying plan history entry:', error);
    }
  };

  const deleteHistoryEntry = async (planId) => {
    if (!sessionId || !planId) return;
    try {
      const response = await fetch(`${API_BASE}/plan-history-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, planId })
      });
      const data = await response.json().catch(() => null);
      if (response.ok && data && Array.isArray(data.history)) {
        setPlanHistory(data.history);
      } else {
        console.error('Failed to delete plan history entry:', data);
      }
    } catch (error) {
      console.error('Error deleting plan history entry:', error);
    }
  };

  const exportTree = () => {
    const treeData = {
      sessionId,
      timestamp: new Date().toISOString(),
      discoveryData,
      nodes,
      edges
    };
    
    const blob = new Blob([JSON.stringify(treeData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ma-discovery-${sessionId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const onConnect = useCallback((params) => setEdges((eds) => addEdge(params, eds)), [setEdges]);

  const nodeTypes = {
    custom: ({ data }) => (
      <div className={`custom-node ${data.status}`}>
        <div className="node-header">{data.label}</div>
        {data.description && <div className="node-description">{data.description}</div>}
        {data.risk && <div className="node-risk">Risk: {data.risk}</div>}
        {data.timeline && <div className="node-timeline">Timeline: {data.timeline}</div>}
      </div>
    )
  };

  // Handle admin route
  if (showAdmin) {
    return <AdminPanel />;
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <h1><GitBranch className="inline" /> M&A IT Onboarding Intelligence</h1>
        <div className="header-actions">
          <button 
            onClick={() => setViewMode('plan')}
            className={`btn btn-secondary ${viewMode === 'plan' ? 'active' : ''}`}
          >
            Plan View
          </button>
          <button
            onClick={() => setViewMode('network')}
            className={`btn btn-secondary ${viewMode === 'network' ? 'active' : ''}`}
          >
            Network View
          </button>
          <button 
            onClick={generateExecutionPlan} 
            disabled={isProcessing || currentPhase === 'discovery'}
            className="btn btn-primary"
          >
            <Play className="inline" /> Generate Plan
          </button>
          <button
            onClick={saveCurrentPlan}
            disabled={!sessionId || isSavingPlan}
            className="btn btn-secondary"
          >
            Save Plan
          </button>
          <button
            onClick={loadPlanHistory}
            disabled={!sessionId}
            className="btn btn-secondary"
          >
            Plan History
          </button>
          <button
            onClick={resetPlan}
            className="btn btn-secondary"
            style={{ color: '#D13438', borderColor: '#D13438' }}
          >
            Reset Plan
          </button>
          <button onClick={exportTree} className="btn btn-secondary">
            <Download className="inline" /> Export
          </button>
          <button
            onClick={() => {
              if (sessionId) {
                window.open(`/sax-ma-sow-builder.html?sessionId=${sessionId}`, '_blank');
              }
            }}
            disabled={!sessionId}
            className="btn btn-secondary"
          >
            SOW Builder
          </button>
        </div>
      </header>

      <div className="main-content">
        <div className="left-panel">
          <ChatInterface 
            key={sessionId || 'fresh-session'}
            sessionId={sessionId}
            onDiscoveryUpdate={handleDiscoveryResponse}
            currentPhase={currentPhase}
            onCategoryChange={handleCategoryChange}
          />
          <DiscoveryPanel 
            discoveryData={discoveryData}
            currentPhase={currentPhase}
            config={config}
            onEdit={handleDiscoveryEdit}
          />
          <FileUploadPanel
            sessionId={sessionId}
            onDiscoveryMerge={handleDiscoveryMergeFromFile}
          />
        </div>

        {viewMode === 'plan' ? (
          <div className="tree-container">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_, node) => {
                if (node.id.endsWith('-node')) {
                  const categoryId = node.id.replace('-node', '');
                  setCurrentPhase(categoryId);
                }
              }}
              nodeTypes={nodeTypes}
              fitView
              attributionPosition="bottom-left"
            >
              <Background color="#aaa" gap={16} />
              <Controls />
              <MiniMap 
                nodeColor={(node) => {
                  switch (node.data?.status) {
                    case 'active': return '#0078D4';
                    case 'completed': return '#107C10';
                    case 'pending': return '#FFB900';
                    case 'risk': return '#D13438';
                    default: return '#605E5C';
                  }
                }}
              />
            </ReactFlow>
          </div>
        ) : (
          <NetworkDiagram discoveryData={discoveryData} />
        )}
      </div>

      {isProcessing && (
        <div className="processing-overlay">
          <div className="processing-spinner">Processing...</div>
        </div>
      )}

      {showPlanHistory && (
        <div className="processing-overlay" onClick={() => setShowPlanHistory(false)}>
          <div
            className="processing-spinner"
            onClick={(e) => e.stopPropagation()}
            style={{ minWidth: '420px', maxHeight: '60vh', overflowY: 'auto' }}
          >
            <div style={{ fontWeight: 700, marginBottom: '0.5rem' }}>Saved Plans</div>
            {(!planHistory || planHistory.length === 0) && (
              <div style={{ fontSize: '0.8rem' }}>No saved plans for this session.</div>
            )}
            {planHistory && planHistory.map((h) => (
              <div
                key={h.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '0.5rem',
                  fontSize: '0.8rem'
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{h.name}</div>
                  <div style={{ opacity: 0.7 }}>{h.createdAt}</div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                    onClick={() => applyHistoryEntry(h.id)}
                  >
                    Load
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                    onClick={() => deleteHistoryEntry(h.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
