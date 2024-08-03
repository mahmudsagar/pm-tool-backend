// waterline orm mongodb connection
import mongAdapter from 'sails-mongo';

const connection = {
    adapters: {
        'default': mongAdapter,
        mongo: mongAdapter
    },
    datastores: {
        default: {
            adapter: 'mongo',
            url: process.env.MONGODB_URI
        }
    }
};

export default connection;