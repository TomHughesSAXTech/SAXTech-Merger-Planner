const { CosmosClient } = require('@azure/cosmos');

const cosmosEndpoint = process.env.COSMOS_ENDPOINT;
const cosmosKey = process.env.COSMOS_KEY;

const client = new CosmosClient({ endpoint: cosmosEndpoint, key: cosmosKey });
const database = client.database('MAOnboarding');
const container = database.container('Configurations');

module.exports = async function (context, req) {
  context.log('Fetching configuration from Cosmos DB');

  try {
    // Configuration is stored with id "discovery_config"
    const { resource: config } = await container.item('discovery_config', 'discovery_config').read();

    if (!config) {
      context.res = {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Configuration not found - using defaults' }
      };
      return;
    }

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { config: config.data }
    };
  } catch (error) {
    context.log.error('Error fetching configuration:', error);
    
    // Return 404 if config doesn't exist yet (first time)
    if (error.code === 404) {
      context.res = {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
        body: { error: 'Configuration not found - using defaults' }
      };
      return;
    }

    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: { error: 'Failed to fetch configuration' }
    };
  }
};
