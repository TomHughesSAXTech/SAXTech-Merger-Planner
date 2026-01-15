const { CosmosClient } = require('@azure/cosmos');

module.exports = async function (context, req) {
  try {
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

    const { sessionId, category, data } = req.body || {};

    if (!sessionId || !category || !data || typeof data !== 'object') {
      context.res = {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'sessionId, category, and data (object) are required' }
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

    if (!session.discoveryData) {
      session.discoveryData = {};
    }

    session.discoveryData[category] = data;

    await container.item(sessionId, sessionId).replace(session);

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { discoveryData: session.discoveryData[category] }
    };
  } catch (error) {
    context.log.error('Error updating discovery data:', error);
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: { error: 'Failed to update discovery data', details: error.message }
    };
  }
};
