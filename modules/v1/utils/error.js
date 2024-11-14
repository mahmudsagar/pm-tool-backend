
export const formatZodErrors = (errors) => {
    return errors.map(error => {
        const path = error.path.join('.');
        return {
            status: 'failed',
            message: `${error.message} at ${path}`
        };
    });
};

export const formatErrorMessage = (message) => {
    return {
        status: 'failed',
        message: [
            {
                error: [
                    message
                ]
            }
        ]
    };
};