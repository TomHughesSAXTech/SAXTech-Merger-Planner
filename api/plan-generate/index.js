const { OpenAIClient, AzureKeyCredential } = require('@azure/openai');
const { CosmosClient } = require('@azure/cosmos');

// Helper to call OpenAI with a primary deployment and gracefully fall back
// to a default deployment if the primary deployment does not exist in the
// target Azure OpenAI resource.
async function getChatCompletionsWithFallback(client, primaryDeployment, fallbackDeployment, messages, options, context, label) {
    try {
        if (!primaryDeployment && !fallbackDeployment) {
            throw new Error('No OpenAI deployment configured. Set aiModel or AZURE_OPENAI_DEPLOYMENT.');
        }

        const deploymentToUse = primaryDeployment || fallbackDeployment;
        return await client.getChatCompletions(deploymentToUse, messages, options);
    } catch (err) {
        const message = (err && err.message ? err.message : '').toLowerCase();
        const missingDeployment = message.includes('deployment') && message.includes('does not exist');

        if (missingDeployment && fallbackDeployment && primaryDeployment && fallbackDeployment !== primaryDeployment) {
            context.log.warn(`Primary OpenAI deployment "${primaryDeployment}" not found, retrying with fallback deployment "${fallbackDeployment}" for ${label}.`);
            return await client.getChatCompletions(fallbackDeployment, messages, options);
        }

        throw err;
    }
}

module.exports = async function (context, req) {
    try {
        const keyPrimary = process.env.AZURE_OPENAI_KEY_PRIMARY || process.env.AZURE_OPENAI_KEY;
        const keySecondary = process.env.AZURE_OPENAI_KEY_SECONDARY;
        const defaultDeployment = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4.1-mini';
        const cosmosEndpoint = process.env.COSMOS_ENDPOINT;
        const cosmosKey = process.env.COSMOS_KEY;
        
        const cosmosClient = new CosmosClient({ endpoint: cosmosEndpoint, key: cosmosKey });
        const database = cosmosClient.database('MAOnboarding');
        const container = database.container('Sessions');
        
        const body = req.body;
        const { sessionId, discoveryData, decisionTree } = body;

        const { resource: session } = await container.item(sessionId, sessionId).read();

        // Load configuration to allow OpenAI overrides
        const configClient = new CosmosClient({ endpoint: cosmosEndpoint, key: cosmosKey });
        const configDb = configClient.database('MAOnboarding');
        const configContainer = configDb.container('Configurations');
        let configData = null;
        try {
            const { resource: cfg } = await configContainer.item('discovery_config', 'discovery_config').read();
            configData = cfg.data;
        } catch {}

        const openAiSettings = configData?.globalSettings?.openAi || {};
        const modelFromConfig = configData?.globalSettings?.aiModel;
        const openAIEndpoint = 'https://client-fcs.cognitiveservices.azure.com/';
        const deploymentName = modelFromConfig || defaultDeployment;
        let openAIKey = keyPrimary;
        if (openAiSettings.keySlot === 'secondary' && keySecondary) {
            openAIKey = keySecondary;
        }

        const openAIClient = new OpenAIClient(openAIEndpoint, new AzureKeyCredential(openAIKey));

        // Baseline template to align phases and hours with a typical
        // two-server, ~5-user M&A onboarding. This is a calibration aid,
        // not a hard constraint.
        const baselineHoursTemplate = `
REFERENCE PROJECT (CALIBRATION ONLY)
- Scenario: 2 servers, ~5 users, one primary office plus small satellite.
- Phases and typical effort:
  - Phase 0: Pre-Migration & Discovery .......... ~12 hours
  - Phase 1: Server Migration (Deliverable 1) ... ~42 hours
  - Phase 2: User Onboarding (5 users) .......... ~22.5 hours
  - Phase 3: Data Migration/Lockdown/Backup ..... ~18 hours
  - Phase 4: Email/OneDrive/Website/DNS Cutover . ~27.5 hours
  - Phase 5: Post-Migration & Stabilization ..... ~29.5 hours
  - Total baseline effort ........................ ~150–155 hours

Deliverable mapping (reference):
- Deliverable 1 – Two Server Migration (~56 hours)
- Deliverable 2 – User Onboarding (~27.5 hours)
- Deliverable 3 – Data Migration/Lockdown/Backup (~21 hours)
- Deliverable 4 – Email/OneDrive/Website/DNS (~31.5 hours)

Use this as a sanity check: for a similarly sized environment, the
sum of all task hours across all phases should normally fall between
~135 and ~170 hours unless discovery clearly indicates materially more
or less work (many more users, servers, complex VPN, heavy app issues, etc.).`;

        const planPrompt = `
You are an M&A integration planning expert. Create a professional,
structured execution plan suitable for feeding into a SOW builder.

First, use the following reference project to calibrate your
phases and hours for a small (two-server, five-user) environment:

${baselineHoursTemplate}

Now analyze the actual engagement details below.

Discovery Data (JSON):
${JSON.stringify(discoveryData, null, 2)}

Decision Tree Summary:
${decisionTree.nodes.length} nodes, ${decisionTree.edges.length} edges

Generate an execution plan with:
1. Phases that follow this structure where appropriate:
   - Phase 0: Pre-Migration & Discovery
   - Phase 1: Server Migration (Deliverable 1)
   - Phase 2: User Onboarding (Deliverable 2)
   - Phase 3: Data Migration/Lockdown/Backup (Deliverable 3)
   - Phase 4: Email/OneDrive/Website/DNS Cutover (Deliverable 4)
   - Phase 5: Post-Migration & Stabilization
   If the environment is substantially larger or smaller, you may
   split/merge phases, but keep the naming and ordering intuitive.
2. Tasks within each phase with realistic hours and roles.
3. Dependencies between tasks (by id) when order matters.
4. High-level timeline summary (days/weeks).
5. Risk factors.
6. ConnectWise ticket recommendations.

IMPORTANT HOUR GUIDANCE:
- For environments similar in size to the reference (2 servers, ~5
  users), try to keep the total sum of all task hours close to the
  baseline band (~135–170 hours), adjusted up or down based on the
  actual discovery (more users, more servers, more complexity).
- Each task MUST include an estimated hour count and role so that
  downstream SOW tooling can roll up labor and margin.

Return STRICT JSON with this shape (no comments, no extra fields):
{
  "phases": [
    {
      "id": "phase0",
      "name": "Pre-Migration & Discovery",
      "description": "high level description of the phase",
      "tasks": [
        {
          "name": "Identify all line-of-business systems",
          "description": "1–2 sentence summary of the task",
          "hours": 8,
          "role": "SE | DIO | CXO",
          "dependencies": ["optional-other-task-ids"],
          "risk": "low | medium | high | critical"
        }
      ]
    }
  ],
  "timeline": {
    "totalDays": 90,
    "milestones": [
      { "name": "Assessment complete", "day": 15 },
      { "name": "Cutover", "day": 60 }
    ]
  },
  "risks": [
    { "description": "...", "impact": "low | medium | high | critical", "mitigation": "..." }
  ],
  "connectwiseTickets": [
    { "title": "...", "description": "...", "type": "project | task | change", "priority": "low | medium | high" }
  ]
}`;

        const completion = await getChatCompletionsWithFallback(
            openAIClient,
            deploymentName,
            defaultDeployment,
            [
                { role: 'system', content: 'You are an M&A integration planning expert. Generate detailed, actionable execution plans.' },
                { role: 'user', content: planPrompt }
            ],
            {
                maxTokens: 2000,
                temperature: 0.5
            },
            context,
            'plan-generate execution plan'
        );

        let plan;
        try {
            plan = JSON.parse(completion.choices[0].message.content);
        } catch (parseError) {
            context.log('Failed to parse plan, using fallback structure');
            plan = {
                phases: [
                    { id: 'assessment', name: 'Assessment', tasks: ['Initial assessment', 'Resource allocation'] },
                    { id: 'migration', name: 'Migration', tasks: ['Data migration', 'Application migration'] },
                    { id: 'integration', name: 'Integration', tasks: ['System integration', 'User training'] }
                ],
                timeline: { totalDays: 90, milestones: [] },
                risks: [],
                connectwiseTickets: []
            };
        }

        const planNodes = [];
        const planEdges = [];
        let nodeY = 50;

        plan.phases.forEach((phase, phaseIdx) => {
            const phaseNode = {
                id: `phase-${phase.id}`,
                type: 'default',
                data: {
                    label: phase.name,
                    type: 'phase'
                },
                position: { x: 100, y: nodeY },
                style: { background: '#4a90e2', color: 'white', padding: 10 }
            };
            planNodes.push(phaseNode);

            if (phaseIdx > 0) {
                planEdges.push({
                    id: `edge-phase-${phaseIdx}`,
                    source: `phase-${plan.phases[phaseIdx - 1].id}`,
                    target: `phase-${phase.id}`,
                    animated: true
                });
            }

            nodeY += 100;

            if (phase.tasks && Array.isArray(phase.tasks)) {
                phase.tasks.forEach((task, taskIdx) => {
                    const taskName = typeof task === 'string' ? task : task.name || 'Task';
                    const taskNode = {
                        id: `task-${phase.id}-${taskIdx}`,
                        type: 'default',
                        data: {
                            label: taskName,
                            type: 'task'
                        },
                        position: { x: 300 + (taskIdx * 150), y: nodeY - 50 },
                        style: { background: '#e8f4f8', padding: 8 }
                    };
                    planNodes.push(taskNode);

                    planEdges.push({
                        id: `edge-task-${phase.id}-${taskIdx}`,
                        source: `phase-${phase.id}`,
                        target: `task-${phase.id}-${taskIdx}`
                    });
                });
            }
        });

        // Normalize phases to ensure Phase 0–5 naming is present
        const phaseNameMap = {
            0: 'Phase 0: Pre-Migration & Discovery',
            1: 'Phase 1: Server Migration (Deliverable 1)',
            2: 'Phase 2: User Onboarding (Deliverable 2)',
            3: 'Phase 3: Data Migration/Lockdown/Backup (Deliverable 3)',
            4: 'Phase 4: Email/OneDrive/Website/DNS Cutover (Deliverable 4)',
            5: 'Phase 5: Post-Migration & Stabilization',
        };

        if (Array.isArray(plan.phases)) {
            plan.phases = plan.phases.map((p, idx) => {
                const mapped = { ...p };
                if (idx in phaseNameMap) {
                    mapped.name = mapped.name || phaseNameMap[idx];
                    mapped.id = mapped.id || `phase${idx}`;
                }
                return mapped;
            });
        }

        session.executionPlan = plan;
        await container.item(sessionId, sessionId).replace(session);

        context.res = {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                planNodes,
                planEdges,
                connectwiseTickets: plan.connectwiseTickets || []
            })
        };
    } catch (error) {
        context.log.error('Error generating plan:', error);
        context.res = {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Failed to generate execution plan', details: error.message })
        };
    }
};
