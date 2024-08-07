import initializeWaterline from './models/index.js';

initializeWaterline()
    .then((ontology) => {
        const Page = ontology.collections.page;
        const Whiteboard = ontology.collections.whiteboard;

        console.log('ORM initialized:');

        const createTestData = async () => {
            try {
                // Create a new Page
                const newPage = await Page.create({
                    title: 'New Page',
                    page_type: 'whiteboard',
                    custom_meta_attribute_id: '123',
                    page_content_id: '456',
                    folder_id: '789',
                    created_by: 'user1',
                    last_updated_by: 'user1'
                }).fetch();

                console.log('Page created:', newPage);

                // Create new Whiteboard entries associated with the Page
                const whiteboard1 = await Whiteboard.create({
                    content: { text: 'Whiteboard Content 1' },
                    summery: 'Summary 1',
                    page_id: newPage._id
                }).fetch();

                const whiteboard2 = await Whiteboard.create({
                    content: { text: 'Whiteboard Content 2' },
                    summery: 'Summary 2',
                    page_id: newPage._id
                }).fetch();

                console.log('Whiteboards created:', whiteboard1, whiteboard2);

                // Populate the Page with its associated Whiteboards
                const populateWhiteboard1 = await Whiteboard.findOne({ _id: whiteboard1._id }).populate('page_id');
                const populateWhiteboard2 = await Whiteboard.findOne({ _id: whiteboard2._id }).populate('page_id');
                console.log('Populated Whiteboards:', populateWhiteboard1, populateWhiteboard2);
            } catch (error) {
                console.error('Error creating test data:', error);
            }
        };

        createTestData();
    })
    .catch((err) => {
        console.error('Failed to initialize Waterline:', err);
    });