const { OpenAIClient, AzureKeyCredential } = require('@azure/openai');
const { CosmosClient } = require('@azure/cosmos');

// Default category prompts (fallback if config not available)
const defaultCategoryPrompts = {
    infrastructure: 'You are an IT infrastructure discovery assistant. Ask about network topology, servers, storage, virtualization platforms, and legacy systems. Extract key infrastructure details.',
    application: 'You are an application portfolio discovery assistant. Ask about business applications, ERP/CRM systems, custom applications, dependencies, integration points, and licensing. Extract application inventory details.',
    data: 'You are a data discovery assistant. Ask about database systems, data volume, backup and recovery processes, compliance requirements, and unstructured data. Extract data landscape details.',
    security: 'You are a security discovery assistant. Ask about firewalls, compliance frameworks, identity management, security policies, and recent incidents. Extract security posture details.',
    communication: 'You are a communication systems discovery assistant. Ask about email systems, phone systems, collaboration tools, and user migration requirements. Extract communication infrastructure details.'
};

async function loadConfig(cosmosClient) {
    try {
        const database = cosmosClient.database('MAOnboarding');
        const container = database.container('Configurations');
        const { resource: config } = await container.item('discovery_config', 'discovery_config').read();
        return config.data;
    } catch (error) {
        // Return null if config doesn't exist yet
        return null;
    }
}

// Helper to call OpenAI with a primary deployment and gracefully fall back
// to a default deployment if the primary deployment does not exist in the
// target Azure OpenAI resource.
async function getChatCompletionsWithFallback(client, primaryDeployment, fallbackDeployment, messages, options, context, label) {
    try {
        if (!primaryDeployment && !fallbackDeployment) {
            throw new Error('No OpenAI deployment configured. Set aiModel or AZURE_OPENAI_DEPLOYMENT.');
        }

        const deploymentToUse = primaryDeployment || fallbackDeployment;
        return await client.getChatCompletions(deploymentToUse, messages, options);
    } catch (err) {
        const message = (err && err.message ? err.message : '').toLowerCase();
        const missingDeployment = message.includes('deployment') && message.includes('does not exist');

        if (missingDeployment && fallbackDeployment && primaryDeployment && fallbackDeployment !== primaryDeployment) {
            context.log.warn(`Primary OpenAI deployment "${primaryDeployment}" not found, retrying with fallback deployment "${fallbackDeployment}" for ${label}.`);
            return await client.getChatCompletions(fallbackDeployment, messages, options);
        }

        throw err;
    }
}

module.exports = async function (context, req) {
    try {
        const keyPrimary = process.env.AZURE_OPENAI_KEY_PRIMARY || process.env.AZURE_OPENAI_KEY;
        const keySecondary = process.env.AZURE_OPENAI_KEY_SECONDARY;
        const defaultDeployment = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4.1-mini';
        const cosmosEndpoint = process.env.COSMOS_ENDPOINT;
        const cosmosKey = process.env.COSMOS_KEY;
        
        const cosmosClient = new CosmosClient({ endpoint: cosmosEndpoint, key: cosmosKey });
        const database = cosmosClient.database('MAOnboarding');
        const container = database.container('Sessions');
        
        const body = req.body;
        const { sessionId, message, category, context: conversationContext } = body;
        
        // Load configuration from Cosmos DB
        const config = await loadConfig(cosmosClient);

        // Determine OpenAI settings, using aiModel as primary deployment selector
        const openAiSettings = config?.globalSettings?.openAi || {};
        const modelFromConfig = config?.globalSettings?.aiModel;
        const openAIEndpoint = 'https://client-fcs.cognitiveservices.azure.com/';
        const deploymentName = modelFromConfig || defaultDeployment;
        let openAIKey = keyPrimary;
        if (openAiSettings.keySlot === 'secondary' && keySecondary) {
            openAIKey = keySecondary;
        }

        const openAIClient = new OpenAIClient(openAIEndpoint, new AzureKeyCredential(openAIKey));
        
        // Get category prompts from config or use defaults
        const categoryConfig = config?.categories?.find(c => c.id === category);
        const systemPrompt = categoryConfig?.extractionPrompt || defaultCategoryPrompts[category] || 'You are an M&A onboarding assistant.';

        const { resource: session } = await container.item(sessionId, sessionId).read();

        // Ensure legacy or partially initialized sessions still have the expected structures
        if (!session.messages) {
            session.messages = [];
        }
        if (!session.discoveryData) {
            session.discoveryData = {};
        }
        
        const messages = [
            { role: 'system', content: systemPrompt },
            ...(conversationContext || []).map(msg => ({ role: msg.role, content: msg.content })),
            { role: 'user', content: message }
        ];

        const completion = await getChatCompletionsWithFallback(
            openAIClient,
            deploymentName,
            defaultDeployment,
            messages,
            {
                maxTokens: 500,
                temperature: 0.7
            },
            context,
            'chat-process main response'
        );

        const response = completion.choices[0].message.content;
        
        session.messages.push(
            { role: 'user', content: message, timestamp: new Date().toISOString() },
            { role: 'assistant', content: response, timestamp: new Date().toISOString() }
        );

        // Extract discovery data incrementally from every user response
        let discoveryData = null;
        let categoryComplete = false;

        // Get extraction prompt from config or use default
        const extractionPrompt = categoryConfig?.extractionPrompt || `Extract any factual ${category} information from the user's latest response. Return ONLY a JSON object with discovered facts. If no new facts, return {}.`;
        
        // Always try to extract data from recent conversation
        const extractionMessages = [
            { role: 'system', content: extractionPrompt },
            { role: 'user', content: `Latest response: ${message}\n\nPrevious context: ${conversationContext?.slice(-3).map(m => m.content).join(' ') || ''}` }
        ];

        try {
            const extractionResult = await getChatCompletionsWithFallback(
                openAIClient,
                deploymentName,
                defaultDeployment,
                extractionMessages,
                {
                    maxTokens: 300,
                    temperature: 0.2
                },
                context,
                'chat-process discovery extraction'
            );

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

        // Check completion based on config criteria or default keywords
        const completionCriteria = categoryConfig?.completionCriteria;
        const normalizedMessage = message.toLowerCase();
        const userSignaledDone = normalizedMessage.includes('done') ||
            normalizedMessage.includes('complete') ||
            normalizedMessage.includes('finished') ||
            normalizedMessage.includes('next');

        if (completionCriteria) {
            const factCount = Object.keys(session.discoveryData[category] || {}).length;
            const hasRequiredFields = completionCriteria.requiredFields?.every(field => 
                session.discoveryData[category]?.[field]
            ) ?? true;

            // Require BOTH: enough extracted facts AND an explicit user signal to move on.
            if (userSignaledDone && factCount >= (completionCriteria.minFacts || 3) && hasRequiredFields) {
                categoryComplete = true;
            }
        } else {
            // Fallback to simple keyword detection when no structured criteria exist
            if (userSignaledDone) {
                categoryComplete = true;
            }
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
