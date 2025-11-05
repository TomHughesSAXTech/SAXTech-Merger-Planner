const { app } = require('@azure/functions');
const { OpenAIClient, AzureKeyCredential } = require('@azure/openai');
const { CosmosClient } = require('@azure/cosmos');

const openAIEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
const openAIKey = process.env.AZURE_OPENAI_KEY;
const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT;
const openAIClient = new OpenAIClient(openAIEndpoint, new AzureKeyCredential(openAIKey));

const cosmosEndpoint = process.env.COSMOS_ENDPOINT;
const cosmosKey = process.env.COSMOS_KEY;
const cosmosClient = new CosmosClient({ endpoint: cosmosEndpoint, key: cosmosKey });
const database = cosmosClient.database('MAOnboarding');
const container = database.container('Sessions');

const categoryPrompts = {
    infrastructure: 'You are an IT infrastructure discovery assistant. Ask about network topology, servers, storage, virtualization platforms, and legacy systems. Extract key infrastructure details.',
    application: 'You are an application portfolio discovery assistant. Ask about business applications, ERP/CRM systems, custom applications, dependencies, integration points, and licensing. Extract application inventory details.',
    data: 'You are a data discovery assistant. Ask about database systems, data volume, backup and recovery processes, compliance requirements, and unstructured data. Extract data landscape details.',
    security: 'You are a security discovery assistant. Ask about firewalls, compliance frameworks, identity management, security policies, and recent incidents. Extract security posture details.',
    communication: 'You are a communication systems discovery assistant. Ask about email systems, phone systems, collaboration tools, and user migration requirements. Extract communication infrastructure details.'
};

app.http('chat-process', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            const body = await request.json();
            const { sessionId, message, category, context: conversationContext } = body;

            const { resource: session } = await container.item(sessionId, sessionId).read();
            
            const systemPrompt = categoryPrompts[category] || 'You are an M&A onboarding assistant.';
            
            const messages = [
                { role: 'system', content: systemPrompt },
                ...conversationContext.map(msg => ({ role: msg.role, content: msg.content })),
                { role: 'user', content: message }
            ];

            const completion = await openAIClient.getChatCompletions(deploymentName, messages, {
                maxTokens: 500,
                temperature: 0.7
            });

            const response = completion.choices[0].message.content;
            
            session.messages.push(
                { role: 'user', content: message, timestamp: new Date().toISOString() },
                { role: 'assistant', content: response, timestamp: new Date().toISOString() }
            );

            let discoveryData = null;
            let categoryComplete = false;

            if (message.toLowerCase().includes('done') || message.toLowerCase().includes('complete') || 
                message.toLowerCase().includes('finished') || message.toLowerCase().includes('next')) {
                categoryComplete = true;
                
                const extractionMessages = [
                    { role: 'system', content: `Extract structured discovery data from this conversation about ${category}. Return JSON only.` },
                    { role: 'user', content: JSON.stringify(session.messages.filter(m => m.role === 'user' || m.role === 'assistant')) }
                ];

                const extractionResult = await openAIClient.getChatCompletions(deploymentName, extractionMessages, {
                    maxTokens: 800,
                    temperature: 0.3
                });

                try {
                    discoveryData = JSON.parse(extractionResult.choices[0].message.content);
                    session.discoveryData[category] = discoveryData;
                } catch (parseError) {
                    context.log('Failed to parse discovery data:', parseError);
                }
            }

            await container.item(sessionId, sessionId).replace(session);

            return {
                status: 200,
                jsonBody: {
                    response,
                    discoveryData,
                    categoryComplete
                }
            };
        } catch (error) {
            context.log('Error processing chat:', error);
            return {
                status: 500,
                jsonBody: { error: 'Failed to process chat message' }
            };
        }
    }
});
