// Ultra-minimal test version - no dependencies
module.exports = async function (context, req) {
    context.log('session-init called');
    
    const sessionId = 'test-' + Date.now();
    
    context.res = {
        status: 200,
        headers: { 
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
            sessionId: sessionId,
            message: 'Test response' 
        })
    };
};
