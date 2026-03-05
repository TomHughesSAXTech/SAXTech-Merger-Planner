const { CosmosClient } = require('@azure/cosmos');
const {
  resolveOpenAISettings,
  getChatCompletionsWithFallback,
  parseJsonResponse,
} = require('../src/openai');

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

    const { sessionId, fileName, content } = req.body || {};
    if (!sessionId || typeof content !== 'string' || !content.trim()) {
      context.res = {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'sessionId and non-empty text content are required' },
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

    if (!session.discoveryData || typeof session.discoveryData !== 'object') {
      session.discoveryData = {};
    }

    const config = await loadConfig(cosmosClient);
    const settings = resolveOpenAISettings(config || {});

    const truncated = content.slice(0, 18000);
    const systemPrompt = `You are an assistant that reads IT discovery artifacts (interview transcripts, exports, inventories, and diagrams) and maps facts into structured JSON for an M&A IT onboarding platform.
Return ONLY valid JSON. No markdown, no commentary.

Top-level categories (include only categories with data):
- general
- server
- workstation
- security
- backup
- rmm
- applications
- telephony
- vendor
- network

Use machine-friendly snake_case keys and preserve important details/quantities/vendors.`;

    const userPrompt = `FILE: ${fileName || 'uploaded file'}
CONTENT:
${truncated}`;

    const completion = await getChatCompletionsWithFallback({
      settings,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      options: { maxTokens: 1800 },
      context,
      label: 'file-ingest extraction',
    });

    const extracted = parseJsonResponse(completion?.choices?.[0]?.message?.content || '{}');
    if (!extracted || typeof extracted !== 'object' || Array.isArray(extracted)) {
      context.res = {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Invalid AI extraction output format' },
      };
      return;
    }

    const categories = Object.keys(extracted);
    categories.forEach((category) => {
      const incoming = extracted[category];
      const existing = session.discoveryData[category];

      if (
        incoming &&
        typeof incoming === 'object' &&
        !Array.isArray(incoming) &&
        existing &&
        typeof existing === 'object' &&
        !Array.isArray(existing)
      ) {
        session.discoveryData[category] = { ...existing, ...incoming };
      } else {
        session.discoveryData[category] = incoming;
      }
    });

    await sessions.item(sessionId, sessionId).replace(session);

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: {
        sessionId,
        discoveryData: session.discoveryData,
        updatedCategories: categories,
      },
    };
  } catch (error) {
    context.log.error('Error in file-ingest:', error);
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: { error: 'Failed to ingest file', details: error.message },
    };
  }
};
