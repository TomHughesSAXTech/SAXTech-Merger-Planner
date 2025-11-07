const { CosmosClient } = require('@azure/cosmos');

const cosmosEndpoint = process.env.COSMOS_ENDPOINT;
const cosmosKey = process.env.COSMOS_KEY;

const client = new CosmosClient({ endpoint: cosmosEndpoint, key: cosmosKey });
const database = client.database('MAOnboarding');
const container = database.container('Configurations');

module.exports = async function (context, req) {
  context.log('Saving configuration to Cosmos DB');

  const { config } = req.body;

  if (!config) {
    context.res = {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: { error: 'Configuration is required' }
    };
    return;
  }

  // Validate configuration structure
  if (!config.categories || !Array.isArray(config.categories)) {
    context.res = {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: { error: 'Invalid configuration: categories array is required' }
    };
    return;
  }

  try {
    const configDoc = {
      id: 'discovery_config',
      data: config,
      updatedAt: new Date().toISOString()
    };

    // Upsert configuration (create or update)
    await container.items.upsert(configDoc);

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { success: true, message: 'Configuration saved successfully' }
    };
  } catch (error) {
    context.log.error('Error saving configuration:', error);
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: { error: 'Failed to save configuration' }
    };
  }
};
