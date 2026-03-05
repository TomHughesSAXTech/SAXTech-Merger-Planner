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

function inferCompany(discoveryData = {}) {
  return (
    discoveryData?.general?.company_name ||
    discoveryData?.general?.organization_name ||
    discoveryData?.general?.client_name ||
    ''
  );
}

function inferTotalUsers(discoveryData = {}) {
  return Number(
    discoveryData?.general?.total_users ||
      discoveryData?.workstation?.workstation_count ||
      discoveryData?.workstation?.total ||
      0
  );
}

function createExecutionPlanFallback(discoveryData = {}) {
  const totalUsers = inferTotalUsers(discoveryData);
  const serverCount = Number(
    discoveryData?.server?.server_count ||
      (Array.isArray(discoveryData?.server?.servers) ? discoveryData.server.servers.length : 0) ||
      2
  );
  const scale = Math.max(0.7, Math.min(5.5, (Math.max(totalUsers, 5) / 5) * 0.5 + (Math.max(serverCount, 2) / 2) * 0.5));

  const withScale = (hours) => Math.max(1, Math.round(hours * scale * 2) / 2);

  const phases = [
    {
      id: 'phase0',
      name: PHASE_NAMES[0],
      description: 'Discovery validation, architecture alignment, and rollout planning.',
      tasks: [
        { id: 'phase0-task1', name: 'Finalize discovery validation', description: 'Confirm source and target state assumptions.', hours: withScale(10), role: 'DIO', dependencies: [], risk: 'medium' },
        { id: 'phase0-task2', name: 'Prepare migration runbook and communications plan', description: 'Prepare detailed SOP runbook and comms plan.', hours: withScale(8), role: 'CXO', dependencies: ['phase0-task1'], risk: 'medium' },
      ],
    },
    {
      id: 'phase1',
      name: PHASE_NAMES[1],
      description: 'Server migration execution and validation.',
      tasks: [
        { id: 'phase1-task1', name: 'Migrate server workloads', description: 'Migrate all identified workloads to target platform.', hours: withScale(44), role: 'SE', dependencies: ['phase0-task2'], risk: 'high' },
        { id: 'phase1-task2', name: 'Apply hardening and baseline controls', description: 'Apply security baselines and monitoring controls.', hours: withScale(12), role: 'SE', dependencies: ['phase1-task1'], risk: 'medium' },
      ],
    },
    {
      id: 'phase2',
      name: PHASE_NAMES[2],
      description: 'User transition and endpoint onboarding.',
      tasks: [
        { id: 'phase2-task1', name: 'Provision identities and endpoint readiness', description: 'Configure identity, access, and endpoint state.', hours: withScale(22), role: 'SE', dependencies: ['phase1-task1'], risk: 'medium' },
        { id: 'phase2-task2', name: 'Deliver onboarding and hypercare support', description: 'Provide post-cutover support and remediation.', hours: withScale(12), role: 'SE', dependencies: ['phase2-task1'], risk: 'medium' },
      ],
    },
    {
      id: 'phase3',
      name: PHASE_NAMES[3],
      description: 'Data and backup transition.',
      tasks: [
        { id: 'phase3-task1', name: 'Migrate and validate business data', description: 'Migrate data repositories and validate integrity.', hours: withScale(18), role: 'SE', dependencies: ['phase1-task1'], risk: 'high' },
        { id: 'phase3-task2', name: 'Implement retention and backup controls', description: 'Validate backup/restore and retention policies.', hours: withScale(8), role: 'DIO', dependencies: ['phase3-task1'], risk: 'medium' },
      ],
    },
    {
      id: 'phase4',
      name: PHASE_NAMES[4],
      description: 'Messaging/collaboration and DNS cutover.',
      tasks: [
        { id: 'phase4-task1', name: 'Execute messaging and collaboration migration', description: 'Complete collaboration cutover and validation.', hours: withScale(28), role: 'SE', dependencies: ['phase2-task1', 'phase3-task1'], risk: 'high' },
        { id: 'phase4-task2', name: 'Apply DNS/domain routing updates', description: 'Perform domain and DNS updates with validation.', hours: withScale(9), role: 'DIO', dependencies: ['phase4-task1'], risk: 'medium' },
      ],
    },
    {
      id: 'phase5',
      name: PHASE_NAMES[5],
      description: 'Stabilization and project close.',
      tasks: [
        { id: 'phase5-task1', name: 'Post-migration stabilization', description: 'Resolve residual issues and tune operations.', hours: withScale(24), role: 'SE', dependencies: ['phase4-task2'], risk: 'medium' },
        { id: 'phase5-task2', name: 'Closeout and handoff', description: 'Deliver final SOP documentation and handoff package.', hours: withScale(8), role: 'CXO', dependencies: ['phase5-task1'], risk: 'low' },
      ],
    },
  ];

  return {
    phases,
    timeline: {
      totalDays: Math.max(21, Math.round((phases.flatMap((p) => p.tasks).reduce((sum, t) => sum + t.hours, 0) / 8) * 1.35)),
      milestones: [
        { name: 'Discovery Locked', day: 7 },
        { name: 'Core Migration Complete', day: 30 },
        { name: 'Cutover Complete', day: 45 },
      ],
    },
    risks: [
      { description: 'Legacy dependencies discovered late', impact: 'high', mitigation: 'Use checkpoint-based validation and rollback gates.' },
      { description: 'User disruption during transition', impact: 'medium', mitigation: 'Stage migrations and provide hypercare windows.' },
    ],
  };
}

function normalizeExecutionPlan(plan, discoveryData) {
  const fallback = createExecutionPlanFallback(discoveryData);
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.phases) || !plan.phases.length) {
    return fallback;
  }

  return {
    phases: plan.phases.map((phase, pIdx) => ({
      id: phase.id || `phase${pIdx}`,
      name: phase.name || PHASE_NAMES[pIdx] || `Phase ${pIdx + 1}`,
      description: phase.description || '',
      tasks: (Array.isArray(phase.tasks) ? phase.tasks : []).map((task, tIdx) => {
        if (typeof task === 'string') {
          return {
            id: `${phase.id || `phase${pIdx}`}-task${tIdx + 1}`,
            name: task,
            description: task,
            hours: 4,
            role: 'SE',
            dependencies: [],
            risk: 'medium',
          };
        }
        return {
          id: task.id || `${phase.id || `phase${pIdx}`}-task${tIdx + 1}`,
          name: task.name || task.title || `Task ${tIdx + 1}`,
          description: task.description || task.name || task.title || `Task ${tIdx + 1}`,
          hours: Number.isFinite(Number(task.hours)) && Number(task.hours) > 0 ? Number(task.hours) : 4,
          role: task.role || 'SE',
          dependencies: Array.isArray(task.dependencies) ? task.dependencies : [],
          risk: task.risk || 'medium',
        };
      }),
    })),
    timeline: plan.timeline || fallback.timeline,
    risks: Array.isArray(plan.risks) ? plan.risks : fallback.risks,
  };
}

function buildFallbackSow(executionPlan, discoveryData, session) {
  const company = inferCompany(discoveryData);
  let nextTaskId = 1;

  const serviceItems = (executionPlan.phases || []).map((phase, phaseIndex) => ({
    id: phaseIndex + 1,
    phase: phase.name || `Phase ${phaseIndex + 1}`,
    editable: true,
    subItems: (Array.isArray(phase.tasks) ? phase.tasks : []).map((task) => ({
      id: nextTaskId++,
      description: task.name || task.description || 'Task',
      resourceClass: String(task.role || 'SE').includes('CXO')
        ? 'CXO'
        : String(task.role || '').includes('DIO')
        ? 'DIO'
        : 'SE',
      hours: Number(task.hours) || 4,
      afterHours: false,
      maintenanceRequired: false,
      outageHours: 0,
      detailSteps: task.description || '',
      risk: task.risk || 'medium',
    })),
  }));

  const timeline = executionPlan?.timeline?.totalDays
    ? `${executionPlan.timeline.totalDays} days`
    : '';

  return {
    coverData: {
      projectName: session?.projectName || (company ? `${company} – M&A IT Onboarding` : ''),
      customerId: session?.customerId || company || '',
      description: 'Generated from M&A onboarding discovery and execution planning.',
    },
    scopeData: {
      scopeDescription:
        'Scope derived from discovery interview data and generated migration execution phases/tasks.',
      deliverables: (executionPlan.phases || []).map((phase) => phase.name).filter(Boolean),
      timeline,
    },
    serviceItems,
    products: [],
    rates: null,
  };
}

async function synthesizeExecutionPlanIfMissing({
  session,
  discoveryData,
  settings,
  context,
}) {
  if (session.executionPlan && Array.isArray(session.executionPlan.phases) && session.executionPlan.phases.length) {
    return session.executionPlan;
  }

  const synthPrompt = `You are a Senior Systems and Network Architect creating a migration execution plan from discovery data.
Return ONLY valid JSON in this format:
{
  "phases":[
    {"id":"phase0","name":"Phase 0: Pre-Migration & Discovery","description":"...","tasks":[{"id":"phase0-task1","name":"...","description":"...","hours":8,"role":"CXO|DIO|SE","dependencies":[],"risk":"low|medium|high|critical"}]}
  ],
  "timeline":{"totalDays":60,"milestones":[{"name":"...","day":15}]},
  "risks":[{"description":"...","impact":"low|medium|high|critical","mitigation":"..."}]
}

Discovery JSON:
${JSON.stringify(discoveryData, null, 2)}`;

  try {
    const completion = await getChatCompletionsWithFallback({
      settings,
      messages: [
        {
          role: 'system',
          content:
            'You produce practical M&A execution plans with role-based tasks and realistic estimated hours.',
        },
        { role: 'user', content: synthPrompt },
      ],
      options: { maxTokens: 2000 },
      context,
      label: 'sow-builder-data synthesize execution plan',
    });
    return normalizeExecutionPlan(parseJsonResponse(completion?.choices?.[0]?.message?.content || '{}'), discoveryData);
  } catch (error) {
    context.log.warn('sow-builder-data failed to synthesize execution plan via AI:', error.message);
    return createExecutionPlanFallback(discoveryData);
  }
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

    const sessionId = (req.query && req.query.sessionId) || (req.body && req.body.sessionId);
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

    const discoveryData = session.discoveryData || {};
    const config = await loadConfig(cosmosClient);
    let settings = null;
    try {
      settings = resolveOpenAISettings(config || {});
    } catch (settingsError) {
      context.log.warn('sow-builder-data OpenAI settings unavailable, using fallback transformations:', settingsError.message);
    }

    let executionPlan = await synthesizeExecutionPlanIfMissing({
      session,
      discoveryData,
      settings,
      context,
    });
    executionPlan = normalizeExecutionPlan(executionPlan, discoveryData);

    session.executionPlan = executionPlan;
    await sessions.item(sessionId, sessionId).replace(session);

    const transformPrompt = `Transform this execution plan into SOW builder JSON.
Return ONLY JSON with schema:
{
  "coverData":{"projectName":"string","customerId":"string","description":"string"},
  "scopeData":{"scopeDescription":"string","deliverables":["string"],"timeline":"string"},
  "serviceItems":[{"id":1,"phase":"string","editable":true,"subItems":[{"id":1,"description":"string","resourceClass":"CXO|DIO|SE","hours":8,"afterHours":false,"maintenanceRequired":false,"outageHours":0,"detailSteps":"string","risk":"low|medium|high|critical"}]}]
}

Discovery JSON:
${JSON.stringify(discoveryData, null, 2)}

Execution Plan JSON:
${JSON.stringify(executionPlan, null, 2)}`;

    let sowPayload = null;
    try {
      const completion = await getChatCompletionsWithFallback({
        settings,
        messages: [
          {
            role: 'system',
            content:
              'You are a Senior Systems and Network Architect producing SOW-ready phase/task estimations with practical hours.',
          },
          { role: 'user', content: transformPrompt },
        ],
        options: { maxTokens: 2200 },
        context,
        label: 'sow-builder-data transform',
      });
      const parsed = parseJsonResponse(completion?.choices?.[0]?.message?.content || '{}');
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.serviceItems)) {
        throw new Error('Invalid SOW payload returned by model');
      }
      sowPayload = parsed;
    } catch (error) {
      context.log.warn('sow-builder-data transform fallback triggered:', error.message);
      sowPayload = buildFallbackSow(executionPlan, discoveryData, session);
    }

    if (!sowPayload.coverData || typeof sowPayload.coverData !== 'object') {
      sowPayload.coverData = {};
    }
    if (!sowPayload.scopeData || typeof sowPayload.scopeData !== 'object') {
      sowPayload.scopeData = {};
    }
    if (!Array.isArray(sowPayload.serviceItems)) {
      sowPayload.serviceItems = [];
    }

    if (!sowPayload.coverData.customerId) {
      sowPayload.coverData.customerId = inferCompany(discoveryData) || '';
    }
    if (!sowPayload.coverData.projectName) {
      const inferred = inferCompany(discoveryData);
      sowPayload.coverData.projectName = inferred ? `${inferred} – M&A IT Onboarding` : '';
    }
    if (!Array.isArray(sowPayload.scopeData.deliverables) || !sowPayload.scopeData.deliverables.length) {
      sowPayload.scopeData.deliverables = (executionPlan.phases || []).map((p) => p.name).filter(Boolean);
    }

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: sowPayload,
    };
  } catch (error) {
    context.log.error('Error generating SOW builder data:', error);
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: { error: 'Failed to generate SOW builder data', details: error.message },
    };
  }
};
