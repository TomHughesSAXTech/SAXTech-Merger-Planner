const { CosmosClient } = require('@azure/cosmos');
let BlobServiceClient;
try {
  ({ BlobServiceClient } = require('@azure/storage-blob'));
} catch (e) {
  // storage SDK not available locally
}

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

    const { sessionId, planId } = req.body || {};
    if (!sessionId || !planId) {
      context.res = {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'sessionId and planId are required' }
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

    const history = Array.isArray(session.planHistory) ? session.planHistory : [];
    const entryIndex = history.findIndex(h => h.id === planId);
    if (entryIndex === -1) {
      context.res = {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Plan history entry not found' }
      };
      return;
    }

    const entry = history[entryIndex];

    // Best-effort blob delete
    try {
      const conn = process.env.STORAGE_CONNECTION || process.env.AZURE_STORAGE_CONNECTION_STRING;
      if (BlobServiceClient && conn && entry.blobName) {
        const service = BlobServiceClient.fromConnectionString(conn);
        const containerClient = service.getContainerClient('plan-history');
        const blobClient = containerClient.getBlockBlobClient(entry.blobName);
        await blobClient.deleteIfExists();
      }
    } catch (err) {
      context.log.warn('[plan-history-delete] Failed to delete blob:', err.message);
    }

    history.splice(entryIndex, 1);
    session.planHistory = history;
    await container.item(sessionId, sessionId).replace(session);

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { success: true, history }
    };
  } catch (error) {
    context.log.error('Error deleting plan history:', error);
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: { error: 'Failed to delete plan history', details: error.message }
    };
  }
};
