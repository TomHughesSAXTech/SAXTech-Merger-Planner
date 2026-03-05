const { CosmosClient } = require('@azure/cosmos');
const {
  resolveOpenAISettings,
  getChatCompletionsWithFallback,
  parseJsonResponse,
} = require('../src/openai');

const PHASE_NAMES = [
  'Phase 0: Pre-Migration & Discovery',
  'Phase 1: Server Migration (Deliverable 1)',
  'Phase 2: User Onboarding (Deliverable 2)',
  'Phase 3: Data Migration/Lockdown/Backup (Deliverable 3)',
  'Phase 4: Email/OneDrive/Website/DNS Cutover (Deliverable 4)',
  'Phase 5: Post-Migration & Stabilization',
];

async function loadConfig(cosmosClient) {
  try {
    const database = cosmosClient.database('MAOnboarding');
    const container = database.container('Configurations');
    const { resource: config } = await container.item('discovery_config', 'discovery_config').read();
    return config?.data || null;
  } catch {
    return null;
  }
}

function inferEnvironmentScale(discoveryData = {}) {
  const users = Number(
    discoveryData?.general?.total_users ||
      discoveryData?.workstation?.workstation_count ||
      discoveryData?.workstation?.total ||
      0
  );
  const servers = Number(
    discoveryData?.server?.server_count ||
      (Array.isArray(discoveryData?.server?.servers)
        ? discoveryData.server.servers.length
        : 0)
  );

  const baselineUsers = 5;
  const baselineServers = 2;
  const userMultiplier = users > 0 ? users / baselineUsers : 1;
  const serverMultiplier = servers > 0 ? servers / baselineServers : 1;
  const scale = Math.max(0.6, Math.min(6, (userMultiplier * 0.45) + (serverMultiplier * 0.55)));

  return {
    users,
    servers,
    scale,
  };
}

function roundedHours(baseHours, scale = 1) {
  return Math.max(1, Math.round(baseHours * scale * 2) / 2);
}

function createFallbackPlan(discoveryData = {}) {
  const { users, servers, scale } = inferEnvironmentScale(discoveryData);
  const companyName = discoveryData?.general?.company_name || 'Client';

  const phases = [
    {
      id: 'phase0',
      name: PHASE_NAMES[0],
      description: 'Baseline discovery validation, architecture confirmation, and cutover planning.',
      tasks: [
        {
          id: 'phase0-task1',
          name: 'Validate discovery and migration assumptions',
          description: 'Confirm source/target platforms, constraints, and sequencing assumptions.',
          hours: roundedHours(12, scale),
          role: 'DIO',
          dependencies: [],
          risk: 'medium',
        },
        {
          id: 'phase0-task2',
          name: 'Build implementation runbooks and rollback plan',
          description: 'Produce execution-ready runbooks, rollback procedures, and communications timeline.',
          hours: roundedHours(8, scale),
          role: 'CXO',
          dependencies: ['phase0-task1'],
          risk: 'medium',
        },
      ],
    },
    {
      id: 'phase1',
      name: PHASE_NAMES[1],
      description: 'Server and core platform migration into target environment.',
      tasks: [
        {
          id: 'phase1-task1',
          name: 'Migrate server workloads to target platform',
          description: `Migrate ${servers || 'all'} server workloads with validation and cutover checkpoints.`,
          hours: roundedHours(42, scale),
          role: 'SE',
          dependencies: ['phase0-task2'],
          risk: 'high',
        },
        {
          id: 'phase1-task2',
          name: 'Harden server security and backup policies',
          description: 'Apply security baselines, monitoring, and backup alignment for migrated servers.',
          hours: roundedHours(14, scale),
          role: 'SE',
          dependencies: ['phase1-task1'],
          risk: 'medium',
        },
      ],
    },
    {
      id: 'phase2',
      name: PHASE_NAMES[2],
      description: 'User onboarding, endpoint readiness, and access transition.',
      tasks: [
        {
          id: 'phase2-task1',
          name: 'Provision user identities and endpoint access',
          description: `Provision onboarding flow for ~${users || 'all'} users, groups, and endpoint access.`,
          hours: roundedHours(22.5, scale),
          role: 'SE',
          dependencies: ['phase1-task1'],
          risk: 'medium',
        },
        {
          id: 'phase2-task2',
          name: 'Execute user validation and transition support',
          description: 'Perform acceptance validation and day-1/day-2 hypercare for transitioned users.',
          hours: roundedHours(10, scale),
          role: 'SE',
          dependencies: ['phase2-task1'],
          risk: 'medium',
        },
      ],
    },
    {
      id: 'phase3',
      name: PHASE_NAMES[3],
      description: 'Data migration, retention controls, and backup hardening.',
      tasks: [
        {
          id: 'phase3-task1',
          name: 'Migrate and validate business data',
          description: 'Migrate file and application data with reconciliation and stakeholder signoff.',
          hours: roundedHours(18, scale),
          role: 'SE',
          dependencies: ['phase1-task1'],
          risk: 'high',
        },
        {
          id: 'phase3-task2',
          name: 'Implement retention and backup validation',
          description: 'Validate restore points, retention compliance, and backup reporting.',
          hours: roundedHours(8, scale),
          role: 'DIO',
          dependencies: ['phase3-task1'],
          risk: 'medium',
        },
      ],
    },
    {
      id: 'phase4',
      name: PHASE_NAMES[4],
      description: 'Messaging, collaboration, and DNS cutover activities.',
      tasks: [
        {
          id: 'phase4-task1',
          name: 'Execute messaging and collaboration cutover',
          description: 'Migrate mail/collaboration workloads and validate post-cutover functionality.',
          hours: roundedHours(27.5, scale),
          role: 'SE',
          dependencies: ['phase2-task1', 'phase3-task1'],
          risk: 'high',
        },
        {
          id: 'phase4-task2',
          name: 'Finalize DNS/domain routing changes',
          description: 'Apply DNS, routing, and domain updates with validation checks.',
          hours: roundedHours(9, scale),
          role: 'DIO',
          dependencies: ['phase4-task1'],
          risk: 'medium',
        },
      ],
    },
    {
      id: 'phase5',
      name: PHASE_NAMES[5],
      description: 'Stabilization, support transition, and project closeout.',
      tasks: [
        {
          id: 'phase5-task1',
          name: 'Post-migration stabilization and issue burn-down',
          description: 'Resolve residual issues and tune operational controls after cutover.',
          hours: roundedHours(29.5, scale),
          role: 'SE',
          dependencies: ['phase4-task2'],
          risk: 'medium',
        },
        {
          id: 'phase5-task2',
          name: `Handover to ${companyName} operations and closeout`,
          description: 'Deliver documentation, SOPs, and closeout governance artifacts.',
          hours: roundedHours(8, scale),
          role: 'CXO',
          dependencies: ['phase5-task1'],
          risk: 'low',
        },
      ],
    },
  ];

  return {
    phases,
    timeline: {
      totalDays: Math.max(21, Math.round((phases.flatMap((p) => p.tasks).reduce((sum, t) => sum + t.hours, 0) / 8) * 1.3)),
      milestones: [
        { name: 'Discovery Complete', day: 7 },
        { name: 'Core Migration Complete', day: 30 },
        { name: 'Cutover Complete', day: 45 },
      ],
    },
    risks: [
      {
        description: 'Data quality and legacy dependency mismatches during migration',
        impact: 'high',
        mitigation: 'Perform phased validation with rollback checkpoints and dependency mapping.',
      },
      {
        description: 'User disruption during identity and endpoint transition',
        impact: 'medium',
        mitigation: 'Use staged rollouts and hypercare support windows.',
      },
    ],
  };
}

function normalizeTask(task, phaseId, index) {
  if (!task) {
    return null;
  }

  if (typeof task === 'string') {
    return {
      id: `${phaseId}-task${index + 1}`,
      name: task,
      description: task,
      hours: 4,
      role: 'SE',
      dependencies: [],
      risk: 'medium',
    };
  }

  const name = task.name || task.title || `Task ${index + 1}`;
  const numericHours = Number(task.hours);
  return {
    id: task.id || `${phaseId}-task${index + 1}`,
    name,
    description: task.description || name,
    hours: Number.isFinite(numericHours) && numericHours > 0 ? numericHours : 4,
    role: task.role || 'SE',
    dependencies: Array.isArray(task.dependencies) ? task.dependencies : [],
    risk: task.risk || 'medium',
  };
}

function normalizePlan(rawPlan, discoveryData) {
  const fallback = createFallbackPlan(discoveryData);
  if (!rawPlan || typeof rawPlan !== 'object') {
    return fallback;
  }

  const phases = Array.isArray(rawPlan.phases) ? rawPlan.phases : [];
  if (!phases.length) {
    return fallback;
  }

  const normalizedPhases = phases.map((phase, index) => {
    const phaseId = phase.id || `phase${index}`;
    const tasks = Array.isArray(phase.tasks)
      ? phase.tasks
          .map((task, taskIndex) => normalizeTask(task, phaseId, taskIndex))
          .filter(Boolean)
      : [];

    return {
      id: phaseId,
      name: phase.name || PHASE_NAMES[index] || `Phase ${index + 1}`,
      description: phase.description || '',
      tasks: tasks.length ? tasks : fallback.phases[Math.min(index, fallback.phases.length - 1)]?.tasks || [],
    };
  });

  return {
    phases: normalizedPhases,
    timeline: rawPlan.timeline || fallback.timeline,
    risks: Array.isArray(rawPlan.risks) ? rawPlan.risks : fallback.risks,
  };
}

function buildPlanGraph(plan) {
  const planNodes = [];
  const planEdges = [];
  let phaseY = 80;

  const phaseByTaskId = new Map();

  plan.phases.forEach((phase, phaseIndex) => {
    const phaseNodeId = `phase-${phase.id}`;
    planNodes.push({
      id: phaseNodeId,
      type: 'default',
      data: {
        label: phase.name,
        type: 'phase',
      },
      position: { x: 120, y: phaseY },
      style: { background: '#4a90e2', color: 'white', padding: 10 },
    });

    if (phaseIndex > 0) {
      planEdges.push({
        id: `edge-phase-${phaseIndex}`,
        source: `phase-${plan.phases[phaseIndex - 1].id}`,
        target: phaseNodeId,
        animated: true,
      });
    }

    const tasks = Array.isArray(phase.tasks) ? phase.tasks : [];
    tasks.forEach((task, taskIndex) => {
      const taskNodeId = `task-${phase.id}-${taskIndex}`;
      phaseByTaskId.set(task.id, taskNodeId);

      planNodes.push({
        id: taskNodeId,
        type: 'default',
        data: {
          label: `${task.name} (${task.hours}h)`,
          type: 'task',
          risk: task.risk,
        },
        position: { x: 430 + (taskIndex * 220), y: phaseY },
        style: { background: '#e8f4f8', padding: 8 },
      });

      planEdges.push({
        id: `edge-task-parent-${phase.id}-${taskIndex}`,
        source: phaseNodeId,
        target: taskNodeId,
      });
    });

    phaseY += 150;
  });

  plan.phases.forEach((phase) => {
    const tasks = Array.isArray(phase.tasks) ? phase.tasks : [];
    tasks.forEach((task) => {
      const targetTaskNodeId = phaseByTaskId.get(task.id);
      if (!targetTaskNodeId || !Array.isArray(task.dependencies)) return;
      task.dependencies.forEach((depId) => {
        const sourceTaskNodeId = phaseByTaskId.get(depId);
        if (!sourceTaskNodeId) return;
        planEdges.push({
          id: `edge-dep-${sourceTaskNodeId}-${targetTaskNodeId}`,
          source: sourceTaskNodeId,
          target: targetTaskNodeId,
          animated: true,
          style: { stroke: '#D97706', strokeDasharray: '5 3' },
        });
      });
    });
  });

  return { planNodes, planEdges };
}

module.exports = async function (context, req) {
  try {
    const cosmosEndpoint = process.env.COSMOS_ENDPOINT;
    const cosmosKey = process.env.COSMOS_KEY;
    if (!cosmosEndpoint || !cosmosKey) {
      context.res = {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Cosmos DB configuration missing' },
      };
      return;
    }

    const body = req.body || {};
    const { sessionId } = body;
    if (!sessionId) {
      context.res = {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'sessionId is required' },
      };
      return;
    }

    const cosmosClient = new CosmosClient({ endpoint: cosmosEndpoint, key: cosmosKey });
    const database = cosmosClient.database('MAOnboarding');
    const sessions = database.container('Sessions');

    const { resource: session } = await sessions.item(sessionId, sessionId).read();
    if (!session) {
      context.res = {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Session not found' },
      };
      return;
    }

    const discoveryData = body.discoveryData || session.discoveryData || {};
    const decisionTree = body.decisionTree || { nodes: [], edges: [] };

    const config = await loadConfig(cosmosClient);
    const settings = resolveOpenAISettings(config || {});

    const calibrationText = `Reference baseline for small engagements:
- 2 servers, ~5 users, typical total effort ~135-170 hours.
- Phase emphasis:
  - Discovery/prep
  - Server migration
  - User onboarding
  - Data/backup/retention
  - Email/OneDrive/DNS cutover
  - Post-migration stabilization`;

    const prompt = `You are a Senior Systems and Network Architect with 30+ years of professional services scoping experience.
Build an actionable M&A migration execution plan for SOW generation.

${calibrationText}

Discovery Data JSON:
${JSON.stringify(discoveryData, null, 2)}

Current decision graph summary:
nodes=${(decisionTree.nodes || []).length}, edges=${(decisionTree.edges || []).length}

Return ONLY valid JSON:
{
  "phases": [
    {
      "id": "phase0",
      "name": "Phase 0: Pre-Migration & Discovery",
      "description": "string",
      "tasks": [
        {
          "id": "phase0-task1",
          "name": "string",
          "description": "string",
          "hours": 8,
          "role": "CXO|DIO|SE",
          "dependencies": ["phaseX-taskY"],
          "risk": "low|medium|high|critical"
        }
      ]
    }
  ],
  "timeline": {
    "totalDays": 60,
    "milestones": [{"name":"string","day":15}]
  },
  "risks": [{"description":"string","impact":"low|medium|high|critical","mitigation":"string"}]
}`;

    let plan = null;
    try {
      const completion = await getChatCompletionsWithFallback({
        settings,
        messages: [
          {
            role: 'system',
            content:
              'You create enterprise-grade M&A migration execution plans that are practical, role-based, and hour-estimable.',
          },
          { role: 'user', content: prompt },
        ],
        options: { maxTokens: 2200 },
        context,
        label: 'plan-generate execution plan',
      });
      const parsed = parseJsonResponse(completion?.choices?.[0]?.message?.content || '{}');
      plan = normalizePlan(parsed, discoveryData);
    } catch (error) {
      context.log.warn('plan-generate AI plan failed, using deterministic fallback:', error.message);
      plan = createFallbackPlan(discoveryData);
    }

    const { planNodes, planEdges } = buildPlanGraph(plan);

    session.executionPlan = plan;
    await sessions.item(sessionId, sessionId).replace(session);

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: {
        planNodes,
        planEdges,
        executionPlan: plan,
        connectwiseTickets: plan.connectwiseTickets || [],
      },
    };
  } catch (error) {
    context.log.error('Error generating plan:', error);
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: { error: 'Failed to generate execution plan', details: error.message },
    };
  }
};
