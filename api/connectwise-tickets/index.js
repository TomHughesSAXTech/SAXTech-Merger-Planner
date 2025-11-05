module.exports = async function (context, req) {
    try {
        const body = req.body;
        const { tickets } = body;

        const created = tickets.map(ticket => ({
            ...ticket,
            id: Math.floor(Math.random() * 100000),
            status: 'created',
            url: `https://connectwise.example.com/ticket/${Math.floor(Math.random() * 100000)}`
        }));

        context.res = {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: true,
                created
            })
        };
    } catch (error) {
        context.log.error('Error creating ConnectWise tickets:', error);
        context.res = {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Failed to create ConnectWise tickets', details: error.message })
        };
    }
};
