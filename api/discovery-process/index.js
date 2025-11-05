const { app } = require('@azure/functions');
const { OpenAIClient, AzureKeyCredential } = require('@azure/openai');
const { CosmosClient } = require('@azure/cosmos');

// Azure OpenAI Configuration
const openAIEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
const openAIKey = process.env.AZURE_OPENAI_KEY;
const deploymentId = process.env.AZURE_OPENAI_DEPLOYMENT;

// Cosmos DB Configuration
const cosmosEndpoint = process.env.COSMOS_ENDPOINT;
const cosmosKey = process.env.COSMOS_KEY;
const cosmosClient = new CosmosClient({ endpoint: cosmosEndpoint, key: cosmosKey });
const database = cosmosClient.database('MAOnboarding');
const container = database.container('Sessions');

const openAIClient = new OpenAIClient(openAIEndpoint, new AzureKeyCredential(openAIKey));

// Discovery Processing Function
app.http('discovery-process', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'discovery/process',
    handler: async (request, context) => {
        const { sessionId, category, response, currentTree } = await request.json();

        try {
            // Store discovery response
            await storeDiscoveryData(sessionId, category, response);

            // Generate AI prompt for decision tree generation
            const prompt = buildDiscoveryPrompt(category, response, currentTree);
            
            // Call Azure OpenAI
            const completion = await openAIClient.getChatCompletions(
                deploymentId,
                [
                    {
                        role: 'system',
                        content: getSystemPrompt()
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                {
                    temperature: 0.3,
                    max_tokens: 2000,
                    functions: [getTreeGenerationFunction()],
                    function_call: { name: 'generate_decision_nodes' }
                }
            );

            const functionCall = completion.choices[0].message.functionCall;
            const treeUpdates = JSON.parse(functionCall.arguments);

            // Process the AI response to create new nodes and edges
            const { newNodes, newEdges } = processAIResponse(treeUpdates, currentTree);

            // Determine if phase is complete
            const phaseComplete = checkPhaseCompletion(category, response);
            const nextPhase = phaseComplete ? getNextPhase(category) : null;

            return {
                status: 200,
                jsonBody: {
                    success: true,
                    newNodes,
                    newEdges,
                    phaseComplete,
                    nextPhase,
                    insights: treeUpdates.insights
                }
            };
        } catch (error) {
            context.log('Error processing discovery:', error);
            return {
                status: 500,
                jsonBody: { error: 'Failed to process discovery response' }
            };
        }
    }
});

function getSystemPrompt() {
    return `You are an AI assistant specializing in M&A IT infrastructure onboarding. 
    Your role is to analyze discovery responses and generate decision tree nodes that represent:
    1. Required migration tasks
    2. Dependencies between tasks
    3. Risk factors and mitigation strategies
    4. Timeline estimates
    5. Resource requirements
    
    For each discovery response, identify:
    - Critical infrastructure components
    - Integration points and dependencies
    - Potential risks or blockers
    - Parallel vs sequential task requirements
    - ConnectWise ticket structure recommendations
    
    Generate nodes that are actionable, specific, and include relevant metadata for project planning.`;
}

function getTreeGenerationFunction() {
    return {
        name: 'generate_decision_nodes',
        description: 'Generate decision tree nodes based on discovery information',
        parameters: {
            type: 'object',
            properties: {
                nodes: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string' },
                            label: { type: 'string' },
                            description: { type: 'string' },
                            category: { type: 'string', enum: ['infrastructure', 'application', 'data', 'security', 'communication'] },
                            status: { type: 'string', enum: ['pending', 'active', 'completed', 'risk'] },
                            risk: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
                            timeline: { type: 'string' },
                            dependencies: { type: 'array', items: { type: 'string' } },
                            resources: { type: 'array', items: { type: 'string' } },
                            connectwiseTemplate: { type: 'string' }
                        },
                        required: ['id', 'label', 'category', 'status']
                    }
                },
                edges: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            source: { type: 'string' },
                            target: { type: 'string' },
                            label: { type: 'string' },
                            type: { type: 'string', enum: ['dependency', 'parallel', 'conditional'] }
                        },
                        required: ['source', 'target']
                    }
                },
                insights: {
                    type: 'object',
                    properties: {
                        criticalPath: { type: 'array', items: { type: 'string' } },
                        estimatedDuration: { type: 'string' },
                        majorRisks: { type: 'array', items: { type: 'string' } },
                        recommendedApproach: { type: 'string' }
                    }
                }
            },
            required: ['nodes', 'edges', 'insights']
        }
    };
}

function buildDiscoveryPrompt(category, response, currentTree) {
    const existingNodes = currentTree.nodes.map(n => `${n.id}: ${n.data.label}`).join('\n');
    
    return `Based on the following discovery information for category "${category}":

${JSON.stringify(response, null, 2)}

Current decision tree nodes:
${existingNodes}

Generate new decision tree nodes and edges that:
1. Reflect the discovered infrastructure/systems
2. Identify migration or integration tasks
3. Show dependencies and sequencing
4. Highlight risks and considerations
5. Provide timeline estimates

Focus on creating actionable, specific nodes that can be converted to project tasks.`;
}

function processAIResponse(treeUpdates, currentTree) {
    const existingNodeIds = new Set(currentTree.nodes.map(n => n.id));
    
    // Filter out duplicate nodes
    const newNodes = treeUpdates.nodes
        .filter(node => !existingNodeIds.has(node.id))
        .map(node => ({
            id: node.id,
            type: 'custom',
            data: {
                label: node.label,
                description: node.description,
                status: node.status,
                risk: node.risk,
                timeline: node.timeline,
                category: node.category,
                resources: node.resources,
                connectwiseTemplate: node.connectwiseTemplate
            },
            position: { x: 0, y: 0 } // Will be laid out by dagre
        }));

    // Create edges ensuring they connect valid nodes
    const allNodeIds = new Set([...existingNodeIds, ...newNodes.map(n => n.id)]);
    const newEdges = treeUpdates.edges
        .filter(edge => allNodeIds.has(edge.source) && allNodeIds.has(edge.target))
        .map(edge => ({
            id: `${edge.source}-${edge.target}`,
            source: edge.source,
            target: edge.target,
            label: edge.label || '',
            type: edge.type || 'dependency',
            animated: edge.type === 'risk',
            style: getEdgeStyle(edge.type)
        }));

    return { newNodes, newEdges };
}

function getEdgeStyle(type) {
    switch (type) {
        case 'dependency':
            return { stroke: '#0078D4', strokeWidth: 2 };
        case 'parallel':
            return { stroke: '#107C10', strokeWidth: 2, strokeDasharray: '5,5' };
        case 'conditional':
            return { stroke: '#FFB900', strokeWidth: 2, strokeDasharray: '10,5' };
        case 'risk':
            return { stroke: '#D13438', strokeWidth: 3 };
        default:
            return { stroke: '#605E5C', strokeWidth: 1 };
    }
}

function checkPhaseCompletion(category, response) {
    // Define completion criteria for each category
    const completionCriteria = {
        'infrastructure': ['servers', 'network', 'storage'],
        'application': ['inventory', 'dependencies', 'licensing'],
        'data': ['databases', 'file_shares', 'backup'],
        'security': ['firewall', 'policies', 'compliance'],
        'communication': ['email', 'phones', 'collaboration']
    };

    if (completionCriteria[category]) {
        const responseKeys = Object.keys(response);
        return completionCriteria[category].every(criteria => 
            responseKeys.some(key => key.includes(criteria))
        );
    }
    
    return false;
}

function getNextPhase(currentCategory) {
    const phases = ['infrastructure', 'application', 'data', 'security', 'communication', 'planning'];
    const currentIndex = phases.indexOf(currentCategory);
    return currentIndex < phases.length - 1 ? phases[currentIndex + 1] : 'complete';
}

async function storeDiscoveryData(sessionId, category, response) {
    const item = {
        id: sessionId,
        partitionKey: sessionId,
        category,
        response,
        timestamp: new Date().toISOString()
    };
    
    await container.items.upsert(item);
}

module.exports = { app };
