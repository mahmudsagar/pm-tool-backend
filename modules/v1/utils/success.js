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

export const formatErrorMessage = (message, data) => {
    return {
        status: 'error',
        message: [
            {
                error: [
                    message
                ]
            }
        ],
        data: data
    };
};