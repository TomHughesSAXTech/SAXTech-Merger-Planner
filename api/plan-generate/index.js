const { OpenAIClient, AzureKeyCredential } = require('@azure/openai');
const { CosmosClient } = require('@azure/cosmos');

module.exports = async function (context, req) {
    try {
        const baseEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
        const keyPrimary = process.env.AZURE_OPENAI_KEY_PRIMARY || process.env.AZURE_OPENAI_KEY;
        const keySecondary = process.env.AZURE_OPENAI_KEY_SECONDARY;
        const defaultDeployment = process.env.AZURE_OPENAI_DEPLOYMENT;
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
        const openAIEndpoint = openAiSettings.endpoint || baseEndpoint;
        const deploymentName = openAiSettings.deployment || defaultDeployment;
        let openAIKey = keyPrimary;
        if (openAiSettings.keySlot === 'secondary' && keySecondary) {
            openAIKey = keySecondary;
        }

        const openAIClient = new OpenAIClient(openAIEndpoint, new AzureKeyCredential(openAIKey));

        const planPrompt = `
Based on this M&A onboarding discovery data and decision tree, generate a detailed execution plan.

Discovery Data (JSON):
${JSON.stringify(discoveryData, null, 2)}

Decision Tree Summary:
${decisionTree.nodes.length} nodes, ${decisionTree.edges.length} edges

Generate an execution plan with:
1. Phases (sequential high-level stages)
2. Tasks within each phase with dependencies
3. Resource requirements
4. Estimated timeline
5. Risk factors
6. ConnectWise ticket structure

Return STRICT JSON with this shape (no comments, no extra fields):
{
  "phases": [
    {
      "id": "phase1",
      "name": "Planning",
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

        const completion = await openAIClient.getChatCompletions(deploymentName, [
                { role: 'system', content: 'You are an M&A integration planning expert. Generate detailed, actionable execution plans.' },
                { role: 'user', content: planPrompt }
            ], {
                maxTokens: 2000,
                temperature: 0.5
            });

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
