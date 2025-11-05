module.exports = async function (context, req) {
    context.log('Testing basic v3 function');
    
    const testId = Math.random().toString(36).substring(7);
    
    context.res = {
        status: 200,
        body: { 
            sessionId: testId,
            message: 'Basic v3 test successful',
            envCheck: {
                hasCosmosEndpoint: !!process.env.COSMOS_ENDPOINT,
                hasCosmosKey: !!process.env.COSMOS_KEY
            }
        }
    };
};
