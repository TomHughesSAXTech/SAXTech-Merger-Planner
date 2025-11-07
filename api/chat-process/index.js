const { OpenAIClient, AzureKeyCredential } = require('@azure/openai');
const { CosmosClient } = require('@azure/cosmos');

const categoryPrompts = {
    infrastructure: 'You are an IT infrastructure discovery assistant. Ask about network topology, servers, storage, virtualization platforms, and legacy systems. Extract key infrastructure details.',
    application: 'You are an application portfolio discovery assistant. Ask about business applications, ERP/CRM systems, custom applications, dependencies, integration points, and licensing. Extract application inventory details.',
    data: 'You are a data discovery assistant. Ask about database systems, data volume, backup and recovery processes, compliance requirements, and unstructured data. Extract data landscape details.',
    security: 'You are a security discovery assistant. Ask about firewalls, compliance frameworks, identity management, security policies, and recent incidents. Extract security posture details.',
    communication: 'You are a communication systems discovery assistant. Ask about email systems, phone systems, collaboration tools, and user migration requirements. Extract communication infrastructure details.'
};

module.exports = async function (context, req) {
    try {
        const openAIEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
        const openAIKey = process.env.AZURE_OPENAI_KEY;
        const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT;
        const cosmosEndpoint = process.env.COSMOS_ENDPOINT;
        const cosmosKey = process.env.COSMOS_KEY;
        
        const openAIClient = new OpenAIClient(openAIEndpoint, new AzureKeyCredential(openAIKey));
        const cosmosClient = new CosmosClient({ endpoint: cosmosEndpoint, key: cosmosKey });
        const database = cosmosClient.database('MAOnboarding');
        const container = database.container('Sessions');
        
        const body = req.body;
        const { sessionId, message, category, context: conversationContext } = body;

        const { resource: session } = await container.item(sessionId, sessionId).read();
        
        const systemPrompt = categoryPrompts[category] || 'You are an M&A onboarding assistant.';
        
        const messages = [
            { role: 'system', content: systemPrompt },
            ...(conversationContext || []).map(msg => ({ role: msg.role, content: msg.content })),
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

        // Extract discovery data incrementally from every user response
        let discoveryData = null;
        let categoryComplete = false;

        // Always try to extract data from recent conversation
        const extractionMessages = [
            { role: 'system', content: `Extract any factual ${category} information from the user's latest response. Return ONLY a JSON object with discovered facts. If no new facts, return {}.` },
            { role: 'user', content: `Latest response: ${message}\n\nPrevious context: ${conversationContext?.slice(-3).map(m => m.content).join(' ') || ''}` }
        ];

        try {
            const extractionResult = await openAIClient.getChatCompletions(deploymentName, extractionMessages, {
                maxTokens: 300,
                temperature: 0.2
            });

            const extracted = JSON.parse(extractionResult.choices[0].message.content);
            if (extracted && Object.keys(extracted).length > 0) {
                // Merge with existing category data
                session.discoveryData[category] = {
                    ...(session.discoveryData[category] || {}),
                    ...extracted
                };
                discoveryData = session.discoveryData[category];
            }
        } catch (parseError) {
            context.log.error('Failed to parse discovery data:', parseError);
        }

        // Check if user wants to move to next category
        if (message.toLowerCase().includes('done') || message.toLowerCase().includes('complete') || 
            message.toLowerCase().includes('finished') || message.toLowerCase().includes('next')) {
            categoryComplete = true;
        }

        await container.item(sessionId, sessionId).replace(session);

        context.res = {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                response,
                discoveryData,
                categoryComplete
            })
        };
    } catch (error) {
        context.log.error('Error processing chat:', error);
        context.res = {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Failed to process chat message', details: error.message })
        };
    }
};
