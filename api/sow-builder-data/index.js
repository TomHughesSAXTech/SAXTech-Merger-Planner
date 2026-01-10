const { OpenAIClient, AzureKeyCredential } = require('@azure/openai');
const { CosmosClient } = require('@azure/cosmos');

module.exports = async function (context, req) {
  try {
    const openAIEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const openAIKey = process.env.AZURE_OPENAI_KEY;
    const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT;
    const cosmosEndpoint = process.env.COSMOS_ENDPOINT;
    const cosmosKey = process.env.COSMOS_KEY;

    if (!cosmosEndpoint || !cosmosKey) {
      context.res = {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Cosmos DB configuration missing' }
      };
      return;
    }

    const sessionId = (req.query && req.query.sessionId) || (req.body && req.body.sessionId);
    if (!sessionId) {
      context.res = {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'sessionId is required' }
      };
      return;
    }

    const cosmosClient = new CosmosClient({ endpoint: cosmosEndpoint, key: cosmosKey });
    const database = cosmosClient.database('MAOnboarding');
    const container = database.container('Sessions');

    const { resource: session } = await container.item(sessionId, sessionId).read();
    if (!session || !session.executionPlan) {
      context.res = {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Execution plan not found for session' }
      };
      return;
    }

    const executionPlan = session.executionPlan;
    const discoveryData = session.discoveryData || {};

    // Use Azure OpenAI to transform execution plan into SOW builder schema
    const client = new OpenAIClient(openAIEndpoint, new AzureKeyCredential(openAIKey));

    const transformPrompt = `You are helping map an M&A IT onboarding execution plan into a structured
SAX SOW builder schema used for estimating hours.

Input discovery data (JSON):\n${JSON.stringify(discoveryData, null, 2)}

Input execution plan (JSON):\n${JSON.stringify(executionPlan, null, 2)}

Target output JSON schema (no comments):
{
  "coverData": {
    "projectName": string,
    "customerId": string,
    "description": string
  },
  "scopeData": {
    "scopeDescription": string,
    "deliverables": string[],
    "timeline": string
  },
  "serviceItems": [
    {
      "id": number,
      "phase": string,
      "editable": boolean,
      "subItems": [
        {
          "id": number,
          "description": string,
          "resourceClass": "CXO" | "DIO" | "SE",
          "hours": number,
          "afterHours": boolean,
          "maintenanceRequired": boolean,
          "outageHours": number
        }
      ]
    }
  ]
}

Rules:
- Derive phases from the execution plan phases.
- Derive tasks from phase tasks, grouping into subItems with reasonable hour estimates.
- Choose resourceClass based on the type of work: CXO for high-level/PM, DIO for architecture/design,
  SE for technical implementation.
- Keep JSON compact but valid. Return ONLY JSON.`;

    let sow;
    try {
      const completion = await client.getChatCompletions(
        deploymentName,
        [
          { role: 'system', content: 'You are an M&A integration planning expert and SOW estimator.' },
          { role: 'user', content: transformPrompt }
        ],
        {
          maxTokens: 1200,
          temperature: 0.4
        }
      );

      const content = completion.choices[0].message.content;
      sow = JSON.parse(content);
    } catch (err) {
      context.log('Failed to transform execution plan to SOW via OpenAI, falling back to simple mapping:', err.message);

      // Fallback: simple mapping without extra AI processing
      const phases = executionPlan.phases || [];
      let nextId = 1;
      sow = {
        coverData: {
          projectName: session.projectName || '',
          customerId: session.customerId || '',
          description: 'Generated from M&A onboarding execution plan.'
        },
        scopeData: {
          scopeDescription: 'High-level scope based on discovered systems and migration plan.',
          deliverables: phases.map(p => p.name).filter(Boolean),
          timeline: executionPlan.timeline?.estimatedDuration || ''
        },
        serviceItems: phases.map((phase, idx) => ({
          id: idx + 1,
          phase: phase.name || phase.id || `Phase ${idx + 1}`,
          editable: true,
          subItems: (phase.tasks || []).map((task, tIdx) => {
            const desc = typeof task === 'string' ? task : (task.name || task.description || 'Task');
            const role = typeof task === 'object' && task.role ? task.role : 'SE';
            const resourceClass = role.toLowerCase().includes('director') || role.toLowerCase().includes('architect') ? 'DIO'
              : role.toLowerCase().includes('cxo') || role.toLowerCase().includes('pm') ? 'CXO'
              : 'SE';
            const hours = typeof task === 'object' && typeof task.hours === 'number' ? task.hours : 4;
            return {
              id: nextId++,
              description: desc,
              resourceClass,
              hours,
              afterHours: false,
              maintenanceRequired: false,
              outageHours: 0
            };
          })
        }))
      };
    }

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: sow
    };
  } catch (error) {
    context.log.error('Error generating SOW builder data:', error);
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: { error: 'Failed to generate SOW builder data', details: error.message }
    };
  }
};