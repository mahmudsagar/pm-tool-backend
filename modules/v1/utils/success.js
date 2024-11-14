export const formatSuccessMessage = (message, data) => {
    return {
        status: 'success',
        message: [
            {
                success: [
                    message
                ]
            }
        ],
        data: data
    };
};