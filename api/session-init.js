const { app } = require('@azure/functions');
const { CosmosClient } = require('@azure/cosmos');
const { v4: uuidv4 } = require('uuid');

const cosmosEndpoint = process.env.COSMOS_ENDPOINT;
const cosmosKey = process.env.COSMOS_KEY;
const cosmosClient = new CosmosClient({ endpoint: cosmosEndpoint, key: cosmosKey });
const database = cosmosClient.database('MAOnboarding');
const container = database.container('Sessions');

app.http('session-init', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'session/init',
    handler: async (request, context) => {
        try {
            const body = await request.json();
            const sessionId = uuidv4();
            
            const sessionData = {
                id: sessionId,
                sessionId,
                type: body.type || 'ma-onboarding',
                createdAt: new Date().toISOString(),
                discoveryData: {},
                messages: [],
                status: 'active'
            };

            await container.items.create(sessionData);

            return {
                status: 200,
                jsonBody: { sessionId }
            };
        } catch (error) {
            context.log('Error initializing session:', error);
            return {
                status: 500,
                jsonBody: { error: 'Failed to initialize session' }
            };
        }
    }
});
