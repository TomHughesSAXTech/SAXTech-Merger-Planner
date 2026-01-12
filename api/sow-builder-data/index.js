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

    // Load configuration for OpenAI overrides
    let configData = null;
    try {
      const configContainer = database.container('Configurations');
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

    const client = new OpenAIClient(openAIEndpoint, new AzureKeyCredential(openAIKey));

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

    // Helper: try to infer a customer/company name from discovery data
    function inferCustomerFromDiscovery(dd) {
      try {
        const values = [];
        const stack = [dd];
        while (stack.length) {
          const cur = stack.pop();
          if (!cur) continue;
          if (typeof cur === 'string') {
            values.push({ key: '', value: cur });
          } else if (Array.isArray(cur)) {
            cur.forEach(v => stack.push(v));
          } else if (typeof cur === 'object') {
            Object.entries(cur).forEach(([k, v]) => {
              if (typeof v === 'string') {
                values.push({ key: k.toLowerCase(), value: v });
              } else {
                stack.push(v);
              }
            });
          }
        }
        // Prefer keys that look like company/client
        const hit = values.find(x => x.key.includes('company') || x.key.includes('client') || x.key.includes('organization'));
        return hit ? hit.value : null;
      } catch {
        return null;
      }
    }

    const inferredCustomer = inferCustomerFromDiscovery(discoveryData);

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
          projectName: session.projectName || (inferredCustomer ? `${inferredCustomer} – M&A IT Onboarding` : ''),
          customerId: session.customerId || inferredCustomer || '',
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
            const risk = typeof task === 'object' && typeof task.risk === 'string' ? task.risk : '';
            return {
              id: nextId++,
              description: desc,
              resourceClass,
              hours,
              afterHours: false,
              maintenanceRequired: false,
              outageHours: 0,
              risk
            };
          })
        }))
      };
    }

    // Post-process SOW from either AI or fallback: ensure project/deliverables inferred when missing
    try {
      if (sow) {
        if (sow.coverData) {
          if (!sow.coverData.customerId && inferredCustomer) {
            sow.coverData.customerId = inferredCustomer;
          }
          if (!sow.coverData.projectName && inferredCustomer) {
            sow.coverData.projectName = `${inferredCustomer} – M&A IT Onboarding`;
          }
        }
        if (sow.scopeData) {
          if ((!sow.scopeData.deliverables || !sow.scopeData.deliverables.length) && Array.isArray(executionPlan.phases)) {
            sow.scopeData.deliverables = executionPlan.phases.map(p => p.name || p.id).filter(Boolean);
          }
        }
      }
    } catch (ppErr) {
      context.log('Post-processing SOW enhancements failed:', ppErr.message);
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