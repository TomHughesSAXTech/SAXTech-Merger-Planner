const { app } = require('@azure/functions');

app.http('connectwise-tickets', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            const body = await request.json();
            const { tickets } = body;

            const created = tickets.map(ticket => ({
                ...ticket,
                id: Math.floor(Math.random() * 100000),
                status: 'created',
                url: `https://connectwise.example.com/ticket/${Math.floor(Math.random() * 100000)}`
            }));

            return {
                status: 200,
                jsonBody: {
                    success: true,
                    created
                }
            };
        } catch (error) {
            context.log('Error creating ConnectWise tickets:', error);
            return {
                status: 500,
                jsonBody: { error: 'Failed to create ConnectWise tickets' }
            };
        }
    }
});
