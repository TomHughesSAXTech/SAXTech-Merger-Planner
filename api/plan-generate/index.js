const { app } = require('@azure/functions');
const { OpenAIClient, AzureKeyCredential } = require('@azure/openai');
const { CosmosClient } = require('@azure/cosmos');

const openAIEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
const openAIKey = process.env.AZURE_OPENAI_KEY;
const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT;
const openAIClient = new OpenAIClient(openAIEndpoint, new AzureKeyCredential(openAIKey));

const cosmosEndpoint = process.env.COSMOS_ENDPOINT;
const cosmosKey = process.env.COSMOS_KEY;
const cosmosClient = new CosmosClient({ endpoint: cosmosEndpoint, key: cosmosKey });
const database = cosmosClient.database('MAOnboarding');
const container = database.container('Sessions');

app.http('plan-generate', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            const body = await request.json();
            const { sessionId, discoveryData, decisionTree } = body;

            const { resource: session } = await container.item(sessionId, sessionId).read();

            const planPrompt = `
Based on this M&A onboarding discovery data and decision tree, generate a detailed execution plan.

Discovery Data:
${JSON.stringify(discoveryData, null, 2)}

Decision Tree Summary:
${decisionTree.nodes.length} nodes, ${decisionTree.edges.length} edges

Generate an execution plan with:
1. Phases (Sequential high-level stages)
2. Tasks within each phase with dependencies
3. Resource requirements
4. Estimated timeline
5. Risk factors
6. ConnectWise ticket structure

Return JSON with:
{
  "phases": [{"id": "phase1", "name": "Planning", "tasks": [...]}],
  "timeline": {"totalDays": 90, "milestones": [...]},
  "risks": [...],
  "connectwiseTickets": [{"title": "...", "description": "...", "type": "...", "priority": "..."}]
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

            return {
                status: 200,
                jsonBody: {
                    planNodes,
                    planEdges,
                    connectwiseTickets: plan.connectwiseTickets || []
                }
            };
        } catch (error) {
            context.log('Error generating plan:', error);
            return {
                status: 500,
                jsonBody: { error: 'Failed to generate execution plan' }
            };
        }
    }
});
