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

    // Load configuration for OpenAI overrides
    let configData = null;
    try {
      const configContainer = database.container('Configurations');
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

    // Reference template: baseline hours and phase structure for a
    // small-firm, two-server, five-user migration. This is used to
    // calibrate GPT's estimates so they stay in a realistic range.
    const baselineHoursTemplate = `
PROJECT TYPE EXAMPLE (REFERENCE ONLY)
- Scenario: 2 servers, ~5 users, single main office plus small satellite.
- High-level phases and typical effort:
  - Phase 0: Pre-Migration & Discovery .......... ~12 hours
  - Phase 1: Server Migration (Deliverable 1) ... ~42 hours
  - Phase 2: User Onboarding (5 users) .......... ~22.5 hours
  - Phase 3: Data Migration/Lockdown/Backup ..... ~18 hours
  - Phase 4: Email/OneDrive/Website/DNS Cutover . ~27.5 hours
  - Phase 5: Post-Migration & Stabilization ..... ~29.5 hours
  - Total baseline effort ........................ ~150–155 hours

HOURS BY DELIVERABLE (REFERENCE)
- Deliverable 1 – Two Server Migration
  - Includes Datto prep, VHD export/import, Azure VM build, security stack,
    permissions, backup cutover, and server validation.
  - Typical: ~56 hours total.
- Deliverable 2 – User Onboarding (5 users / 5 laptops)
  - Includes AD/M365 accounts, imaging, deployment, profile config,
    and user orientation.
  - Typical: ~27.5 hours total.
- Deliverable 3 – Data Migration/Lockdown/Backup
  - Includes S: drive validation, workstation data sweep, retention model,
    backup validation, and legacy backup decommission.
  - Typical: ~21 hours total.
- Deliverable 4 – Email/OneDrive/Website/DNS Cutover
  - Includes domain transfer, DNS/Proofpoint, BitTitan migrations,
    OneDrive moves, and mail-flow testing.
  - Typical: ~31.5 hours total.

These numbers are not hard constraints, but for a similarly sized
environment (2 servers, ~5 users) the total project estimate should
usually stay within ~135–170 hours unless discovery clearly indicates
substantially more or less work (larger data sets, many more users,
complex VPN/site topology, heavy application remediation, etc.).`;

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

    const transformPrompt = `You are helping map an M&A IT onboarding execution plan into a structured
SAX SOW builder schema used for estimating hours.

Use the following reference project as a calibration example for
phase structure and realistic hours for a two-server, five-user
migration. Do not copy client names, but mirror the level of detail
and approximate effort when the discovered environment is of similar
size:

${baselineHoursTemplate}

Now analyze the actual engagement details below.

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
- Derive tasks from phase tasks, grouping into subItems with realistic hour
  estimates roughly in line with the reference project when the environment
  is similar in size (2 servers, ~5 users). Scale hours up or down when
  discovery clearly indicates more or fewer users, servers, or complexity.
- Choose resourceClass based on the type of work: CXO for high-level/PM,
  DIO for architecture/design, SE for technical implementation.
- Keep JSON compact but valid. Return ONLY JSON.`;

    let sow;
    try {
      const completion = await getChatCompletionsWithFallback(
        client,
        deploymentName,
        defaultDeployment,
        [
          { role: 'system', content: 'You are an M&A integration planning expert and SOW estimator.' },
          { role: 'user', content: transformPrompt }
        ],
        {
          maxTokens: 1200,
          temperature: 0.4
        },
        context,
        'sow-builder-data SOW transform'
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