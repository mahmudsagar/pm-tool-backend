import initializeWaterline from '../models/index.js';

const createFolder = async () => {
    try {
        // Ensure Waterline is initialized
        await initializeWaterline();

        // Create a new Folder
        const newFolder = await global.Folder.create({
            name: 'New Folder',
            description: 'This is a new folder',
            parent_id: 'parent123',
            workspace_id: 'workspace456',
            teams: [{ team_id: 'team1' }, { team_id: 'team2' }],
            users: [{ user_id: 'user1' }, { user_id: 'user2' }]
        }).fetch();

        console.log('Folder created:', newFolder);
    } catch (error) {
        console.error('Error creating folder:', error);
    }
};

createFolder();