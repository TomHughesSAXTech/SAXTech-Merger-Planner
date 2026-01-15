const { OpenAIClient, AzureKeyCredential } = require('@azure/openai');
const { CosmosClient } = require('@azure/cosmos');

async function loadConfig(cosmosClient) {
  try {
    const database = cosmosClient.database('MAOnboarding');
    const container = database.container('Configurations');
    const { resource: config } = await container.item('discovery_config', 'discovery_config').read();
    return config.data;
  } catch (error) {
    return null;
  }
}

module.exports = async function (context, req) {
  try {
    const baseEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
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

    const { sessionId, fileName, content } = req.body || {};
    if (!sessionId || !content) {
      context.res = {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'sessionId and content are required' }
      };
      return;
    }

    const cosmosClient = new CosmosClient({ endpoint: cosmosEndpoint, key: cosmosKey });
    const database = cosmosClient.database('MAOnboarding');
    const container = database.container('Sessions');

    const { resource: session } = await container.item(sessionId, sessionId).read();
    if (!session) {
      context.res = {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Session not found' }
      };
      return;
    }

    const config = await loadConfig(cosmosClient);
    const openAiSettings = config?.globalSettings?.openAi || {};
    const modelFromConfig = config?.globalSettings?.aiModel;
    const openAIEndpoint = openAiSettings.endpoint || baseEndpoint;
    const deploymentName = modelFromConfig || defaultDeployment;
    let openAIKey = keyPrimary;
    if (openAiSettings.keySlot === 'secondary' && keySecondary) {
      openAIKey = keySecondary;
    }

    const openAIClient = new OpenAIClient(openAIEndpoint, new AzureKeyCredential(openAIKey));

    const truncated = typeof content === 'string' ? content.slice(0, 15000) : '';

    const systemPrompt = `You are an assistant that reads IT discovery documents (spreadsheets, exports, network diagrams, inventories) and maps them into structured JSON for an M&A IT onboarding system.\n\nYou MUST output strictly valid JSON. Do not include explanations. Map content into these top-level keys when relevant:\n- general\n- server\n- workstation\n- security\n- backup\n- rmm\n- applications\n- telephony\n- vendor\n- network\n\nWithin each category, prefer flat key/value pairs where keys are machine-friendly (snake_case) but readable, like:\n- company_name\n- primary_poc { name, email, phone, role }\n- total_users\n- sites (array)\n- firewalls (array)\n- switches (array)\n- routers (array)\n- backup_frequency\n- edr_vendor\n- rmm_vendor\n\nIf a category has no information, omit it or use an empty object. If the same fact appears multiple times, deduplicate it.\n`;

    const userPrompt = `FILE NAME: ${fileName || 'uploaded file'}\n\nCONTENT (may be truncated):\n${truncated}`;

    const completion = await openAIClient.getChatCompletions(deploymentName, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ], {
      maxTokens: 1200,
      temperature: 0.2
    });

    let extracted;
    try {
      extracted = JSON.parse(completion.choices[0].message.content);
    } catch (err) {
      context.log.error('Failed to parse file-ingest JSON:', err);
      context.res = {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Failed to parse AI output from file', details: err.message }
      };
      return;
    }

    if (!session.discoveryData) {
      session.discoveryData = {};
    }

    const categories = Object.keys(extracted || {});
    categories.forEach((cat) => {
      const incoming = extracted[cat] || {};
      const existing = session.discoveryData[cat] || {};
      session.discoveryData[cat] = {
        ...existing,
        ...incoming,
      };
    });

    await container.item(sessionId, sessionId).replace(session);

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: {
        sessionId,
        discoveryData: session.discoveryData,
        updatedCategories: categories
      }
    };
  } catch (error) {
    context.log.error('Error in file-ingest:', error);
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: { error: 'Failed to ingest file', details: error.message }
    };
  }
};
