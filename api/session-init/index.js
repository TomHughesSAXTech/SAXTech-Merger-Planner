const { app } = require('@azure/functions');

// V4 format - function name becomes the route: /api/session-init
app.http('session-init', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        context.log('session-init called');
        
        const sessionId = 'test-' + Date.now();
        
        return {
            jsonBody: { 
                sessionId,
                message: 'Test response v4' 
            }
        };
    }
});
};
