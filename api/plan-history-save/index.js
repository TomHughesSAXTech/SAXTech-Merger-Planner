const { CosmosClient } = require('@azure/cosmos');
let BlobServiceClient;
try {
  ({ BlobServiceClient } = require('@azure/storage-blob'));
} catch (e) {
  // storage SDK not available locally; history backup step will be skipped
}
const { v4: uuidv4 } = require('uuid');

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

    const { sessionId, name, nodes, edges } = req.body || {};
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
    if (!session) {
      context.res = {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Session not found' }
      };
      return;
    }

    // Prepare blob payload
    const historyPayload = {
      sessionId,
      createdAt: new Date().toISOString(),
      discoveryData: session.discoveryData || {},
      executionPlan: session.executionPlan || null,
      nodes: nodes || null,
      edges: edges || null
    };

    // Write to blob storage if configured
    let blobName = null;
    try {
      const conn = process.env.STORAGE_CONNECTION || process.env.AZURE_STORAGE_CONNECTION_STRING;
      if (BlobServiceClient && conn) {
        const service = BlobServiceClient.fromConnectionString(conn);
        const containerClient = service.getContainerClient('plan-history');
        try { await containerClient.createIfNotExists({ access: 'container' }); } catch {}
        const id = uuidv4();
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        blobName = `${sessionId}/${ts}-${id}.json`;
        const blobClient = containerClient.getBlockBlobClient(blobName);
        const body = JSON.stringify(historyPayload, null, 2);
        await blobClient.upload(body, Buffer.byteLength(body), {
          blobHTTPHeaders: { blobContentType: 'application/json' }
        });
      } else {
        context.log('[plan-history-save] Storage history skipped (no SDK or connection string)');
      }
    } catch (err) {
      context.log.warn('[plan-history-save] Backup to blob failed:', err.message);
    }

    const entryId = uuidv4();
    const historyEntry = {
      id: entryId,
      name: name || `Plan ${new Date().toLocaleString()}`,
      createdAt: new Date().toISOString(),
      blobName
    };

    const existingHistory = Array.isArray(session.planHistory) ? session.planHistory : [];
    session.planHistory = [historyEntry, ...existingHistory];

    await container.item(sessionId, sessionId).replace(session);

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { success: true, history: session.planHistory }
    };
  } catch (error) {
    context.log.error('Error saving plan history:', error);
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: { error: 'Failed to save plan history', details: error.message }
    };
  }
};
