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
    const entry = history.find(h => h.id === planId);
    if (!entry || !entry.blobName) {
      context.res = {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Plan history entry not found' }
      };
      return;
    }

    const conn = process.env.STORAGE_CONNECTION || process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!BlobServiceClient || !conn) {
      context.res = {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Storage configuration missing for plan load' }
      };
      return;
    }

    const service = BlobServiceClient.fromConnectionString(conn);
    const containerClient = service.getContainerClient('plan-history');
    const blobClient = containerClient.getBlockBlobClient(entry.blobName);
    const download = await blobClient.download();
    const downloaded = await streamToString(download.readableStreamBody);
    const payload = JSON.parse(downloaded || '{}');

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: {
        name: entry.name,
        createdAt: entry.createdAt,
        executionPlan: payload.executionPlan || null,
        nodes: payload.nodes || [],
        edges: payload.edges || []
      }
    };
  } catch (error) {
    context.log.error('Error loading plan history:', error);
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: { error: 'Failed to load plan history', details: error.message }
    };
  }
};

async function streamToString(readable) {
  if (!readable) return '';
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on('data', data => chunks.push(data.toString()));
    readable.on('end', () => resolve(chunks.join('')));
    readable.on('error', reject);
  });
}
