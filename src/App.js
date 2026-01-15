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
import AdminPanel from './components/AdminPanel';
import './App.css';

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

  useEffect(() => {
    // Initialize session
    initializeSession();
    // Load configuration
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const response = await fetch('https://maonboarding-functions.azurewebsites.net/api/config-get');
      const data = await response.json();
      setConfig(data);
    } catch (error) {
      console.error('Failed to load config:', error);
    }
  };

  const initializeSession = async () => {
    console.log('[DEBUG] Initializing session...');
    try {
      const response = await fetch('https://maonboarding-functions.azurewebsites.net/api/session-init', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await response.json();
      console.log('[DEBUG] Session initialized:', data.sessionId);
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
    const summaryParts = entries.slice(0, 3).map(([key, value]) => {
      const formattedKey = key.replace(/_/g, ' ');
      const stringValue = Array.isArray(value)
        ? value.join(', ')
        : typeof value === 'object'
          ? '[object]'
          : String(value);
      return `${formattedKey}: ${stringValue}`;
    });
    const summary = summaryParts.join(' • ');

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
    }
  };

  const syncDiscoveryUpdate = async (category, data) => {
    if (!sessionId) return;
    try {
      await fetch('https://maonboarding-functions.azurewebsites.net/api/discovery-update', {
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

  const handleCategoryChange = (categoryId) => {
    setCurrentPhase(categoryId);
  };

  const generateExecutionPlan = async () => {
    setIsProcessing(true);
    try {
      const response = await fetch('/api/plan-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          discoveryData,
          decisionTree: { nodes, edges }
        })
      });
      
      const plan = await response.json();
      
      // Add plan nodes to the tree
      if (plan.planNodes) {
        const updatedNodes = [...nodes, ...plan.planNodes];
        const updatedEdges = [...edges, ...plan.planEdges];
        
        const layouted = getLayoutedElements(updatedNodes, updatedEdges);
        setNodes(layouted.nodes);
        setEdges(layouted.edges);
      }
      
      // Export to ConnectWise if configured
      if (plan.connectwiseTickets) {
        await createConnectWiseTickets(plan.connectwiseTickets);
      }
    } catch (error) {
      console.error('Failed to generate execution plan:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const createConnectWiseTickets = async (tickets) => {
    try {
      const response = await fetch('/api/connectwise-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickets })
      });
      
      const result = await response.json();
      console.log('ConnectWise tickets created:', result);
    } catch (error) {
      console.error('Failed to create ConnectWise tickets:', error);
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
            onClick={generateExecutionPlan} 
            disabled={isProcessing || currentPhase === 'discovery'}
            className="btn btn-primary"
          >
            <Play className="inline" /> Generate Plan
          </button>
          <button onClick={exportTree} className="btn btn-secondary">
            <Download className="inline" /> Export
          </button>
          <button
            onClick={() => {
              if (sessionId) {
                window.open(`/sax-ma-sow-builder.html?sessionId=${sessionId}`, '_blank');
              } else {
                window.open('/sax-ma-sow-builder.html', '_blank');
              }
            }}
            className="btn btn-secondary"
          >
            SOW Builder
          </button>
        </div>
      </header>

      <div className="main-content">
        <div className="left-panel">
          <ChatInterface 
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
        </div>

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
      </div>

      {isProcessing && (
        <div className="processing-overlay">
          <div className="processing-spinner">Processing...</div>
        </div>
      )}
    </div>
  );
}

export default App;
